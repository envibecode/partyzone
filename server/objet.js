'use strict';
/**
 * L'OBJET DU JOUR.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI OUVRIR UNE CAISSE AUJOURD'HUI PLUTÔT QUE DEMAIN ?
 * ─────────────────────────────────────────────────────────────────────────
 * Rien, jusqu'ici, ne répondait à cette question. Les caisses sont
 * identiques tous les jours, donc rien ne distingue un mardi d'un jeudi, et
 * un site où tous les jours se ressemblent est un site qu'on finit par
 * ouvrir de moins en moins souvent.
 *
 * L'objet du jour est un des 518 objets de la collection, tiré de la DATE
 * elle-même. Celui qui le sort d'une caisse aujourd'hui touche une prime.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TROIS CHOIX QUI COMPTENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  1. TIRÉ DE LA DATE, comme les défis du jour. Personne ne le choisit, il
 *     est le même pour tout le monde, et il est visible d'avance. « T'as
 *     eu le Nyan Cat ? » est une phrase qui n'existait pas hier.
 *
 *  2. TOUT LE MONDE PEUT LE TOUCHER, autant de fois qu'il sort — mais la
 *     prime est plafonnée à trois par jour et par personne. Ce n'est pas
 *     une course au premier arrivé : ces courses-là ne se gagnent qu'en
 *     étant réveillé à l'heure, ce qui n'est pas un talent.
 *
 *  3. LA PRIME EST EN PIÈCES, PAS EN XP. Elle ne déplace donc pas le
 *     classement du mois toute seule : elle donne de quoi ouvrir la caisse
 *     suivante, et c'est cette caisse-là qui donnera l'XP. La chaîne du
 *     site reste intacte.
 *
 * Un objet commun est plus souvent tiré qu'un mythique : la prime tient
 * compte de la rareté, sinon l'objet du jour serait tantôt un cadeau
 * quotidien, tantôt une loterie impossible.
 */

const { ITEMS, BY_ID, RARITIES } = require('./data/collection');

/** Le maudit est hors jeu : huit chances sur dix mille, ce serait cruel. */
const CANDIDATS = ITEMS.filter((i) => i.r !== 'cursed');

/** Trois primes par jour et par personne : un rendez-vous, pas un robinet. */
const MAX_PAR_JOUR = 3;

/**
 * La prime, selon la rareté.
 *
 * Elle vaut à peu près ce que l'objet vaut à la revente, multiplié par
 * cinq pour un commun et par un et demi pour un mythique : plus l'objet
 * est dur à sortir, moins on a besoin de motiver les gens à le chercher.
 */
const PRIME = {
  common: 400,
  rare: 900,
  epic: 1800,
  legendary: 4000,
  mythic: 9000,
};

function jour(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/** L'objet du jour, tiré de la date. Le même pour tout le monde. */
function du(now = Date.now()) {
  const cle = jour(now);
  let h = 7;
  for (const ch of cle) h = (h * 131 + ch.codePointAt(0)) % 2147483647;
  const item = CANDIDATS[h % CANDIDATS.length];
  return {
    day: cle,
    id: item.id,
    name: item.name,
    emoji: item.emoji,
    r: item.r,
    rarity: RARITIES[item.r].name,
    color: RARITIES[item.r].color,
    categorie: item.c,
    prime: PRIME[item.r] || 400,
  };
}

function ensure(profile, now = Date.now()) {
  const day = jour(now);
  if (!profile.objet || profile.objet.day !== day) profile.objet = { day, taken: 0, gagne: 0 };
  return profile.objet;
}

/**
 * Un tirage vient de sortir : est-ce l'objet du jour ?
 *
 * @param {object} profile
 * @param {Array}  pulls   les objets sortis de la caisse
 * @returns {{prime:number, fois:number, item:object|null, left:number}}
 */
function verifier(profile, pulls, now = Date.now()) {
  const objet = du(now);
  const trouves = (pulls || []).filter((p) => p.id === objet.id).length;
  const etat = ensure(profile, now);
  const dispo = Math.max(0, MAX_PAR_JOUR - etat.taken);

  if (!trouves || !dispo) {
    return { prime: 0, fois: 0, item: trouves ? objet : null, left: dispo };
  }

  const fois = Math.min(trouves, dispo);
  const prime = objet.prime * fois;
  etat.taken += fois;
  etat.gagne += prime;

  return { prime, fois, item: objet, left: MAX_PAR_JOUR - etat.taken };
}

/** Ce que voit le navigateur : l'objet, la prime, et ce qu'il en reste. */
function view(profile = null, now = Date.now()) {
  const objet = du(now);
  const etat = profile ? ensure(profile, now) : { taken: 0, gagne: 0 };
  const demain = Date.parse(`${jour(now)}T00:00:00Z`) + 86400000;
  return {
    ...objet,
    max: MAX_PAR_JOUR,
    reste: Math.max(0, MAX_PAR_JOUR - etat.taken),
    gagne: etat.gagne,
    // Un joueur qui n'a pas encore l'objet le sait : ça change tout, parce
    // qu'un nouvel objet vaut aussi une place de plus dans la collection.
    possede: profile ? Boolean((profile.vault.items || {})[objet.id]) : false,
    jusqua: demain,
    serverNow: now,
  };
}

module.exports = { du, verifier, view, ensure, PRIME, MAX_PAR_JOUR, CANDIDATS, BY_ID };
