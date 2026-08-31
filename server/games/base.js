'use strict';

/**
 * Classe de base des mini-jeux.
 * Chaque jeu gère ses propres phases et minuteurs ; la salle ne connaît que
 * start() / stop() / handle() / stateFor().
 */
class BaseGame {
  constructor(room, options = {}) {
    this.room = room;
    this.io = room.io;
    this.options = options;
    this.timers = new Set();
    this.phase = 'idle';
    this.deadline = null; // timestamp de fin de phase, pour le compte à rebours côté client
  }

  /* ─── Minuteurs sûrs (tous nettoyés à l'arrêt) ─────────── */

  after(ms, fn) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      try {
        fn();
      } catch (err) {
        console.error('[game] erreur de minuteur :', err);
      }
    }, ms);
    this.timers.add(t);
    return t;
  }

  every(ms, fn) {
    const t = setInterval(() => {
      try {
        fn();
      } catch (err) {
        console.error('[game] erreur d\'intervalle :', err);
      }
    }, ms);
    this.timers.add(t);
    return t;
  }

  clearTimers() {
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timers.clear();
  }

  setPhase(phase, durationMs = null) {
    this.phase = phase;
    this.deadline = durationMs ? Date.now() + durationMs : null;
  }

  /* ─── À surcharger ────────────────────────────────────── */

  start() {}
  handle(/* playerId, action, payload */) {}
  stateFor(/* playerId */) {
    return { phase: this.phase };
  }

  stop() {
    this.clearTimers();
    this.phase = 'over';
  }

  /* ─── Utilitaires communs ─────────────────────────────── */

  player(id) {
    return this.room.players.get(id);
  }
  addScore(id, points) {
    const p = this.player(id);
    if (p) p.score += points;
  }
  sync() {
    this.room.broadcast();
  }
  toPlayer(id, event, payload) {
    const p = this.player(id);
    if (p && p.socketId) this.io.to(p.socketId).emit(event, payload);
  }
  ranking() {
    return this.room
      .playerList()
      .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
  }
}

module.exports = BaseGame;
