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
    // Ceux qui regardent sans jouer. Ils reçoivent le même état que les
    // autres, mais construit pour un identifiant qui n'est à aucune place :
    // les mains, les mots et les rôles ne les atteignent donc jamais.
    this.watchers = new Map();  // id → { id, name, avatar, sockets:Set }
    this.hostId = null;
    this.phase = 'lobby';
    this.chat = [];
    this.createdAt = Date.now();
    this.closeTimer = null;
    this.private = false;

    // Quand ce salon est une manche de soirée : le code de la soirée, et
    // l'organisateur à qui la casquette d'hôte est réservée.
    this.soiree = null;
    this.reserveHost = null;

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
    // Une manche de soirée réserve la casquette d'hôte à l'organisateur :
    // sans ça, elle irait au premier navigateur à répondre, et le hasard du
    // réseau déciderait de qui lance la manche suivante.
    if (this.reserveHost && this.reserveHost === player.id) {
      this.hostId = player.id;
      this.reserveHost = null;
    }

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

  /* ─── Les spectateurs ───────────────────────────────────
   *
   * On peut déjà regarder une table de blackjack sans jouer ; il n'y avait
   * aucune raison que les jeux Party fassent exception. C'est même là que
   * ça compte le plus : une partie de Monopoly dure trois quarts d'heure,
   * et le copain qui arrive en cours de route n'a rien à faire d'autre que
   * d'attendre.
   *
   * Un spectateur ne prend pas de place, ne bloque pas le lancement, et
   * n'empêche pas un salon de se fermer quand tout le monde est parti.
   */

  watch(user, socketId) {
    if (this.playerOf(user.id)) return { ok: false, message: 'Tu es déjà à cette table.' };
    let w = this.watchers.get(user.id);
    if (!w) {
      w = { id: user.id, name: user.name, avatar: user.avatar || null, sockets: new Set() };
      this.watchers.set(user.id, w);
    }
    w.sockets.add(socketId);
    clearTimeout(this.closeTimer);
    this.closeTimer = null;
    return { ok: true, watcher: w };
  }

  unwatch(userId, socketId = null) {
    const w = this.watchers.get(userId);
    if (!w) return false;
    if (socketId) w.sockets.delete(socketId);
    else w.sockets.clear();
    if (!w.sockets.size) this.watchers.delete(userId);
    this.scheduleClose();
    return true;
  }

  /** Envoie l'état à tous ceux qui regardent, sous un événement donné. */
  broadcastWatchers(event) {
    for (const w of this.watchers.values()) {
      if (!w.sockets.size) continue;
      const state = this.stateFor(w.id);
      state.watching = true;
      for (const socketId of w.sockets) this.io.to(socketId).emit(event, state);
    }
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
    // Un salon que quelqu'un regarde encore n'est pas un salon vide.
    if ([...this.watchers.values()].some((w) => w.sockets.size)) return;
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
      watchers: [...this.watchers.values()]
        .filter((w) => w.sockets.size)
        .map((w) => ({ id: w.id, name: w.name, avatar: w.avatar })),
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

  /**
   * LE CLASSEMENT DE LA PARTIE, POUR LA SOIRÉE.
   *
   * Une soirée enchaîne des jeux qui ne comptent pas du tout pareil : des
   * points à l'Uno, des jetons au poker, une fortune au Monopoly, et rien
   * du tout au Loup-garou où on gagne en équipe. Plutôt que d'apprendre à
   * la soirée les règles de chaque jeu, chaque jeu répond ici à une seule
   * question : « qui est devant qui ? ».
   *
   * Le score renvoyé ne sert qu'à trier. Sa valeur n'a aucune importance :
   * la soirée ne regarde que l'ordre et les égalités.
   *
   * Par défaut — et c'est ce qui convient aux jeux d'équipe — les gagnants
   * sont premiers ex æquo, tous les autres derrière.
   */
  ranking() {
    const won = new Set(this.winners());
    return this.players.map((p) => ({ id: p.id, score: won.has(p.id) ? 1 : 0 }));
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
      // On peut regarder une partie commencée, même quand on ne peut plus
      // y entrer. C'est tout l'intérêt.
      watchable: this.phase !== 'lobby' && this.phase !== 'over' && !this.private,
      watchers: [...this.watchers.values()].filter((w) => w.sockets.size).length,
      private: this.private,
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   LA SAUVEGARDE DES SALONS

   Les salons vivaient uniquement en mémoire : chaque redéploiement tuait
   toutes les parties en cours. Un Uno de quinze minutes, ça passe. Un
   Monopoly de quarante-cinq, non — et sur Render on redéploie à chaque
   `git push`.

   On écrit donc l'état de chaque salon dans l'état du site, toutes les
   quinze secondes et à l'arrêt, et on le relit au démarrage.

   COMMENT C'EST GÉNÉRIQUE
   ───────────────────────
   On ne recopie pas champ par champ le contenu de cinq jeux : on sérialise
   TOUTES les propriétés du salon, en convertissant les `Map` en tableaux,
   et en sautant celles qui n'ont aucun sens une fois écrites — la socket
   du serveur, les minuteurs, les fonctions de rappel. Chaque jeu déclare
   simplement quelles de ses propriétés sont des `Map` (`static MAPS`), et
   ce qu'il faut faire pour reprendre la partie (`resume()`).

   Un jeu qui n'a rien déclaré est quand même sauvegardé : il repartira au
   pire à son salon d'attente, ce qui vaut toujours mieux que rien.

   CE QUI NE SURVIT PAS, ET C'EST VOULU
   ────────────────────────────────────
   Les connexions. Après un redémarrage, tout le monde est marqué absent
   avec sa place gardée ; chacun se rebranche en revenant sur la page, et
   retrouve exactement ses cartes. C'est déjà ce qui se passe quand
   quelqu'un perd le Wi-Fi — on réutilise le même chemin plutôt que d'en
   inventer un second.
   ═══════════════════════════════════════════════════════════════════════ */

/** Ce qui n'a aucun sens une fois écrit sur disque. */
// `credited` EST sauvegardé exprès : c'est le drapeau qui empêche de payer
// deux fois la même partie, et il doit survivre au redémarrage.
const NOT_SAVED = new Set(['io', 'timer', 'closeTimer', 'onEnd', 'onProfile']);

function serialize(room) {
  const out = { __maps: [], __sets: [] };
  for (const [key, value] of Object.entries(room)) {
    if (NOT_SAVED.has(key) || typeof value === 'function') continue;
    if (value instanceof Map) { out[key] = [...value.entries()]; out.__maps.push(key); continue; }
    // Les `Set` étaient écrits en tableau et relus en tableau : au retour,
    // `alive.has(...)` n'existait plus et la partie ne redémarrait pas. On
    // note leur nom au même titre que celui des `Map`.
    if (value instanceof Set) { out[key] = [...value]; out.__sets.push(key); continue; }
    out[key] = value;
  }
  // Les sockets d'un joueur ne se sauvegardent pas : personne n'est
  // connecté de l'autre côté d'un redémarrage.
  out.players = room.players.map((p) => ({ ...p, sockets: [], connected: false }));
  // Personne ne regarde de l'autre côté d'un redémarrage.
  out.watchers = [];
  return out;
}

function hydrate(room, data) {
  // Le constructeur a déjà réservé un code au hasard : on le rend avant de
  // reprendre le vrai.
  rooms.delete(room.code);
  const maps = new Set(data.__maps || []);
  const sets = new Set(data.__sets || []);
  for (const [key, value] of Object.entries(data)) {
    if (key === '__maps' || key === '__sets' || key === 'players') continue;
    if (maps.has(key)) room[key] = new Map(value);
    else if (sets.has(key)) room[key] = new Set(value);
    else room[key] = value;
  }
  room.players = (data.players || []).map((p) => ({ ...p, sockets: new Set(), connected: false }));
  room.watchers = new Map();
  room.timer = null;
  room.closeTimer = null;
  rooms.set(room.code, room);
  return room;
}

/** Tous les salons, prêts à être écrits dans l'état du site. */
function saveAll() {
  return [...rooms.values()]
    // Un salon d'attente vide ne mérite pas de survivre à un redémarrage.
    .filter((r) => r.phase !== 'lobby' || r.players.length > 0)
    .map((r) => ({ game: r.game, data: serialize(r) }));
}

/**
 * Reconstruit les salons sauvegardés. `builders` associe l'identifiant
 * d'un jeu à une fabrique — la même table que celle du serveur, pour
 * qu'un jeu supprimé du code ne fasse pas planter le démarrage.
 */
function restoreAll(saved, builders) {
  let restored = 0;
  for (const entry of saved || []) {
    const build = builders[entry.game];
    if (!build || !entry.data) continue;
    let room = null;
    try {
      room = build();
      hydrate(room, entry.data);
      // Le salon reprend là où il en était : minuteur réarmé à neuf, parce
      // qu'être éliminé par un déploiement serait la pire des injustices.
      if (typeof room.resume === 'function') room.resume();
      // Personne n'est connecté au sortir d'un redémarrage : on arme le
      // minuteur de fermeture comme pour n'importe quel salon vide. Sans
      // ça, une partie abandonnée avant le déploiement resterait
      // éternellement dans la liste.
      room.scheduleClose();
      restored += 1;
    } catch (err) {
      console.error('[party] salon non restauré :', err.message);
      // Un salon à moitié reconstruit ne reste pas dans le registre : sinon
      // il continue d'exister, de s'afficher dans la liste, et ses minuteurs
      // relancent la même erreur toutes les trente secondes jusqu'au
      // prochain redémarrage.
      if (room) {
        clearTimeout(room.timer);
        clearTimeout(room.closeTimer);
        rooms.delete(room.code);
      }
    }
  }
  return restored;
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

module.exports = { Room, rooms, get, list, roomOf, makeCode, CHAT_HISTORY, saveAll, restoreAll };
