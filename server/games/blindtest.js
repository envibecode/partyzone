'use strict';
const BaseGame = require('./base');
const { matchesAny, shuffle, maskAnswer, normalize } = require('../util');

const COUNTDOWN_MS = 4000;
const REVEAL_MS = 7000;

/**
 * Blind Test relié à YouTube.
 *
 * Chaque joueur lance sa propre lecture (via l'IFrame API) : tout le monde
 * entend le même extrait, au même moment de la piste. Le chrono qui compte
 * pour les points est celui du serveur.
 *
 * Deux réponses par manche : le TITRE et l'ARTISTE, trouvables séparément.
 */
class BlindTest extends BaseGame {
  constructor(room, options) {
    super(room, options);
    this.tracks = shuffle(options.tracks || []).slice(0, options.rounds || 10);
    this.roundSeconds = Math.min(90, Math.max(10, options.roundSeconds || 30));
    this.mode = options.mode || 'both'; // 'title' | 'artist' | 'both'
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
    this.nextRound();
  }

  nextRound() {
    this.roundIndex++;
    if (this.roundIndex >= this.totalRounds) return this.finish();

    const track = this.tracks[this.roundIndex];
    this.round = {
      track,
      // fraction de la piste où démarrer : le client multiplie par la durée réelle,
      // ce qui donne le même point de départ pour tout le monde
      startFraction: 0.12 + Math.random() * 0.3,
      startedAt: null,
      found: new Map(), // playerId → { title: ms|null, artist: ms|null, done: bool }
      firstTitle: null,
      firstArtist: null,
      skipVotes: new Set(),
    };

    this.setPhase('countdown', COUNTDOWN_MS);
    this.sync();

    this.after(COUNTDOWN_MS, () => {
      if (!this.round) return;
      this.round.startedAt = Date.now();
      this.setPhase('playing', this.roundSeconds * 1000);
      this.sync();
      this.hintTimer = this.every(1000, () => this.tickHints());
      this.after(this.roundSeconds * 1000, () => this.reveal('temps écoulé'));
    });
  }

  /** Dévoile progressivement les lettres restantes (comme un chrono d'indices). */
  tickHints() {
    if (this.phase !== 'playing' || !this.round) return;
    const elapsed = Date.now() - this.round.startedAt;
    const ratio = elapsed / (this.roundSeconds * 1000);
    // rafraîchit l'état uniquement quand un nouvel indice apparaît (toutes les ~20 %)
    const step = Math.floor(ratio / 0.2);
    if (step !== this._lastHintStep) {
      this._lastHintStep = step;
      if (step > 0) this.sync();
    }
  }

  hintRatio() {
    if (!this.round || !this.round.startedAt) return 0;
    const ratio = (Date.now() - this.round.startedAt) / (this.roundSeconds * 1000);
    if (ratio < 0.4) return 0;
    if (ratio < 0.6) return 0.2;
    if (ratio < 0.8) return 0.35;
    return 0.5;
  }

  /* ─── Actions des joueurs ─────────────────────────────── */

  handle(playerId, action, payload = {}) {
    if (action === 'guess') return this.onGuess(playerId, payload.text);
    if (action === 'skip') return this.onSkipVote(playerId);
  }

  onGuess(playerId, text) {
    if (this.phase !== 'playing' || !this.round) return;
    const guess = String(text || '').trim().slice(0, 80);
    if (!guess) return;

    const entry = this.round.found.get(playerId) || { title: null, artist: null };
    const { track } = this.round;
    const elapsed = Date.now() - this.round.startedAt;
    let gained = 0;
    const hits = [];

    const wantTitle = this.mode !== 'artist';
    const wantArtist = this.mode !== 'title';

    if (wantTitle && entry.title === null && matchesAny(guess, track.acceptTitles)) {
      entry.title = elapsed;
      const first = this.round.firstTitle === null;
      if (first) this.round.firstTitle = playerId;
      gained += this.points(elapsed, first);
      hits.push('titre');
    }
    if (wantArtist && entry.artist === null && matchesAny(guess, track.acceptArtists)) {
      entry.artist = elapsed;
      const first = this.round.firstArtist === null;
      if (first) this.round.firstArtist = playerId;
      gained += this.points(elapsed, first);
      hits.push('artiste');
    }

    this.round.found.set(playerId, entry);

    if (gained > 0) {
      this.addScore(playerId, gained);
      const p = this.player(playerId);
      this.room.emit('blindtest:hit', { playerId, name: p.name, hits, points: gained });
      this.toPlayer(playerId, 'blindtest:feedback', { ok: true, hits, points: gained });

      const complete =
        (!wantTitle || entry.title !== null) && (!wantArtist || entry.artist !== null);
      if (complete) entry.done = true;

      this.sync();
      if (this.everyoneDone()) this.reveal('tout le monde a trouvé');
    } else {
      // petit retour visuel « chaud / froid » sans révéler la réponse
      const close = this.isWarm(guess, track);
      this.toPlayer(playerId, 'blindtest:feedback', { ok: false, warm: close });
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

  points(elapsedMs, isFirst) {
    const total = this.roundSeconds * 1000;
    const speed = Math.max(0, 1 - elapsedMs / total);
    return Math.round(60 + 90 * speed) + (isFirst ? 25 : 0);
  }

  everyoneDone() {
    const players = this.room.connectedPlayers();
    if (!players.length) return false;
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
    const { track, found } = this.round;

    this.history.push({
      round: this.roundIndex + 1,
      title: track.title,
      artist: track.artist,
      videoId: track.videoId,
      finders: [...found.entries()]
        .filter(([, v]) => v.title !== null || v.artist !== null)
        .map(([id, v]) => ({ id, name: this.player(id) ? this.player(id).name : '?', ...v })),
    });

    this.setPhase('reveal', REVEAL_MS);
    this.room.emit('blindtest:reveal', { reason, track: { title: track.title, artist: track.artist, videoId: track.videoId, thumbnail: track.thumbnail } });
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
      ranking: this.ranking(),
    };

    if (this.phase === 'results') {
      return { ...base, history: this.history };
    }
    if (!this.round) return base;

    const entry = this.round.found.get(playerId) || {};
    const revealAll = this.phase === 'reveal';
    const ratio = this.hintRatio();
    const { track } = this.round;

    return {
      ...base,
      video:
        this.phase === 'playing' || this.phase === 'reveal'
          ? { id: track.videoId, startFraction: this.round.startFraction, startedAt: this.round.startedAt }
          : null,
      you: {
        title: entry.title !== null && entry.title !== undefined,
        artist: entry.artist !== null && entry.artist !== undefined,
      },
      hint: {
        title: revealAll || entry.title != null ? track.title : maskAnswer(track.title, ratio),
        artist: revealAll || entry.artist != null ? track.artist : maskAnswer(track.artist, ratio),
      },
      revealed: revealAll ? { title: track.title, artist: track.artist, thumbnail: track.thumbnail } : null,
      foundCount: [...this.round.found.values()].filter((v) => v.done).length,
      skipVotes: this.round.skipVotes.size,
      skipNeeded: Math.ceil(this.room.connectedPlayers().length / 2),
      youVotedSkip: this.round.skipVotes.has(playerId),
    };
  }
}

module.exports = BlindTest;
