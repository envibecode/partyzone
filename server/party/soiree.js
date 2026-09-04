'use strict';
/**
 * LA SOIRÉE.
 *
 * Une soirée, c'est plusieurs jeux à la suite avec un seul classement. On
 * choisit deux à six jeux, on lance, et à la fin de chaque partie tout le
 * monde bascule automatiquement dans le salon du jeu suivant. Les points
 * s'additionnent, et il y a un vainqueur de la soirée — pas seulement un
 * vainqueur de l'Uno.
 *
 * POURQUOI CE N'EST PAS UN SALON
 * ──────────────────────────────
 * Un salon, c'est une partie : un code, des joueurs, des règles. La soirée
 * vit AU-DESSUS des salons — elle en ouvre un par manche et les regarde
 * finir. Si on en avait fait un salon, il aurait fallu qu'elle contienne
 * les sept jeux, et chaque nouveau jeu aurait demandé de la modifier.
 * Ici elle ne connaît qu'une chose de chaque jeu : `ranking()`.
 *
 * COMMENT ON PASSE D'UNE MANCHE À L'AUTRE
 * ───────────────────────────────────────
 * Le serveur ne déplace personne de force : il ouvre le salon suivant et
 * envoie son code à chaque joueur, dont le navigateur rejoint tout seul.
 * C'est exactement le chemin qu'emprunte quelqu'un qui tape un code à la
 * main — un seul chemin à maintenir, et rien de spécial à déboguer le jour
 * où ça coince.
 *
 * LE BARÈME
 * ─────────
 * Dix points au premier, six au deuxième, quatre, trois, deux, puis un
 * pour tous les autres. Les ex æquo touchent tous les points de la
 * meilleure place — comme au sport, on ne départage pas au hasard. Le
 * barème est volontairement resserré : gagner une manche aide, mais ne
 * suffit jamais à emporter la soirée d'avance, et être dernier partout ne
 * met pas hors course. C'est ce qui fait qu'on reste jusqu'au bout.
 */

const { makeCode } = require('./rooms');

/** Ce que rapporte une place. Au-delà, c'est un point de présence. */
const PODIUM = [10, 6, 4, 3, 2];
const TAIL = 1;

/** Deux jeux au minimum — sinon ce n'est pas une soirée, c'est une partie. */
const MIN_GAMES = 2;
const MAX_GAMES = 6;

/** Toutes les soirées en cours, par code. */
const soirees = new Map();

/**
 * Le barème appliqué à un classement.
 *
 * @param {Array<{id:string, score:number}>} ranking
 * @returns {Array<{id:string, rank:number, gained:number, score:number}>}
 */
function award(ranking) {
  const sorted = [...ranking].sort((a, b) => b.score - a.score);
  const out = [];
  let rank = 0;
  let seen = 0;
  let last = null;

  for (const entry of sorted) {
    seen += 1;
    // Un score identique au précédent = même place. On ne « rattrape » la
    // numérotation qu'au changement de score : deux premiers, puis un
    // troisième, jamais un deuxième fantôme.
    if (last === null || entry.score !== last) { rank = seen; last = entry.score; }
    out.push({
      id: entry.id,
      rank,
      score: entry.score,
      gained: rank <= PODIUM.length ? PODIUM[rank - 1] : TAIL,
    });
  }
  return out;
}

class Soiree {
  /**
   * @param {string[]} games identifiants de jeux, dans l'ordre
   * @param {string} hostId  celui qui décide de lancer chaque manche
   */
  constructor(games, hostId) {
    this.code = makeCode();
    this.games = games;
    this.hostId = hostId;
    this.step = -1;          // index de la manche en cours ; -1 = pas encore lancée
    this.roomCode = null;    // le salon de la manche en cours
    this.scores = new Map(); // userId → total
    this.names = new Map();  // userId → { name, avatar } (pour le classement)
    this.history = [];       // une entrée par manche jouée
    this.over = false;
    // Vrai entre la fin d'une manche et l'ouverture de la suivante. C'est
    // ce qui autorise le bouton « manche suivante » : sans ce drapeau,
    // l'organisateur pouvait le cliquer pendant que le salon était encore
    // au lobby et sauter une manche entière sans que personne ne joue.
    this.awaiting = false;
    this.createdAt = Date.now();
    this.result = null;

    soirees.set(this.code, this);
  }

  get game() {
    return this.games[this.step] || null;
  }

  get nextGame() {
    return this.games[this.step + 1] || null;
  }

  /** Les joueurs vus au moins une fois, du plus haut score au plus bas. */
  standings() {
    return [...this.scores.entries()]
      .map(([id, points]) => {
        const who = this.names.get(id) || {};
        return { id, name: who.name || '—', avatar: who.avatar || null, points };
      })
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  }

  /** Retient qui joue, pour pouvoir afficher un nom même après son départ. */
  remember(room) {
    for (const p of room.players) {
      this.names.set(p.id, { name: p.name, avatar: p.avatar });
      if (!this.scores.has(p.id)) this.scores.set(p.id, 0);
    }
  }

  /**
   * Une manche vient de finir : on compte.
   *
   * On ne compte qu'une fois par manche — le drapeau vit dans l'historique,
   * donc il survit à un redémarrage comme le reste.
   */
  record(room) {
    if (this.over) return false;
    if (this.history.some((h) => h.roomCode === room.code)) return false;
    if (!room.result) return false;

    this.remember(room);
    const lines = award(room.ranking()).map((line) => {
      const who = this.names.get(line.id) || {};
      this.scores.set(line.id, (this.scores.get(line.id) || 0) + line.gained);
      return { ...line, name: who.name || '—', avatar: who.avatar || null };
    });

    this.history.push({
      roomCode: room.code,
      game: room.game,
      gameName: room.gameName,
      at: Date.now(),
      table: lines,
    });

    // On compte les manches JOUÉES, pas l'index de celle qu'on croyait être
    // en train de jouer : c'est l'historique qui fait foi, et lui seul
    // survit intact à un redémarrage.
    if (this.history.length >= this.games.length) this.finish();
    else this.awaiting = true;
    return true;
  }

  /** La soirée est finie : on fige le podium. */
  finish() {
    this.over = true;
    this.awaiting = false;
    this.roomCode = null;
    const table = this.standings();
    const best = table.length ? table[0].points : 0;
    this.result = {
      table,
      // Comme partout ailleurs sur le site : une égalité en tête fait deux
      // vainqueurs plutôt qu'un tirage au sort.
      winnerIds: best > 0 ? table.filter((t) => t.points === best).map((t) => t.id) : [],
      rounds: this.history.length,
    };
  }

  /** Ce que voit le navigateur. */
  state() {
    return {
      code: this.code,
      hostId: this.hostId,
      games: this.games,
      step: this.step,
      round: this.step + 1,
      rounds: this.games.length,
      game: this.game,
      nextGame: this.nextGame,
      roomCode: this.roomCode,
      over: this.over,
      awaiting: this.awaiting,
      standings: this.standings(),
      last: this.history.length ? this.history[this.history.length - 1] : null,
      result: this.result,
    };
  }

  close() {
    soirees.delete(this.code);
  }
}

/* ─── Le registre ───────────────────────────────────────── */

function get(code) {
  return soirees.get(String(code || '').toUpperCase());
}

/** La soirée d'un salon, s'il en fait partie. */
function ofRoom(room) {
  return room && room.soiree ? get(room.soiree) : null;
}

/** La soirée d'un joueur, s'il en suit une. */
function ofPlayer(userId) {
  for (const s of soirees.values()) {
    if (!s.over && s.scores.has(userId)) return s;
  }
  return null;
}

/**
 * Nettoie les soirées finies ou abandonnées.
 *
 * Une soirée terminée reste consultable un quart d'heure — le temps de
 * regarder le classement final — puis disparaît. Une soirée dont le salon
 * s'est volatilisé sans jamais rien produire part aussi : ça arrive si tout
 * le monde ferme l'onglet avant la première manche.
 */
const KEEP_MS = 15 * 60 * 1000;
function sweep(roomsRegistry, now = Date.now()) {
  let removed = 0;
  for (const s of [...soirees.values()]) {
    const idle = now - (s.history.length ? s.history[s.history.length - 1].at : s.createdAt);
    const alive = s.roomCode && roomsRegistry.get(s.roomCode);
    if ((s.over || !alive) && idle > KEEP_MS) { s.close(); removed += 1; }
  }
  return removed;
}

/* ─── La sauvegarde ─────────────────────────────────────── */

function saveAll() {
  return [...soirees.values()].map((s) => ({
    code: s.code,
    games: s.games,
    hostId: s.hostId,
    step: s.step,
    roomCode: s.roomCode,
    scores: [...s.scores.entries()],
    names: [...s.names.entries()],
    history: s.history,
    over: s.over,
    awaiting: s.awaiting,
    createdAt: s.createdAt,
    result: s.result,
  }));
}

function restoreAll(saved) {
  let restored = 0;
  for (const data of saved || []) {
    try {
      const s = new Soiree(data.games || [], data.hostId);
      soirees.delete(s.code);
      s.code = data.code;
      s.step = data.step;
      s.roomCode = data.roomCode;
      s.scores = new Map(data.scores || []);
      s.names = new Map(data.names || []);
      s.history = data.history || [];
      s.over = Boolean(data.over);
      s.awaiting = Boolean(data.awaiting);
      s.createdAt = data.createdAt || Date.now();
      s.result = data.result || null;
      soirees.set(s.code, s);
      restored += 1;
    } catch (err) {
      console.error('[soirée] non restaurée :', err.message);
    }
  }
  return restored;
}

module.exports = {
  Soiree, soirees, get, ofRoom, ofPlayer, award, sweep,
  saveAll, restoreAll, PODIUM, TAIL, MIN_GAMES, MAX_GAMES,
};
