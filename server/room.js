'use strict';
const { shuffle } = require('./util');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sans I ni O (confusion avec 1 et 0)
const rooms = new Map();

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const DEFAULT_SETTINGS = {
  blindtest: { rounds: 10, roundSeconds: 30, playlistUrl: '', mode: 'both' }, // mode: title | artist | both
  quiz: { rounds: 12, roundSeconds: 25, categories: [] },
  undercover: { undercoverCount: 1, mrWhite: 1, descriptionSeconds: 45, voteSeconds: 40 },
};

class Room {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.hostId = null;
    this.players = new Map(); // userId → player
    this.chat = [];
    this.game = null;
    this.gameKey = null;
    this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    this.createdAt = Date.now();
    this.emptySince = null;
  }

  /* ─── Joueurs ─────────────────────────────────────────── */

  addPlayer(user, socketId) {
    const existing = this.players.get(user.id);
    if (existing) {
      existing.socketId = socketId;
      existing.connected = true;
      existing.name = user.name;
      existing.avatar = user.avatar;
    } else {
      this.players.set(user.id, {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        provider: user.provider,
        socketId,
        connected: true,
        score: 0,
        totalScore: 0,
        joinedAt: Date.now(),
      });
    }
    if (!this.hostId || !this.players.get(this.hostId)?.connected) {
      this.hostId = this.hostId && this.players.has(this.hostId) ? this.hostId : user.id;
    }
    this.emptySince = null;
    return this.players.get(user.id);
  }

  removePlayer(userId) {
    const p = this.players.get(userId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    // Pendant une partie on garde le joueur (reconnexion possible), sinon on le retire.
    if (!this.game) this.players.delete(userId);
    if (this.hostId === userId) {
      const next = this.playerList().find((x) => x.connected);
      this.hostId = next ? next.id : this.hostId;
    }
    if (!this.playerList().some((x) => x.connected)) this.emptySince = Date.now();
  }

  playerList() {
    return [...this.players.values()];
  }
  connectedPlayers() {
    return this.playerList().filter((p) => p.connected);
  }
  isHost(userId) {
    return this.hostId === userId;
  }

  /* ─── Diffusion ───────────────────────────────────────── */

  publicRoom() {
    return {
      code: this.code,
      hostId: this.hostId,
      gameKey: this.gameKey,
      settings: this.settings,
      players: this.playerList()
        .map((p) => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          provider: p.provider,
          connected: p.connected,
          score: p.score,
          totalScore: p.totalScore,
        }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    };
  }

  /** Envoie l'état à tout le monde ; chaque joueur reçoit sa vue personnalisée du jeu. */
  broadcast() {
    const base = this.publicRoom();
    for (const p of this.connectedPlayers()) {
      this.io.to(p.socketId).emit('room:state', {
        room: base,
        you: p.id,
        game: this.game ? this.game.stateFor(p.id) : null,
      });
    }
  }

  emit(event, payload) {
    this.io.to('room:' + this.code).emit(event, payload);
  }

  toast(message, kind = 'info') {
    this.emit('toast', { message, kind });
  }

  pushChat(entry) {
    this.chat.push({ ...entry, at: Date.now() });
    if (this.chat.length > 120) this.chat.shift();
    this.emit('chat:message', this.chat[this.chat.length - 1]);
  }

  /* ─── Cycle de jeu ────────────────────────────────────── */

  startGame(GameClass, key, options) {
    this.stopGame(false);
    for (const p of this.players.values()) p.score = 0;
    this.gameKey = key;
    this.game = new GameClass(this, options);
    this.game.start();
    this.broadcast();
  }

  stopGame(broadcast = true) {
    if (this.game) {
      this.game.stop();
      // les points de la partie s'ajoutent au score cumulé de la session
      for (const p of this.players.values()) p.totalScore += p.score;
      this.game = null;
      this.gameKey = null;
    }
    if (broadcast) this.broadcast();
  }

  shufflePlayers() {
    return shuffle(this.connectedPlayers());
  }
}

function createRoom(io) {
  const code = makeCode();
  const room = new Room(code, io);
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase().trim());
}

/** Nettoyage : supprime les salons vides depuis plus de 15 minutes. */
function startJanitor() {
  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (room.emptySince && now - room.emptySince > 15 * 60 * 1000) {
        room.stopGame(false);
        rooms.delete(code);
      }
    }
  }, 60 * 1000).unref();
}

module.exports = { Room, createRoom, getRoom, rooms, startJanitor, DEFAULT_SETTINGS };
