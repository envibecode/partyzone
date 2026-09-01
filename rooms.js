'use strict';
/**
 * LES SALONS PARTY.
 *
 * Tous les jeux de la section Party partagent la même mécanique de salon :
 * un code à quatre lettres, un hôte, une liste de joueurs, un chat, et une
 * salle Socket.IO pour la diffusion. Seules les règles changent d'un jeu à
 * l'autre — ce fichier s'occupe de tout le reste, une fois pour toutes.
 *
 * Deux principes qu'on ne change pas :
 *
 *  • L'hôte n'est pas un privilège, c'est une corvée : il lance la partie.
 *    S'il s'en va, la casquette passe au suivant plutôt que de fermer le
 *    salon et de gâcher la soirée de tout le monde.
 *
 *  • Une déconnexion n'élimine personne. Le joueur est marqué absent, sa
 *    place est gardée, et il retrouve son rôle en revenant. Les coupures
 *    Wi-Fi ne devraient jamais décider d'une partie.
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sans I ni O : trop proches de 1 et 0
const CHAT_HISTORY = 40;
const CHAT_MAX = 200;
const EMPTY_ROOM_MS = 3 * 60 * 1000; // un salon vide se ferme au bout de trois minutes

/** Tous les salons de tous les jeux Party, par code. */
const rooms = new Map();

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

class Room {
  /**
   * @param {object} opts
   * @param {string} opts.game    identifiant du jeu ('undercover', 'poker'…)
   * @param {number} opts.min     joueurs minimum pour lancer
   * @param {number} opts.max     joueurs maximum
   */
  constructor(io, { game, min, max, name }) {
    this.io = io;
    this.game = game;
    this.gameName = name;
    this.min = min;
    this.max = max;

    this.code = makeCode();
    this.players = [];      // { id, name, avatar, cosmetics, connected, sockets:Set, ... }
    this.hostId = null;
    this.phase = 'lobby';
    this.chat = [];
    this.createdAt = Date.now();
    this.closeTimer = null;
    this.private = false;

    // La partie peut se terminer sur un minuteur, pas seulement sur une
    // action : le serveur pose ici de quoi être prévenu dans tous les cas.
    this.onEnd = null;

    rooms.set(this.code, this);
  }

  /* ─── La salle Socket.IO ─── */

  get channel() {
    return `party:${this.code}`;
  }

  emit(event, payload) {
    this.io.to(this.channel).emit(event, payload);
  }

  /** Envoie un message à un seul joueur, sur tous ses onglets ouverts. */
  emitTo(playerId, event, payload) {
    const player = this.playerOf(playerId);
    if (!player) return;
    for (const socketId of player.sockets) this.io.to(socketId).emit(event, payload);
  }

  /* ─── Les joueurs ─── */

  playerOf(id) {
    return this.players.find((p) => p.id === id);
  }

  get living() {
    return this.players.filter((p) => !p.out);
  }

  get connected() {
    return this.players.filter((p) => p.connected);
  }

  /**
   * Ajoute un joueur, ou le rebranche s'il était déjà là.
   * Renvoie `{ ok, player, rejoined }`.
   */
  join(user, profile, socketId, extra = {}) {
    const existing = this.playerOf(user.id);
    if (existing) {
      existing.sockets.add(socketId);
      existing.connected = true;
      existing.name = user.name;
      existing.avatar = user.avatar;
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
      return { ok: true, player: existing, rejoined: true };
    }

    // Une partie commencée n'accepte plus de nouveaux venus : sinon un
    // arrivant connaîtrait déjà la moitié des réponses.
    if (this.phase !== 'lobby') {
      return { ok: false, message: 'La partie a déjà commencé. Attends la fin de la manche.' };
    }
    if (this.players.length >= this.max) {
      return { ok: false, message: `Ce salon est plein (${this.max} joueurs).` };
    }

    const player = {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      cosmetics: extra.cosmetics || null,
      sockets: new Set([socketId]),
      connected: true,
      ready: false,
      out: false,
      joinedAt: Date.now(),
    };
    this.players.push(player);
    if (!this.hostId) this.hostId = player.id;

    clearTimeout(this.closeTimer);
    this.closeTimer = null;
    void profile;
    return { ok: true, player, rejoined: false };
  }

  /**
   * Un onglet se ferme. Le joueur n'est retiré du salon que si c'était son
   * dernier onglet — et même là, pendant une partie il reste en place,
   * simplement marqué absent.
   */
  leaveSocket(userId, socketId) {
    const player = this.playerOf(userId);
    if (!player) return { gone: false };

    player.sockets.delete(socketId);
    if (player.sockets.size > 0) return { gone: false };

    player.connected = false;

    if (this.phase === 'lobby') {
      this.players = this.players.filter((p) => p.id !== userId);
      this.passHost(userId);
      this.scheduleClose();
      return { gone: true, removed: true };
    }

    this.passHost(userId);
    this.scheduleClose();
    return { gone: true, removed: false };
  }

  /** Sortie volontaire : là, le joueur quitte pour de bon. */
  leave(userId) {
    const player = this.playerOf(userId);
    if (!player) return false;
    this.players = this.players.filter((p) => p.id !== userId);
    this.passHost(userId);
    this.scheduleClose();
    return true;
  }

  /** La casquette d'hôte passe au premier joueur encore connecté. */
  passHost(leavingId) {
    if (this.hostId !== leavingId) return;
    const next = this.players.find((p) => p.connected) || this.players[0];
    this.hostId = next ? next.id : null;
    if (next) this.system(`${next.name} devient l’hôte du salon.`);
  }

  /** Un salon que plus personne ne regarde finit par se fermer tout seul. */
  scheduleClose() {
    clearTimeout(this.closeTimer);
    if (this.connected.length > 0) return;
    this.closeTimer = setTimeout(() => {
      if (this.connected.length === 0) this.destroy();
    }, EMPTY_ROOM_MS);
  }

  destroy() {
    clearTimeout(this.closeTimer);
    if (this.timer) clearTimeout(this.timer);
    rooms.delete(this.code);
    this.emit('party:closed', { code: this.code });
  }

  /* ─── Le chat du salon ─── */

  say(user, text) {
    const player = this.playerOf(user.id);
    if (!player) return { ok: false, message: 'Tu n’es pas dans ce salon.' };

    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!clean) return { ok: false, message: 'Message vide.' };

    // Un joueur éliminé peut continuer à parler, mais dans un canal à part :
    // sinon il souffle les réponses à ceux qui jouent encore.
    const message = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: user.name,
      avatar: user.avatar,
      text: clean,
      ghost: Boolean(player.out),
      at: Date.now(),
    };
    this.chat.push(message);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    this.emit('party:chat', message);
    return { ok: true };
  }

  system(text, kind = 'info') {
    const message = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      system: true,
      kind,
      text: String(text).slice(0, CHAT_MAX),
      at: Date.now(),
    };
    this.chat.push(message);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    this.emit('party:chat', message);
    return message;
  }

  /* ─── Ce que voit le navigateur ─── */

  /** La partie commune à tous les jeux ; chaque jeu ajoute la sienne. */
  baseState() {
    return {
      code: this.code,
      game: this.game,
      gameName: this.gameName,
      phase: this.phase,
      hostId: this.hostId,
      min: this.min,
      max: this.max,
      chat: this.chat,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        cosmetics: p.cosmetics,
        connected: p.connected,
        host: p.id === this.hostId,
        out: Boolean(p.out),
      })),
    };
  }

  /** La ligne du salon dans la liste publique. */
  listing() {
    const host = this.playerOf(this.hostId);
    return {
      code: this.code,
      game: this.game,
      gameName: this.gameName,
      host: host ? host.name : '—',
      hostAvatar: host ? host.avatar : null,
      players: this.players.length,
      max: this.max,
      min: this.min,
      phase: this.phase,
      joinable: this.phase === 'lobby' && this.players.length < this.max && !this.private,
      private: this.private,
    };
  }
}

/* ─── Le registre ───────────────────────────────────────── */

function get(code) {
  return rooms.get(String(code || '').toUpperCase());
}

/** Les salons ouverts, éventuellement filtrés sur un jeu. */
function list(game = null) {
  return [...rooms.values()]
    .filter((r) => (!game || r.game === game) && !r.private)
    .sort((a, b) => b.players.length - a.players.length || a.createdAt - b.createdAt)
    .map((r) => r.listing());
}

/** Le salon dans lequel se trouve un joueur, s'il y en a un. */
function roomOf(userId) {
  for (const room of rooms.values()) {
    if (room.playerOf(userId)) return room;
  }
  return null;
}

module.exports = { Room, rooms, get, list, roomOf, makeCode, CHAT_HISTORY };
