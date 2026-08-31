'use strict';
const BaseGame = require('./base');
const { matchesAny, shuffle, maskAnswer } = require('../util');
const { QUESTIONS } = require('../data/questions');
const { quizChoices } = require('../choices');
const difficulty = require('../difficulty');

const REVEAL_MS = 5000;
const COUNTDOWN_MS = 3000;

/**
 * Quiz culture G « à la PopSauce ».
 *
 * En QCM : quatre propositions, un seul essai, le plus rapide marque le plus.
 * En saisie : on tape la réponse et les lettres se dévoilent au fil du chrono.
 */
class Quiz extends BaseGame {
  constructor(room, options) {
    super(room, options);
    this.diff = difficulty.resolve(options.difficulty);
    this.roundSeconds = this.diff.quiz.seconds;
    this.hintFrom = this.diff.quiz.hintFrom;
    this.mult = this.diff.mult;
    this.answerMode = options.answerMode === 'choice' ? 'choice' : 'type';

    this.pool = options.categories && options.categories.length
      ? QUESTIONS.filter((q) => options.categories.includes(q.c))
      : QUESTIONS;
    if (!this.pool.length) this.pool = QUESTIONS;

    this.questions = shuffle(this.pool).slice(0, options.rounds || 12);
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

    const question = this.questions[this.roundIndex];
    const choices = this.answerMode === 'choice' ? quizChoices(question, this.pool) : null;

    this.round = {
      question,
      choices,
      correctIndex: choices ? choices.indexOf(question.a[0]) : -1,
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
      if (this.answerMode === 'type') this.every(1000, () => this.tickHints());
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

  hintRatio() {
    if (!this.round || !this.round.startedAt) return 0;
    const elapsed = (Date.now() - this.round.startedAt) / (this.roundSeconds * 1000);
    if (elapsed < this.hintFrom) return 0;
    const span = Math.max(0.001, 1 - this.hintFrom);
    const into = (elapsed - this.hintFrom) / span;
    if (into < 0.25) return 0.2;
    if (into < 0.5) return 0.35;
    if (into < 0.75) return 0.5;
    return 0.65;
  }

  handle(playerId, action, payload = {}) {
    if (action === 'guess') return this.onGuess(playerId, payload.text);
    if (action === 'pick') return this.onPick(playerId, payload.index);
  }

  /* ── QCM ── */

  onPick(playerId, rawIndex) {
    if (this.phase !== 'playing' || !this.round || this.answerMode !== 'choice') return;
    if (this.round.answers.has(playerId)) return;

    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= this.round.choices.length) return;

    const ms = Date.now() - this.round.startedAt;
    const correct = index === this.round.correctIndex;
    const rank = this.round.order.length;
    const points = correct ? this.points(ms, rank) : 0;

    this.round.answers.set(playerId, { ms, points, correct, index });
    if (correct) {
      this.round.order.push(playerId);
      this.addScore(playerId, points);
      const p = this.player(playerId);
      this.room.emit('quiz:hit', { playerId, name: p.name, rank: rank + 1, points, ms });
    }
    this.toPlayer(playerId, 'quiz:feedback', { ok: correct, points, rank: rank + 1 });

    this.sync();
    if (this.round.answers.size >= this.room.connectedPlayers().length) {
      this.reveal('tout le monde a répondu');
    }
  }

  /* ── Saisie ── */

  onGuess(playerId, text) {
    if (this.phase !== 'playing' || !this.round || this.answerMode !== 'type') return;
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
    const base = 50 + 100 * speed;
    const podium = [30, 18, 10][rank] || 0;
    return Math.round((base + podium) * this.mult);
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
      answerMode: this.answerMode,
      difficulty: { id: this.diff.id, name: this.diff.name, color: this.diff.color, mult: this.diff.mult },
      ranking: this.ranking(),
    };
    if (this.phase === 'results') return { ...base, history: this.history };
    if (!this.round) return base;

    const q = this.round.question;
    const mine = this.round.answers.get(playerId);
    const revealAll = this.phase === 'reveal';

    const common = {
      ...base,
      category: q.c,
      question: q.q,
      revealed: revealAll ? q.a[0] : null,
      board: this.round.order.map((id, i) => ({
        rank: i + 1,
        id,
        name: this.player(id) ? this.player(id).name : '?',
        ms: this.round.answers.get(id).ms,
        points: this.round.answers.get(id).points,
      })),
      answeredCount: this.round.answers.size,
      playerCount: this.room.connectedPlayers().length,
    };

    if (this.answerMode === 'choice') {
      return {
        ...common,
        choices: this.round.choices,
        correctIndex: revealAll ? this.round.correctIndex : null,
        yourPick: mine ? mine.index : null,
        yourResult: mine ? { correct: mine.correct, points: mine.points } : null,
        solved: Boolean(mine) || revealAll,
      };
    }

    const solved = revealAll || Boolean(mine);
    return {
      ...common,
      hint: solved ? q.a[0] : maskAnswer(q.a[0], this.hintRatio()),
      answerLength: q.a[0].length,
      solved,
      you: mine ? { points: mine.points, ms: mine.ms } : null,
    };
  }
}

module.exports = Quiz;
