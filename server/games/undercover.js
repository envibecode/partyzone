'use strict';
const BaseGame = require('./base');
const { shuffle, pick, matchesAny } = require('../util');
const { WORD_PAIRS } = require('../data/words');

const ROLE_REVEAL_MS = 8000;
const RESULT_MS = 6000;

/**
 * Undercover.
 *
 * Rôles : Civils (mot A), Undercover (mot B, très proche), Mr White (aucun mot).
 * Chaque manche : tour de table où chacun donne UN mot, puis vote d'élimination.
 * Si Mr White est éliminé, il tente de deviner le mot des civils pour voler la victoire.
 */
class Undercover extends BaseGame {
  constructor(room, options) {
    super(room, options);
    this.descriptionSeconds = Math.min(120, Math.max(10, options.descriptionSeconds || 45));
    this.voteSeconds = Math.min(120, Math.max(15, options.voteSeconds || 40));
    this.undercoverCount = options.undercoverCount ?? 1;
    this.mrWhiteCount = options.mrWhite ?? 1;
    this.roles = new Map(); // playerId → { role, word, alive }
    this.turnOrder = [];
    this.turnIndex = 0;
    this.roundNumber = 0;
    this.descriptions = []; // { round, playerId, name, word }
    this.votes = new Map();
    this.log = [];
    this.pendingMrWhite = null;
    this.winner = null;
  }

  /* ─── Mise en place ───────────────────────────────────── */

  start() {
    const players = this.room.shufflePlayers();
    if (players.length < 3) {
      this.room.toast('Il faut au moins 3 joueurs pour Undercover.', 'error');
      this.room.stopGame();
      return;
    }

    // On borne les rôles spéciaux : les civils doivent rester majoritaires.
    const maxSpecial = Math.max(1, Math.floor((players.length - 1) / 2));
    let nbUnder = Math.max(0, Math.min(this.undercoverCount, maxSpecial));
    let nbWhite = Math.max(0, Math.min(this.mrWhiteCount, maxSpecial - nbUnder));
    if (nbUnder + nbWhite === 0) nbUnder = 1;
    if (players.length < 4) nbWhite = 0; // Mr White à partir de 4 joueurs

    const [civilWord, underWord] = shuffle(pick(WORD_PAIRS));
    this.civilWord = civilWord;
    this.underWord = underWord;

    const roles = [
      ...Array(nbUnder).fill('undercover'),
      ...Array(nbWhite).fill('mrwhite'),
      ...Array(players.length - nbUnder - nbWhite).fill('civil'),
    ];
    const assigned = shuffle(roles);

    players.forEach((p, i) => {
      const role = assigned[i];
      this.roles.set(p.id, {
        role,
        word: role === 'civil' ? civilWord : role === 'undercover' ? underWord : null,
        alive: true,
      });
    });

    this.turnOrder = players.map((p) => p.id);
    this.counts = { undercover: nbUnder, mrwhite: nbWhite, civil: players.length - nbUnder - nbWhite };

    this.setPhase('roles', ROLE_REVEAL_MS);
    this.sync();
    this.after(ROLE_REVEAL_MS, () => this.startDescriptionRound());
  }

  /* ─── Tour de table ───────────────────────────────────── */

  alivePlayers() {
    return this.turnOrder.filter((id) => this.roles.get(id).alive && this.player(id) && this.player(id).connected);
  }

  startDescriptionRound() {
    this.roundNumber++;
    this.votes = new Map();
    // le premier à parler tourne à chaque manche, pour ne pas toujours désavantager le même
    const alive = this.alivePlayers();
    if (!alive.length) return this.finish('civils');
    const offset = (this.roundNumber - 1) % alive.length;
    this.currentOrder = [...alive.slice(offset), ...alive.slice(0, offset)];
    this.turnIndex = 0;
    this.nextTurn();
  }

  nextTurn() {
    if (this.turnIndex >= this.currentOrder.length) return this.startVote();
    const id = this.currentOrder[this.turnIndex];
    const info = this.roles.get(id);
    const p = this.player(id);
    if (!info.alive || !p || !p.connected) {
      this.turnIndex++;
      return this.nextTurn();
    }
    this.currentSpeaker = id;
    this.setPhase('describe', this.descriptionSeconds * 1000);
    this.sync();
    this.after(this.descriptionSeconds * 1000, () => {
      if (this.phase === 'describe' && this.currentSpeaker === id) {
        this.submitDescription(id, '…', true);
      }
    });
  }

  submitDescription(playerId, word, auto = false) {
    if (this.phase !== 'describe' || this.currentSpeaker !== playerId) return;
    const clean = String(word || '').trim().slice(0, 40) || '…';
    const p = this.player(playerId);
    this.descriptions.push({
      round: this.roundNumber,
      playerId,
      name: p ? p.name : '?',
      avatar: p ? p.avatar : null,
      word: clean,
      auto,
    });
    this.clearTimers();
    this.turnIndex++;
    this.currentSpeaker = null;
    this.sync();
    this.after(600, () => this.nextTurn());
  }

  /* ─── Vote ────────────────────────────────────────────── */

  startVote() {
    this.currentSpeaker = null;
    this.setPhase('vote', this.voteSeconds * 1000);
    this.sync();
    this.after(this.voteSeconds * 1000, () => this.tallyVotes());
  }

  castVote(voterId, targetId) {
    if (this.phase !== 'vote') return;
    const voter = this.roles.get(voterId);
    if (!voter || !voter.alive) return;
    if (!this.roles.get(targetId) || !this.roles.get(targetId).alive) return;
    if (targetId === voterId) return; // pas d'auto-vote
    this.votes.set(voterId, targetId);
    this.sync();
    const aliveConnected = this.alivePlayers();
    if (aliveConnected.every((id) => this.votes.has(id))) {
      this.clearTimers();
      this.after(500, () => this.tallyVotes());
    }
  }

  tallyVotes() {
    if (this.phase !== 'vote') return;
    this.clearTimers();

    const tally = new Map();
    for (const target of this.votes.values()) tally.set(target, (tally.get(target) || 0) + 1);
    let best = null;
    let bestCount = 0;
    let tie = false;
    for (const [id, count] of tally) {
      if (count > bestCount) {
        best = id;
        bestCount = count;
        tie = false;
      } else if (count === bestCount) {
        tie = true;
      }
    }

    const detail = [...tally.entries()].map(([id, count]) => ({
      id,
      name: this.player(id) ? this.player(id).name : '?',
      count,
    }));

    if (!best || tie) {
      this.lastResult = { eliminated: null, tie: true, detail };
      this.log.push({ round: this.roundNumber, text: 'Égalité au vote : personne n’est éliminé.' });
      this.setPhase('result', RESULT_MS);
      this.sync();
      return this.after(RESULT_MS, () => this.startDescriptionRound());
    }

    const info = this.roles.get(best);
    info.alive = false;
    const name = this.player(best) ? this.player(best).name : '?';
    this.lastResult = { eliminated: { id: best, name, role: info.role, word: info.word }, tie: false, detail };
    this.log.push({ round: this.roundNumber, text: `${name} est éliminé — c'était un ${this.roleLabel(info.role)}.` });

    if (info.role === 'mrwhite') {
      this.pendingMrWhite = best;
      this.setPhase('mrwhite', 30000);
      this.sync();
      return this.after(30000, () => this.resolveMrWhite(best, ''));
    }

    this.setPhase('result', RESULT_MS);
    this.sync();
    this.after(RESULT_MS, () => {
      const outcome = this.checkVictory();
      if (outcome) this.finish(outcome);
      else this.startDescriptionRound();
    });
  }

  /* ─── Mr White ────────────────────────────────────────── */

  resolveMrWhite(playerId, guess) {
    if (this.phase !== 'mrwhite' || this.pendingMrWhite !== playerId) return;
    this.clearTimers();
    this.pendingMrWhite = null;
    const correct = matchesAny(guess, [this.civilWord]);
    this.mrWhiteGuess = { guess: String(guess || '').trim() || '(rien)', correct };
    if (correct) {
      this.addScore(playerId, 250);
      this.log.push({ round: this.roundNumber, text: `Mr White a deviné « ${this.civilWord} » et vole la victoire !` });
      return this.finish('mrwhite', playerId);
    }
    this.log.push({ round: this.roundNumber, text: `Mr White s'est trompé (« ${this.mrWhiteGuess.guess} »).` });
    this.setPhase('result', RESULT_MS);
    this.sync();
    this.after(RESULT_MS, () => {
      const outcome = this.checkVictory();
      if (outcome) this.finish(outcome);
      else this.startDescriptionRound();
    });
  }

  /* ─── Conditions de victoire ──────────────────────────── */

  aliveByRole() {
    const out = { civil: 0, undercover: 0, mrwhite: 0 };
    for (const [, info] of this.roles) if (info.alive) out[info.role]++;
    return out;
  }

  checkVictory() {
    const alive = this.aliveByRole();
    const impostors = alive.undercover + alive.mrwhite;
    if (impostors === 0) return 'civils';
    if (impostors >= alive.civil) return 'imposteurs';
    return null;
  }

  finish(winner, mrWhiteId = null) {
    this.clearTimers();
    this.winner = winner;
    if (winner === 'civils') {
      for (const [id, info] of this.roles) if (info.role === 'civil') this.addScore(id, info.alive ? 120 : 60);
    } else if (winner === 'imposteurs') {
      for (const [id, info] of this.roles) if (info.role !== 'civil') this.addScore(id, 200);
    } else if (winner === 'mrwhite') {
      // points déjà attribués dans resolveMrWhite
      for (const [id, info] of this.roles) if (info.role === 'undercover') this.addScore(id, 60);
    }
    this.setPhase('over');
    this.sync();
  }

  roleLabel(role) {
    return role === 'civil' ? 'Civil' : role === 'undercover' ? 'Undercover' : 'Mr White';
  }

  /* ─── Actions ─────────────────────────────────────────── */

  handle(playerId, action, payload = {}) {
    if (action === 'describe') return this.submitDescription(playerId, payload.word);
    if (action === 'vote') return this.castVote(playerId, payload.targetId);
    if (action === 'mrwhite-guess') return this.resolveMrWhite(playerId, payload.text);
  }

  /* ─── Vue par joueur ──────────────────────────────────── */

  stateFor(playerId) {
    const mine = this.roles.get(playerId);
    const over = this.phase === 'over';

    const players = this.turnOrder.map((id) => {
      const p = this.player(id);
      const info = this.roles.get(id);
      return {
        id,
        name: p ? p.name : '?',
        avatar: p ? p.avatar : null,
        connected: p ? p.connected : false,
        alive: info.alive,
        speaking: this.currentSpeaker === id,
        voted: this.votes.has(id),
        // le rôle n'est révélé qu'à la fin, ou pour les joueurs déjà éliminés
        role: over || !info.alive ? info.role : null,
        word: over ? info.word : null,
        votesReceived:
          this.phase === 'result' && this.lastResult
            ? (this.lastResult.detail.find((d) => d.id === id) || {}).count || 0
            : undefined,
      };
    });

    return {
      key: 'undercover',
      phase: this.phase,
      deadline: this.deadline,
      serverNow: Date.now(),
      round: this.roundNumber,
      you: mine
        ? {
            role: mine.role,
            word: mine.word,
            alive: mine.alive,
            isSpeaker: this.currentSpeaker === playerId,
            isMrWhiteGuessing: this.pendingMrWhite === playerId,
            hasVoted: this.votes.has(playerId),
            votedFor: this.votes.get(playerId) || null,
          }
        : null,
      counts: this.counts,
      players,
      descriptions: this.descriptions,
      log: this.log,
      lastResult: this.phase === 'result' || over ? this.lastResult : null,
      mrWhiteGuess: this.mrWhiteGuess || null,
      pendingMrWhiteName:
        this.pendingMrWhite && this.player(this.pendingMrWhite) ? this.player(this.pendingMrWhite).name : null,
      winner: this.winner,
      words: over ? { civil: this.civilWord, undercover: this.underWord } : null,
      ranking: this.ranking(),
    };
  }
}

module.exports = Undercover;
