'use strict';
const BaseGame = require('./base');
const { matchesAny, shuffle, maskAnswer, normalize } = require('../util');
const { trackChoices } = require('../choices');
const difficulty = require('../difficulty');

const COUNTDOWN_MS = 4000;
const REVEAL_MS = 7000;

/**
 * Blind Test relié à YouTube.
 *
 * Chaque joueur lance sa propre lecture (via l'IFrame API) : tout le monde
 * entend le même extrait, au même moment de la piste. Le chrono qui compte
 * pour les points est celui du serveur.
 *
 * Deux façons de répondre :
 *   • QCM    — quatre propositions « Artiste — Titre », un seul essai ;
 *   • SAISIE — on tape, et le titre et l'artiste rapportent séparément.
 */
class BlindTest extends BaseGame {
  constructor(room, options) {
    super(room, options);
    this.diff = difficulty.resolve(options.difficulty);
    this.roundSeconds = this.diff.blindtest.seconds;
    this.hintFrom = this.diff.blindtest.hintFrom;
    this.mult = this.diff.mult;
    this.mode = options.mode || 'both'; // 'title' | 'artist' | 'both' (mode saisie)

    this.allTracks = options.tracks || [];
    this.tracks = shuffle(this.allTracks).slice(0, options.rounds || 10);

    // Le QCM demande au moins 4 pistes pour proposer des leurres crédibles.
    this.answerMode = options.answerMode === 'choice' && this.allTracks.length >= 4 ? 'choice' : 'type';
    this.downgraded = options.answerMode === 'choice' && this.answerMode === 'type';

    this.roundIndex = -1;
    this.round = null;
    this.history = [];
  }

  get totalRounds() {
    return this.tracks.length;
  }

  start() {
    if (!this.tracks.length) {
      this.room.toast('Aucune piste jouable dans cette playlist.', 'error');
      this.room.stopGame();
      return;
    }
    if (this.downgraded) {
      this.room.toast('Playlist trop courte pour le QCM (4 titres minimum) — passage en saisie.', 'info');
    }
    this.nextRound();
  }

  nextRound() {
    this.roundIndex++;
    if (this.roundIndex >= this.totalRounds) return this.finish();

    const track = this.tracks[this.roundIndex];
    const choices = this.answerMode === 'choice' ? trackChoices(track, this.allTracks) : null;

    this.round = {
      track,
      choices,
      correctIndex: choices ? choices.indexOf(`${track.artist} — ${track.title}`) : -1,
      // fraction de la piste où démarrer : le client multiplie par la durée réelle,
      // ce qui donne le même point de départ pour tout le monde
      startFraction: 0.12 + Math.random() * 0.3,
      startedAt: null,
      found: new Map(), // saisie : playerId → { title, artist, done }
      picks: new Map(), // QCM    : playerId → { index, ms, correct, points }
      firstTitle: null,
      firstArtist: null,
      firstRight: null,
      skipVotes: new Set(),
    };
    this._lastHintStep = null;

    this.setPhase('countdown', COUNTDOWN_MS);
    this.sync();

    this.after(COUNTDOWN_MS, () => {
      if (!this.round) return;
      this.round.startedAt = Date.now();
      this.setPhase('playing', this.roundSeconds * 1000);
      this.sync();
      if (this.answerMode === 'type') this.every(1000, () => this.tickHints());
      this.after(this.roundSeconds * 1000, () => this.reveal('temps écoulé'));
    });
  }

  /** Dévoile progressivement les lettres restantes (mode saisie uniquement). */
  tickHints() {
    if (this.phase !== 'playing' || !this.round) return;
    const step = Math.floor(this.hintRatio() * 100);
    if (step !== this._lastHintStep) {
      this._lastHintStep = step;
      this.sync();
    }
  }

  hintRatio() {
    if (!this.round || !this.round.startedAt) return 0;
    const elapsed = (Date.now() - this.round.startedAt) / (this.roundSeconds * 1000);
    if (elapsed < this.hintFrom) return 0;
    const span = Math.max(0.001, 1 - this.hintFrom);
    const into = (elapsed - this.hintFrom) / span;
    if (into < 0.33) return 0.2;
    if (into < 0.66) return 0.35;
    return 0.5;
  }

  /* ─── Actions des joueurs ─────────────────────────────── */

  handle(playerId, action, payload = {}) {
    if (action === 'guess') return this.onGuess(playerId, payload.text);
    if (action === 'pick') return this.onPick(playerId, payload.index);
    if (action === 'skip') return this.onSkipVote(playerId);
  }

  /* ── Mode QCM ── */

  onPick(playerId, rawIndex) {
    if (this.phase !== 'playing' || !this.round || this.answerMode !== 'choice') return;
    if (this.round.picks.has(playerId)) return; // un seul essai

    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= this.round.choices.length) return;

    const ms = Date.now() - this.round.startedAt;
    const correct = index === this.round.correctIndex;
    let points = 0;

    if (correct) {
      const first = this.round.firstRight === null;
      if (first) this.round.firstRight = playerId;
      points = this.points(ms, first, 1);
      this.addScore(playerId, points);
    }

    this.round.picks.set(playerId, { index, ms, correct, points });

    const p = this.player(playerId);
    if (correct) this.room.emit('blindtest:hit', { playerId, name: p.name, hits: ['la bonne piste'], points });
    this.toPlayer(playerId, 'blindtest:feedback', { ok: correct, points });

    this.sync();
    if (this.everyoneDone()) this.reveal('tout le monde a répondu');
  }

  /* ── Mode saisie ── */

  onGuess(playerId, text) {
    if (this.phase !== 'playing' || !this.round || this.answerMode !== 'type') return;
    const guess = String(text || '').trim().slice(0, 80);
    if (!guess) return;

    const entry = this.round.found.get(playerId) || { title: null, artist: null };
    const { track } = this.round;
    const elapsed = Date.now() - this.round.startedAt;
    let gained = 0;
    const hits = [];

    const wantTitle = this.mode !== 'artist';
    const wantArtist = this.mode !== 'title';
    const parts = (wantTitle ? 1 : 0) + (wantArtist ? 1 : 0);

    if (wantTitle && entry.title === null && matchesAny(guess, track.acceptTitles)) {
      entry.title = elapsed;
      const first = this.round.firstTitle === null;
      if (first) this.round.firstTitle = playerId;
      gained += this.points(elapsed, first, parts);
      hits.push('titre');
    }
    if (wantArtist && entry.artist === null && matchesAny(guess, track.acceptArtists)) {
      entry.artist = elapsed;
      const first = this.round.firstArtist === null;
      if (first) this.round.firstArtist = playerId;
      gained += this.points(elapsed, first, parts);
      hits.push('artiste');
    }

    this.round.found.set(playerId, entry);

    if (gained > 0) {
      this.addScore(playerId, gained);
      const p = this.player(playerId);
      this.room.emit('blindtest:hit', { playerId, name: p.name, hits, points: gained });
      this.toPlayer(playerId, 'blindtest:feedback', { ok: true, hits, points: gained });

      const complete = (!wantTitle || entry.title !== null) && (!wantArtist || entry.artist !== null);
      if (complete) entry.done = true;

      this.sync();
      if (this.everyoneDone()) this.reveal('tout le monde a trouvé');
    } else {
      this.toPlayer(playerId, 'blindtest:feedback', { ok: false, warm: this.isWarm(guess, track) });
    }
  }

  isWarm(guess, track) {
    const g = normalize(guess);
    if (g.length < 3) return false;
    return [...track.acceptTitles, ...track.acceptArtists].some((ans) => {
      const a = normalize(ans);
      return a.includes(g) || g.includes(a.split(' ')[0]);
    });
  }

  /** `parts` répartit les points quand une manche a deux réponses à trouver. */
  points(elapsedMs, isFirst, parts = 1) {
    const total = this.roundSeconds * 1000;
    const speed = Math.max(0, 1 - elapsedMs / total);
    const base = (70 + 110 * speed) / parts;
    const bonus = isFirst ? 30 / parts : 0;
    return Math.round((base + bonus) * this.mult);
  }

  everyoneDone() {
    const players = this.room.connectedPlayers();
    if (!players.length) return false;
    if (this.answerMode === 'choice') return players.every((p) => this.round.picks.has(p.id));
    return players.every((p) => (this.round.found.get(p.id) || {}).done);
  }

  onSkipVote(playerId) {
    if (this.phase !== 'playing' || !this.round) return;
    this.round.skipVotes.add(playerId);
    const needed = Math.ceil(this.room.connectedPlayers().length / 2);
    this.sync();
    if (this.round.skipVotes.size >= needed) this.reveal('passée au vote');
  }

  /* ─── Révélation & fin ────────────────────────────────── */

  reveal(reason) {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    this.clearTimers();
    this._lastHintStep = null;
    const { track, found, picks } = this.round;

    this.history.push({
      round: this.roundIndex + 1,
      title: track.title,
      artist: track.artist,
      videoId: track.videoId,
      finders:
        this.answerMode === 'choice'
          ? [...picks.entries()]
              .filter(([, v]) => v.correct)
              .map(([id, v]) => ({ id, name: this.player(id) ? this.player(id).name : '?', ms: v.ms }))
          : [...found.entries()]
              .filter(([, v]) => v.title !== null || v.artist !== null)
              .map(([id, v]) => ({ id, name: this.player(id) ? this.player(id).name : '?', ...v })),
    });

    this.setPhase('reveal', REVEAL_MS);
    this.room.emit('blindtest:reveal', {
      reason,
      track: { title: track.title, artist: track.artist, videoId: track.videoId, thumbnail: track.thumbnail },
    });
    this.sync();
    this.after(REVEAL_MS, () => this.nextRound());
  }

  finish() {
    this.clearTimers();
    this.setPhase('results');
    this.sync();
  }

  /* ─── Vue par joueur ──────────────────────────────────── */

  stateFor(playerId) {
    const base = {
      key: 'blindtest',
      phase: this.phase,
      deadline: this.deadline,
      serverNow: Date.now(),
      round: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      mode: this.mode,
      answerMode: this.answerMode,
      difficulty: { id: this.diff.id, name: this.diff.name, color: this.diff.color, mult: this.diff.mult },
      ranking: this.ranking(),
    };

    if (this.phase === 'results') return { ...base, history: this.history };
    if (!this.round) return base;

    const revealAll = this.phase === 'reveal';
    const { track } = this.round;
    const video =
      this.phase === 'playing' || this.phase === 'reveal'
        ? { id: track.videoId, startFraction: this.round.startFraction, startedAt: this.round.startedAt }
        : null;

    const common = {
      ...base,
      video,
      revealed: revealAll ? { title: track.title, artist: track.artist, thumbnail: track.thumbnail } : null,
      skipVotes: this.round.skipVotes.size,
      skipNeeded: Math.ceil(this.room.connectedPlayers().length / 2),
      youVotedSkip: this.round.skipVotes.has(playerId),
    };

    /* ── QCM ── */
    if (this.answerMode === 'choice') {
      const mine = this.round.picks.get(playerId);
      return {
        ...common,
        choices: this.round.choices,
        correctIndex: revealAll ? this.round.correctIndex : null,
        yourPick: mine ? mine.index : null,
        yourResult: mine ? { correct: mine.correct, points: mine.points } : null,
        answeredCount: this.round.picks.size,
        playerCount: this.room.connectedPlayers().length,
      };
    }

    /* ── Saisie ── */
    const entry = this.round.found.get(playerId) || {};
    const ratio = this.hintRatio();
    return {
      ...common,
      you: {
        title: entry.title !== null && entry.title !== undefined,
        artist: entry.artist !== null && entry.artist !== undefined,
      },
      hint: {
        title: revealAll || entry.title != null ? track.title : maskAnswer(track.title, ratio),
        artist: revealAll || entry.artist != null ? track.artist : maskAnswer(track.artist, ratio),
      },
      foundCount: [...this.round.found.values()].filter((v) => v.done).length,
    };
  }
}

module.exports = BlindTest;
