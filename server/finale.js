'use strict';
/**
 * LES 48 DERNIÈRES HEURES DU MOIS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE PROBLÈME
 * ─────────────────────────────────────────────────────────────────────────
 * Un classement mensuel se joue en trois jours et s'endort pendant vingt-
 * huit. Le 20 du mois, celui qui est deuxième à 30 % du premier sait qu'il
 * ne reviendra pas, et il arrête de venir. Celui qui est premier le sait
 * aussi, et il arrête d'avoir peur. À quatre joueurs, il ne reste alors
 * plus grand-chose à disputer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ON FAIT, ET CE QU'ON REFUSE DE FAIRE
 * ─────────────────────────────────────────────────────────────────────────
 * La solution évidente — multiplier l'XP pendant les dernières heures —
 * marche, et elle est mauvaise. Elle transforme la fin du mois en course
 * d'endurance : celui qui reste debout le plus longtemps gagne, ce qui est
 * exactement le mécanisme qu'on passe le reste du site à éviter (voir
 * l'anti-AFK de la mine, et le plafond d'endurance).
 *
 * Alors le bonus est PLAFONNÉ EN NOMBRE, pas en durée : chacun a droit à
 * DIX CAISSES boostées pendant la dernière ligne droite, et pas une de
 * plus. Une fois les dix ouvertes, jouer encore rapporte exactement ce que
 * ça rapporte le reste du mois.
 *
 * Ce plafond change tout :
 *
 *  · il donne au poursuivant une vraie dernière cartouche — dix caisses à
 *    une fois et demie, c'est de quoi refaire un écart raisonnable ;
 *  · il ne récompense pas la nuit blanche, puisque la onzième caisse ne
 *    rapporte rien de plus que d'habitude ;
 *  · et il est le même pour tout le monde, donc il ne défavorise pas celui
 *    qui a joué régulièrement — il a ses dix caisses lui aussi, et il garde
 *    son avance.
 *
 * Le bonus s'applique à l'XP DES CAISSES uniquement. C'est là que se joue
 * le classement (voir `season.js`) : booster les mises reviendrait à
 * pousser à jouer plus gros, ce qui n'est ni le but ni très malin.
 */

const season = require('./season');

/** Deux jours : assez pour tenir un week-end, trop court pour s'installer. */
const WINDOW_MS = 48 * 60 * 60 * 1000;

/** Le bonus, et le nombre de caisses qui en profitent. */
const MULT = 1.5;
const CASES = 10;

/** Quand la dernière ligne droite commence, pour un instant donné. */
function startsAt(now = Date.now()) {
  return season.nextReset(new Date(now)) - WINDOW_MS;
}

function endsAt(now = Date.now()) {
  return season.nextReset(new Date(now));
}

function active(now = Date.now()) {
  return now >= startsAt(now);
}

/**
 * Le compteur du joueur, remis à zéro à chaque mois.
 *
 * Il vit sur le profil et pas dans l'état du site : c'est un compteur par
 * personne, il doit survivre au redémarrage, et il n'intéresse personne
 * d'autre.
 */
function ensure(profile, now = Date.now()) {
  const key = season.monthKey(new Date(now));
  if (!profile.finale || profile.finale.month !== key) {
    profile.finale = { month: key, cases: 0, bonus: 0 };
  }
  return profile.finale;
}

/**
 * L'XP en plus d'une ouverture de caisses.
 *
 * @param {object} profile
 * @param {number} xp      l'XP normale du tirage
 * @param {number} count   le nombre de caisses ouvertes d'un coup
 * @returns {{xp:number, cases:number, left:number}} l'XP EN PLUS (0 hors période)
 */
function bonus(profile, xp, count = 1, now = Date.now()) {
  if (!active(now) || xp <= 0) return { xp: 0, cases: 0, left: left(profile, now) };

  const f = ensure(profile, now);
  const dispo = Math.max(0, CASES - f.cases);
  if (!dispo) return { xp: 0, cases: 0, left: 0 };

  // Sur une ouverture multiple, seules les caisses encore couvertes par le
  // plafond comptent — on ne fait pas passer dix caisses pour une.
  const prises = Math.min(dispo, Math.max(1, count));
  const part = (xp / Math.max(1, count)) * prises;
  const gain = Math.round(part * (MULT - 1));

  f.cases += prises;
  f.bonus += gain;
  return { xp: gain, cases: prises, left: CASES - f.cases };
}

/** Combien de caisses boostées il reste au joueur. */
function left(profile, now = Date.now()) {
  if (!active(now)) return CASES;
  return Math.max(0, CASES - ensure(profile, now).cases);
}

/** Ce que le navigateur affiche : le bandeau de la dernière ligne droite. */
function view(profile, now = Date.now()) {
  const on = active(now);
  return {
    active: on,
    startsAt: startsAt(now),
    endsAt: endsAt(now),
    serverNow: now,
    mult: MULT,
    cases: CASES,
    left: profile ? left(profile, now) : CASES,
    used: profile && on ? ensure(profile, now).cases : 0,
  };
}

module.exports = { active, startsAt, endsAt, bonus, left, view, WINDOW_MS, MULT, CASES };
