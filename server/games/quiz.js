'use strict';
const BaseGame = require('./base');
const { matchesAny, shuffle, maskAnswer } = require('../util');
const { QUESTIONS } = require('../data/questions');

const REVEAL_MS = 5000;
const COUNTDOWN_MS = 3000;

/**
 * Quiz culture G « à la PopSauce » : tout le monde tape la réponse en même temps,
 * le plus rapide marque le plus de points, et la réponse se dévoile lettre par lettre.
 */
class Quiz extends BaseGame {
  constructor(room, options) {
    super(room, options);
    const pool = options.categories && options.categories.length
      ? QUESTIONS.filter((q) => options.categories.includes(q.c))
      : QUESTIONS;
    const custom = (options.customQuestions || []).map((q) => ({ c: 'Perso', q: q.q, a: q.a }));
    this.questions = shuffle([...pool, ...custom]).slice(0, options.rounds || 12);
    this.roundSeconds = Math.min(60, Math.max(8, options.roundSeconds || 25));
    this.roundIndex = -1;
    this.round = null;
    this.history = [];
  }

  get totalRounds() {
    return this.questions.length;
  }

  start() {
    if (!this.questions.length) {
      this.room.toast('Aucune question disponible avec ces catégories.', 'error');
      this.room.stopGame();
      return;
    }
    this.nextRound();
  }

  nextRound() {
    this.roundIndex++;
    if (this.roundIndex >= this.totalRounds) return this.finish();

    this.round = {
      question: this.questions[this.roundIndex],
      startedAt: null,
      answers: new Map(), // playerId → { ms, points, correct }
      order: [],
    };
    this._lastHintStep = null;

    this.setPhase('countdown', COUNTDOWN_MS);
    this.sync();

    this.after(COUNTDOWN_MS, () => {
      if (!this.round) return;
      this.round.startedAt = Date.now();
      this.setPhase('playing', this.roundSeconds * 1000);
      this.sync();
      this.every(1000, () => this.tickHints());
      this.after(this.roundSeconds * 1000, () => this.reveal('temps écoulé'));
    });
  }

  tickHints() {
    if (this.phase !== 'playing') return;
    const step = Math.floor(this.hintRatio() * 100);
    if (step !== this._lastHintStep) {
      this._lastHintStep = step;
      this.sync();
    }
  }

  /** Après 35 % du temps, on commence à dévoiler des lettres. */
  hintRatio() {
    if (!this.round || !this.round.startedAt) return 0;
    const r = (Date.now() - this.round.startedAt) / (this.roundSeconds * 1000);
    if (r < 0.35) return 0;
    if (r < 0.55) return 0.2;
    if (r < 0.75) return 0.35;
    if (r < 0.9) return 0.5;
    return 0.65;
  }

  handle(playerId, action, payload = {}) {
    if (action === 'guess') return this.onGuess(playerId, payload.text);
  }

  onGuess(playerId, text) {
    if (this.phase !== 'playing' || !this.round) return;
    if (this.round.answers.has(playerId)) return;

    const guess = String(text || '').trim().slice(0, 60);
    if (!guess) return;

    if (!matchesAny(guess, this.round.question.a)) {
      this.toPlayer(playerId, 'quiz:feedback', { ok: false });
      return;
    }

    const ms = Date.now() - this.round.startedAt;
    const rank = this.round.order.length;
    const points = this.points(ms, rank);
    this.round.answers.set(playerId, { ms, points, correct: true });
    this.round.order.push(playerId);
    this.addScore(playerId, points);

    const p = this.player(playerId);
    this.room.emit('quiz:hit', { playerId, name: p.name, rank: rank + 1, points, ms });
    this.toPlayer(playerId, 'quiz:feedback', { ok: true, points, rank: rank + 1 });
    this.sync();

    if (this.round.order.length >= this.room.connectedPlayers().length) {
      this.reveal('tout le monde a répondu');
    }
  }

  points(ms, rank) {
    const speed = Math.max(0, 1 - ms / (this.roundSeconds * 1000));
    const base = Math.round(50 + 100 * speed);
    const podium = [30, 18, 10][rank] || 0;
    return base + podium;
  }

  reveal(reason) {
    if (this.phase !== 'playing') return;
    this.clearTimers();
    const q = this.round.question;
    this.history.push({
      round: this.roundIndex + 1,
      question: q.q,
      answer: q.a[0],
      category: q.c,
      winners: this.round.order.map((id, i) => ({
        rank: i + 1,
        name: this.player(id) ? this.player(id).name : '?',
        ms: this.round.answers.get(id).ms,
      })),
    });

    this.setPhase('reveal', REVEAL_MS);
    this.room.emit('quiz:reveal', { reason, answer: q.a[0] });
    this.sync();
    this.after(REVEAL_MS, () => this.nextRound());
  }

  finish() {
    this.clearTimers();
    this.setPhase('results');
    this.sync();
  }

  stateFor(playerId) {
    const base = {
      key: 'quiz',
      phase: this.phase,
      deadline: this.deadline,
      serverNow: Date.now(),
      round: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      ranking: this.ranking(),
    };
    if (this.phase === 'results') return { ...base, history: this.history };
    if (!this.round) return base;

    const q = this.round.question;
    const mine = this.round.answers.get(playerId);
    const solved = this.phase === 'reveal' || Boolean(mine);

    return {
      ...base,
      category: q.c,
      question: q.q,
      hint: solved ? q.a[0] : maskAnswer(q.a[0], this.hintRatio()),
      answerLength: q.a[0].length,
      solved,
      you: mine ? { points: mine.points, ms: mine.ms } : null,
      revealed: this.phase === 'reveal' ? q.a[0] : null,
      board: this.round.order.map((id, i) => ({
        rank: i + 1,
        id,
        name: this.player(id) ? this.player(id).name : '?',
        ms: this.round.answers.get(id).ms,
        points: this.round.answers.get(id).points,
      })),
      answeredCount: this.round.order.length,
      playerCount: this.room.connectedPlayers().length,
    };
  }
}

module.exports = Quiz;
