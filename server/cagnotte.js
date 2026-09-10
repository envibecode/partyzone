'use strict';
/**
 * LA CAGNOTTE COMMUNE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TOUT LE RESTE DU SITE OPPOSE LES GENS
 * ─────────────────────────────────────────────────────────────────────────
 * Le classement, les duels, les paris, la cible : tout est fait pour qu'on
 * joue LES UNS CONTRE LES AUTRES. C'est bien, c'est le but. Mais il
 * manquait la chose que font vraiment les bandes de potes — se cotiser.
 *
 * Une cagnotte, c'est un pot commun avec un objectif affiché et un
 * bénéficiaire annoncé d'avance. Deux formes, pas une de plus :
 *
 *  · POUR QUELQU'UN — la collecte classique. « Ana a tout perdu au Plinko,
 *    on lui remet 20 000. » Le pot part chez elle dès qu'il est plein.
 *  · POUR LE VAINQUEUR DU MOIS — on met en jeu quelque chose à plusieurs.
 *    Le pot dort jusqu'à la bascule du mois, puis va au premier en XP.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TROIS RÈGLES, ET ELLES COMPTENT TOUTES
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  1. ON NE REPREND PAS SA MISE. Une cagnotte où l'on peut se retirer n'est
 *     pas une cagnotte, c'est un compte d'épargne. En échange, la règle 3
 *     protège ceux qui ont donné.
 *
 *  2. LE POT NE DÉPASSE JAMAIS L'OBJECTIF. La dernière contribution est
 *     rabotée à ce qu'il manque. Personne ne donne 10 000 pièces à un pot
 *     qui n'en avait plus besoin que de 300.
 *
 *  3. UNE CAGNOTTE QUI NE SE REMPLIT PAS EST RENDUE. Au bout de quinze
 *     jours, chacun récupère exactement ce qu'il a mis. Sans cette règle,
 *     ouvrir une cagnotte trop ambitieuse reviendrait à détruire l'argent
 *     de ses copains, et plus personne n'y mettrait un centime.
 *
 * Ce module tient les comptes ; les pièces sont déplacées par `index.js`.
 */

const MIN_PART = 100;
const MAX_BUT = 2000000;
const MIN_BUT = 1000;
const MAX_OUVERTES = 3;
const EXPIRE_MS = 15 * 24 * 3600 * 1000;

function ensure(state) {
  if (!Array.isArray(state.cagnottes)) state.cagnottes = [];
  return state.cagnottes;
}

const total = (c) => (c.parts || []).reduce((n, p) => n + p.amount, 0);
const pleine = (c) => total(c) >= c.but;

/** Ce qu'une personne a déjà mis. */
const mise = (c, id) => (c.parts || []).filter((p) => p.id === id).reduce((n, p) => n + p.amount, 0);

function ouvertes(state, now = Date.now()) {
  return ensure(state).filter((c) => !c.closed && c.at + EXPIRE_MS > now);
}

/**
 * Ouvre une cagnotte.
 *
 * @param {object} par   { id, name }
 * @param {object} opts  { titre, but, pour: { type, id, name } }
 */
function ouvrir(state, par, { titre, but, pour } = {}, now = Date.now()) {
  const liste = ensure(state);
  if (ouvertes(state, now).length >= MAX_OUVERTES) {
    return { ok: false, message: `Il y a déjà ${MAX_OUVERTES} cagnottes en cours. Une à la fois, sinon plus personne ne suit.` };
  }

  const objectif = Math.floor(Number(but) || 0);
  if (objectif < MIN_BUT || objectif > MAX_BUT) {
    return { ok: false, message: `L’objectif doit tenir entre ${MIN_BUT} et ${MAX_BUT.toLocaleString('fr-FR')} pièces.` };
  }

  const type = pour && pour.type === 'mois' ? 'mois' : 'joueur';
  if (type === 'joueur' && (!pour || !pour.id)) {
    return { ok: false, message: 'Pour qui, cette cagnotte ?' };
  }

  const nom = String(titre || '').trim().slice(0, 60);
  if (nom.length < 3) return { ok: false, message: 'Donne-lui un titre : c’est ce qui donne envie de mettre.' };

  const c = {
    id: `c${now.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    titre: nom,
    but: objectif,
    pour: type === 'mois'
      ? { type: 'mois' }
      : { type: 'joueur', id: pour.id, name: pour.name || '—' },
    parts: [],
    ouvertPar: { id: par.id, name: par.name },
    at: now,
    closed: false,
    paid: null,
  };
  liste.push(c);
  return { ok: true, cagnotte: c };
}

function get(state, id) {
  return ensure(state).find((c) => c.id === id) || null;
}

/**
 * Mettre au pot.
 *
 * Renvoie le montant RÉELLEMENT pris — raboté à ce qu'il manque pour
 * atteindre l'objectif. C'est ce montant que l'appelant retire de la bourse,
 * jamais celui demandé.
 */
function mettre(c, qui, montant, now = Date.now()) {
  if (!c || c.closed) return { ok: false, message: 'Cette cagnotte est close.' };
  if (c.at + EXPIRE_MS <= now) return { ok: false, message: 'Cette cagnotte a expiré.' };

  const reste = c.but - total(c);
  if (reste <= 0) return { ok: false, message: 'Elle est déjà pleine.' };

  const demande = Math.floor(Number(montant) || 0);
  if (demande < MIN_PART) return { ok: false, message: `Minimum ${MIN_PART} pièces.` };

  const pris = Math.min(demande, reste);
  c.parts.push({ id: qui.id, name: qui.name, amount: pris, at: now });

  return { ok: true, amount: pris, rabote: pris < demande, total: total(c), pleine: pleine(c) };
}

/**
 * La cagnotte est pleine : à qui, combien ?
 *
 * Une cagnotte « pour le vainqueur du mois » ne se verse pas ici — elle
 * attend la bascule (voir `aVerserAuMois`).
 */
function verser(c, now = Date.now()) {
  if (!c || c.closed || !pleine(c)) return null;
  if (c.pour.type === 'mois') return null;

  c.closed = true;
  c.paid = { to: c.pour.id, name: c.pour.name, amount: total(c), at: now };
  return c.paid;
}

/** Les cagnottes pleines qui attendent la fin du mois. */
function aVerserAuMois(state) {
  return ensure(state).filter((c) => !c.closed && c.pour.type === 'mois' && pleine(c));
}

/** Le mois a basculé : les cagnottes du mois partent chez le vainqueur. */
function verserAuMois(state, gagnant, now = Date.now()) {
  const versements = [];
  for (const c of aVerserAuMois(state)) {
    c.closed = true;
    c.paid = { to: gagnant.id, name: gagnant.name, amount: total(c), at: now };
    versements.push(c.paid);
  }
  return versements;
}

/**
 * Le ménage : ce qui n'a pas abouti est RENDU, part par part.
 * L'appelant rembourse ; ce module se contente de dire quoi.
 */
function sweep(state, now = Date.now()) {
  const rendus = [];
  for (const c of ensure(state)) {
    if (c.closed) continue;
    if (c.at + EXPIRE_MS > now) continue;
    c.closed = true;
    c.paid = { expire: true, at: now };
    for (const p of c.parts) rendus.push({ id: p.id, amount: p.amount, titre: c.titre });
  }
  // On ne garde pas l'histoire éternellement : un mois de mémoire suffit.
  state.cagnottes = ensure(state).filter((c) => !c.closed || now - (c.paid ? c.paid.at : c.at) < 30 * 86400000);
  return rendus;
}

/** Ce que voit le navigateur. */
function view(state, userId = null, now = Date.now()) {
  return ensure(state)
    .filter((c) => !c.closed || now - (c.paid ? c.paid.at : c.at) < 3 * 86400000)
    .sort((a, b) => (a.closed === b.closed ? b.at - a.at : a.closed ? 1 : -1))
    .slice(0, 8)
    .map((c) => ({
      id: c.id,
      titre: c.titre,
      but: c.but,
      total: total(c),
      pleine: pleine(c),
      pour: c.pour,
      ouvertPar: c.ouvertPar,
      parts: c.parts.length,
      donneurs: [...new Set(c.parts.map((p) => p.name))].slice(0, 8),
      moi: userId ? mise(c, userId) : 0,
      closed: c.closed,
      paid: c.paid,
      expireAt: c.at + EXPIRE_MS,
      at: c.at,
    }));
}

module.exports = {
  ensure, ouvrir, get, mettre, verser, aVerserAuMois, verserAuMois, sweep, view,
  total, pleine, mise, ouvertes,
  MIN_PART, MIN_BUT, MAX_BUT, MAX_OUVERTES, EXPIRE_MS,
};
