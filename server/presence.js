'use strict';
/**
 * Présence : qui est connecté au site, et ce qu'il est en train de faire.
 * Sert à alimenter la colonne de droite (« EN LIGNE »).
 *
 * Un même joueur peut avoir plusieurs onglets ouverts : on compte les sockets
 * et on ne le retire de la liste que quand le dernier se ferme.
 */
const store = require('./store');

const STATUS_LABEL = {
  home: 'Dans le hall',
  mine: 'À la mine',
  plinko: 'Au Plinko',
  roulette: 'À la roulette',
  blackjack: 'Au blackjack',
  vault: 'Aux caisses',
  slots: 'À la machine à sous',
  medals: 'Au mur des médailles',
  market: 'Au marché',
  party: 'Dans le hall Party',
  undercover: 'À l’Undercover',
  poker: 'Au poker',
  uno: 'À l’Uno',
  belote: 'À la belote',
  monopoly: 'Au Monopoly',
  loup: 'Au Loup-garou',
  blindtest: 'Au blindtest',
  admin: 'Au panel admin',
};

class Presence {
  constructor(io) {
    this.io = io;
    this.users = new Map(); // userId → { user, profile, status, sockets:Set, since }
    this.pending = null;
  }

  join(socket, user, profile) {
    let entry = this.users.get(user.id);
    if (!entry) {
      entry = { user, profile, status: 'home', sockets: new Set(), since: Date.now() };
      this.users.set(user.id, entry);
    }
    entry.user = user;
    entry.profile = profile;
    entry.sockets.add(socket.id);
    this.schedule();
  }

  leave(socket, userId) {
    const entry = this.users.get(userId);
    if (!entry) return;
    entry.sockets.delete(socket.id);
    if (!entry.sockets.size) this.users.delete(userId);
    this.schedule();
  }

  setStatus(userId, status) {
    const entry = this.users.get(userId);
    if (!entry || entry.status === status) return;
    entry.status = status;
    this.schedule();
  }

  list() {
    return [...this.users.values()]
      .map((e) => {
        const lvl = store.levelFromXp(e.profile.xp);
        return {
          id: e.user.id,
          name: e.user.name,
          avatar: e.user.avatar,
          provider: e.user.provider,
          level: lvl.level,
          title: store.rankTitle(lvl.level),
          coins: (e.profile.vault && e.profile.vault.coins) || 0,
          status: e.status,
          statusLabel: STATUS_LABEL[e.status] || 'En ligne',
          since: e.since,
        };
      })
      .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  }

  /** Diffusion groupée : plusieurs changements rapprochés = un seul envoi. */
  schedule() {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.io.emit('online:list', { online: this.list() });
    }, 150);
  }
}

module.exports = { Presence, STATUS_LABEL };
