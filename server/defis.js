'use strict';
/**
 * LE DÉFI DIRECT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * « Toi et moi, tout de suite. »
 * ─────────────────────────────────────────────────────────────────────────
 * Ouvrir un salon et espérer que quelqu'un vienne, c'est passif. Le défi
 * est l'inverse : on désigne quelqu'un, on choisit le jeu, on pose une mise
 * si on veut, et l'autre voit arriver une invitation qu'il accepte ou pas.
 * C'est le geste le plus court entre l'envie de jouer et la partie.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'ARGENT, ET POURQUOI C'EST SANS DANGER
 * ─────────────────────────────────────────────────────────────────────────
 * Un défi peut porter une mise. Deux choses la rendent saine :
 *
 *  · ELLE EST À SOMME NULLE. Rien n'est créé, rien n'est détruit : les deux
 *    mises partent en séquestre et le pot revient entier au vainqueur. Le
 *    site ne prend pas un centime — il n'a aucune raison de pousser aux
 *    défis.
 *  · ELLE NE RAPPORTE AUCUNE XP. Le classement du mois ne bouge pas d'un
 *    point à cause d'un défi. Gagner donne de quoi jouer au casino, pas des
 *    points de classement.
 *
 * ET LE SÉQUESTRE EST PRIS À L'ACCEPTATION, pas à la fin. Sinon il suffit
 * de perdre puis de dépenser ses pièces avant la fin de la partie, et le
 * vainqueur touche du vent. Les pièces sortent des deux poches au moment où
 * la partie s'ouvre, et personne ne peut plus y toucher.
 *
 * SI LA PARTIE N'A PAS LIEU — salon fermé, joueur parti, serveur
 * redémarré —, TOUT EST RENDU. Un défi qui ne se joue pas ne coûte rien à
 * personne : c'est la seule règle qui rende le séquestre acceptable.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE MODULE NE TOUCHE PAS AUX PIÈCES
 * ─────────────────────────────────────────────────────────────────────────
 * Il tient la machine à états et rien d'autre : qui a défié qui, à quoi,
 * pour combien, et où on en est. Les mouvements de pièces se font dans
 * `index.js`, qui a les profils sous la main et sait les sauvegarder. Un
 * module qui ferait les deux serait impossible à tester sans base.
 */

const crypto = require('crypto');

/** Les jeux jouables à deux. Les autres n'ont pas de sens en duel. */
const JEUX = ['uno', 'poker', 'monopoly', 'blindtest'];

const MIN_MISE = 0;             // un défi « pour l'honneur » est un vrai défi
const MAX_MISE = 50000;
const EXPIRE_MS = 3 * 60 * 1000;   // une invitation qui traîne n'est plus une invitation
const ORPHELIN_MS = 30 * 60 * 1000; // un duel dont la partie s'est volatilisée

/** Tous les défis en cours, par identifiant. */
const defis = new Map();

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

/**
 * Crée un défi en attente.
 *
 * @returns {{ok:boolean, defi?:object, message?:string}}
 */
function create({ from, to, game, stake = 0 }, now = Date.now()) {
  if (!from || !to || from.id === to.id) {
    return { ok: false, message: 'On ne se défie pas soi-même.' };
  }
  if (!JEUX.includes(game)) {
    return { ok: false, message: 'Ce jeu ne se joue pas en duel.' };
  }

  const mise = Math.max(MIN_MISE, Math.min(MAX_MISE, Math.floor(Number(stake) || 0)));

  // Un défi déjà en attente entre ces deux-là, dans un sens ou dans
  // l'autre : on ne les empile pas. Sinon un clic nerveux envoie six
  // invitations et l'autre en refuse six.
  for (const d of defis.values()) {
    if (d.status !== 'pending') continue;
    if ((d.fromId === from.id && d.toId === to.id) || (d.fromId === to.id && d.toId === from.id)) {
      return { ok: false, message: 'Un défi est déjà en attente entre vous deux.' };
    }
  }
  if (live(from.id) || live(to.id)) {
    return { ok: false, message: 'Un duel est déjà en cours.' };
  }

  const defi = {
    id: newId(),
    fromId: from.id,
    fromName: from.name,
    fromAvatar: from.avatar || null,
    toId: to.id,
    toName: to.name,
    toAvatar: to.avatar || null,
    game,
    stake: mise,
    status: 'pending',
    at: now,
    expiresAt: now + EXPIRE_MS,
    roomCode: null,
    escrow: 0,
    result: null,
  };
  defis.set(defi.id, defi);
  return { ok: true, defi };
}

function get(id) { return defis.get(String(id || '')); }

/** Le duel EN COURS d'un joueur, s'il en a un. */
function live(userId) {
  for (const d of defis.values()) {
    if (d.status === 'live' && (d.fromId === userId || d.toId === userId)) return d;
  }
  return null;
}

/**
 * Le dernier duel TERMINÉ de ce joueur.
 *
 * Le duel disparaît de `live` au moment où il se règle, et sans ça
 * l'interface n'aurait rien à afficher au moment précis où il y a quelque
 * chose à dire : qui a gagné, et combien.
 */
function last(userId) {
  return [...defis.values()]
    .filter((d) => d.status === 'done' && d.result && (d.fromId === userId || d.toId === userId))
    .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0] || null;
}

/** Les invitations qui attendent une réponse de ce joueur. */
function inbox(userId, now = Date.now()) {
  return [...defis.values()]
    .filter((d) => d.status === 'pending' && d.toId === userId && d.expiresAt > now)
    .sort((a, b) => b.at - a.at);
}

/** Les invitations que ce joueur a envoyées et qui attendent encore. */
function outbox(userId, now = Date.now()) {
  return [...defis.values()]
    .filter((d) => d.status === 'pending' && d.fromId === userId && d.expiresAt > now)
    .sort((a, b) => b.at - a.at);
}

/**
 * L'invitation est acceptée. Le duel passe en cours et le séquestre est
 * NOTÉ — c'est l'appelant qui retire les pièces, juste après.
 */
function accept(id, byId, now = Date.now()) {
  const d = get(id);
  if (!d) return { ok: false, message: 'Ce défi n’existe plus.' };
  if (d.status !== 'pending') return { ok: false, message: 'Ce défi n’attend plus de réponse.' };
  if (d.toId !== byId) return { ok: false, message: 'Ce défi ne t’est pas adressé.' };
  if (d.expiresAt <= now) { d.status = 'expire'; return { ok: false, message: 'Ce défi a expiré.' }; }

  d.status = 'live';
  d.escrow = d.stake * 2;
  d.startedAt = now;
  return { ok: true, defi: d };
}

function decline(id, byId) {
  const d = get(id);
  if (!d || d.status !== 'pending') return { ok: false, message: 'Ce défi n’existe plus.' };
  if (d.toId !== byId && d.fromId !== byId) return { ok: false, message: 'Ce défi ne te concerne pas.' };
  d.status = byId === d.fromId ? 'annule' : 'refuse';
  return { ok: true, defi: d };
}

/** La partie du duel est ouverte. */
function attach(d, roomCode) {
  d.roomCode = roomCode;
  return d;
}

/**
 * La partie est finie : qui touche le pot ?
 *
 * Un ex æquo rend les mises. C'est plus juste que de départager à la
 * volée, et ça évite d'avoir à expliquer un jour pourquoi le site a choisi
 * l'un plutôt que l'autre.
 *
 * @returns {{winner:string|null, pot:number, refund:boolean}}
 */
function settle(d, ranking, now = Date.now()) {
  if (!d || d.status !== 'live') return null;

  const a = (ranking || []).find((r) => r.id === d.fromId);
  const b = (ranking || []).find((r) => r.id === d.toId);

  let winner = null;
  if (a && b && a.score !== b.score) winner = a.score > b.score ? d.fromId : d.toId;
  else if (a && !b) winner = d.fromId;
  else if (b && !a) winner = d.toId;

  d.status = 'done';
  d.endedAt = now;
  d.result = {
    winner,
    pot: winner ? d.escrow : 0,
    refund: !winner,
    scores: { [d.fromId]: a ? a.score : null, [d.toId]: b ? b.score : null },
  };
  return d.result;
}

/**
 * Le duel est abandonné : la partie n'aura pas lieu, ou plus.
 * Le séquestre est à rendre — l'appelant s'en charge.
 */
function abort(d, raison = 'partie annulée', now = Date.now()) {
  if (!d || d.status !== 'live') return null;
  d.status = 'done';
  d.endedAt = now;
  d.result = { winner: null, pot: 0, refund: true, raison };
  return d.result;
}

/**
 * Le ménage.
 *
 * Trois cas : les invitations périmées, les duels dont la partie a disparu
 * (à rembourser, et c'est l'appelant qui rembourse), et les défis finis
 * depuis longtemps qu'on peut oublier.
 */
function sweep(roomsRegistry, now = Date.now()) {
  const orphelins = [];
  for (const d of [...defis.values()]) {
    if (d.status === 'pending' && d.expiresAt <= now) { d.status = 'expire'; continue; }
    if (d.status === 'live') {
      const salon = d.roomCode && roomsRegistry.get(d.roomCode);
      if (!salon && now - (d.startedAt || d.at) > ORPHELIN_MS) orphelins.push(d);
      continue;
    }
    if (now - (d.endedAt || d.at) > 15 * 60 * 1000) defis.delete(d.id);
  }
  return orphelins;
}

/* ─── La sauvegarde ─────────────────────────────────────── */

/*
 * On ne sauvegarde QUE les duels en cours. Une invitation en attente ne
 * survit pas à un redémarrage, et c'est très bien : elle vaut trois
 * minutes. Un duel en cours, lui, tient des pièces en séquestre — l'oublier
 * reviendrait à les faire disparaître.
 */
function saveAll() {
  return [...defis.values()].filter((d) => d.status === 'live');
}

function restoreAll(saved) {
  let n = 0;
  for (const d of saved || []) {
    if (!d || !d.id) continue;
    defis.set(d.id, { ...d });
    n += 1;
  }
  return n;
}

module.exports = {
  create, get, live, last, inbox, outbox, accept, decline, attach, settle, abort, sweep,
  saveAll, restoreAll, defis, JEUX, MIN_MISE, MAX_MISE, EXPIRE_MS,
};
