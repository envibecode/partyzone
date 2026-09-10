'use strict';
/**
 * LA CIBLE DU MOIS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'IDÉE
 * ─────────────────────────────────────────────────────────────────────────
 * Celui qui est en tête du classement du mois porte une cible dans le dos.
 * Le battre dans une partie Party rapporte une prime — en pièces, versée
 * par le site.
 *
 * Ça règle deux choses d'un coup :
 *
 *  · LE LEADER N'EST PLUS TRANQUILLE. Il gagne un statut, et il perd la
 *    paix. C'est le prix de la première place, et c'est beaucoup plus drôle
 *    qu'un simple numéro 1 dans un tableau.
 *  · ON A UNE RAISON DE L'INVITER. Sans ça, le réflexe naturel est de jouer
 *    quand il n'est PAS là. Avec la prime, sa présence a de la valeur pour
 *    tout le monde.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI LA PRIME EST EN PIÈCES, ET PAS EN XP
 * ─────────────────────────────────────────────────────────────────────────
 * Le classement du mois se joue à l'XP, et l'XP du casino uniquement — la
 * section Party est délibérément tenue à l'écart (voir `season.js`). Une
 * prime en XP ferait entrer les parties entre potes dans la course au lot
 * du mois, et il n'y a pas pire façon de pourrir une partie d'Uno.
 *
 * En pièces, la prime ne marque aucun point : elle donne de quoi jouer au
 * casino, et il faudra encore y jouer, puis ouvrir des caisses, pour que ça
 * devienne de l'XP. La chaîne du site est respectée, juste amorcée.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES GARDE-FOUS
 * ─────────────────────────────────────────────────────────────────────────
 * Trois, et ils comptent :
 *
 *  1. TROIS JOUEURS MINIMUM. Sans ça, deux amis ouvrent un salon, l'un
 *     perd exprès, et la prime devient un distributeur.
 *  2. DEUX PRIMES PAR JOUR ET PAR PERSONNE. Une soirée entière contre le
 *     leader ne rapporte pas plus que deux parties.
 *  3. IL FAUT FINIR DEVANT LUI, pas seulement gagner. Dans un jeu où l'on
 *     est plusieurs à gagner, tout le monde ne touche pas.
 */

const season = require('./season');
const ledger = require('./ledger');

/** La prime. De quoi poser quelques mises, pas de quoi financer un mois. */
const PRIME = 2000;
const MIN_JOUEURS = 3;
const MAX_PAR_JOUR = 2;

/*
 * Qui est la cible, en cache.
 *
 * Le calcul demande de relire tous les profils, ce qui est bien trop cher
 * pour le faire à chaque fin de partie. La tête du classement ne change pas
 * toutes les trente secondes : cinq minutes de retard n'ont jamais fait de
 * mal à personne, et une prime versée à cause d'un cache un peu vieux ne
 * lèse personne non plus.
 */
const CACHE_MS = 5 * 60 * 1000;
let cache = { at: 0, cible: null };

/**
 * Désigne la cible : le premier du mois en cours.
 *
 * `null` s'il n'y a pas de vraie course — un classement d'une seule
 * personne n'a pas de leader, il a un joueur.
 */
function designate(profiles, now = Date.now()) {
  const table = season.ranking(profiles, 3, now);
  if (table.length < 2) return null;
  const [premier, second] = table;
  return {
    id: premier.id,
    name: premier.name,
    avatar: premier.avatar || null,
    xp: premier.xp,
    avance: Math.max(0, premier.xp - second.xp),
    depuis: season.monthKey(new Date(now)),
  };
}

/** La cible du moment, calculée au plus une fois toutes les cinq minutes. */
async function current(store, now = Date.now()) {
  if (cache.cible !== null && now - cache.at < CACHE_MS) return cache.cible;
  try {
    const profiles = await store.allProfiles();
    cache = { at: now, cible: designate(profiles, now) };
  } catch (err) {
    console.error('[cible]', err.message);
  }
  return cache.cible;
}

/** Le classement a changé d'un coup (bascule de mois, remise à zéro admin). */
function forget() { cache = { at: 0, cible: null }; }

function jour(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function ensure(profile, now = Date.now()) {
  const day = jour(now);
  if (!profile.cible || profile.cible.day !== day) profile.cible = { day, taken: 0 };
  return profile.cible;
}

/**
 * Qui, dans cette partie, a battu la cible ?
 *
 * On ne touche à aucun profil ici — on répond à une question. C'est
 * l'appelant qui verse, parce que lui seul a les profils sous la main et
 * sait les sauvegarder.
 *
 * @param {object} cible   la cible du mois, ou null
 * @param {Array}  ranking  [{ id, score }] tel que le rend le salon
 * @returns {string[]} les identifiants des joueurs qui ont droit à la prime
 */
function vainqueurs(cible, ranking) {
  if (!cible || !Array.isArray(ranking) || ranking.length < MIN_JOUEURS) return [];

  const sien = ranking.find((r) => r.id === cible.id);
  if (!sien) return [];   // la cible n'était pas de la partie

  return ranking.filter((r) => r.id !== cible.id && r.score > sien.score).map((r) => r.id);
}

/**
 * Verse la prime à un joueur, si son quota du jour le permet.
 *
 * @returns {{paid:number, left:number}} 0 si le quota est épuisé
 */
function verser(profile, now = Date.now()) {
  const c = ensure(profile, now);
  if (c.taken >= MAX_PAR_JOUR) return { paid: 0, left: 0 };

  c.taken += 1;
  profile.vault.coins += PRIME;
  ledger.mint('prime cible', PRIME);
  return { paid: PRIME, left: MAX_PAR_JOUR - c.taken };
}

module.exports = {
  designate, current, forget, vainqueurs, verser, ensure,
  PRIME, MIN_JOUEURS, MAX_PAR_JOUR,
};
