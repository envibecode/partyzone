'use strict';
/**
 * LE CLASSEMENT DU MOIS.
 *
 * Le classement général cumule depuis toujours ; celui-ci repart à zéro le
 * 1er de chaque mois. À la bascule, le premier du mois écoulé est inscrit
 * au palmarès et prévenu.
 *
 * Sur le lot : c'est un concours GRATUIT, pas une loterie. Personne ne peut
 * acheter de pièces, donc personne ne paie pour participer — et c'est
 * exactement ce qui rend la chose saine. Le site désigne le gagnant et
 * l'annonce ; la remise du lot se fait à la main, en dehors du site. Rien
 * n'est distribué automatiquement.
 */

const PRIZE = process.env.SEASON_PRIZE || 'un Discord Nitro d’un mois';

/** Identifiant du mois en cours : « 2026-09 ». */
function monthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const noms = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return `${noms[m - 1]} ${y}`;
}

/** Quand commence le mois suivant, pour le compte à rebours. */
function nextReset(date = new Date()) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0);
}

function blankSeason(now = Date.now()) {
  return { month: monthKey(new Date(now)), coins: 0, wagered: 0, rounds: 0, best: 0 };
}

/**
 * Remet le compteur du joueur à zéro s'il date d'un mois passé.
 * Chaque profil porte son propre compteur : il n'y a pas de tableau global à
 * reconstruire, et un joueur absent tout un mois ne fausse rien.
 */
function ensure(profile, now = Date.now()) {
  const key = monthKey(new Date(now));
  if (!profile.season || profile.season.month !== key) {
    profile.season = blankSeason(now);
  }
  return profile.season;
}

/** Enregistre un gain net dans le compteur du mois. */
function record(profile, { profit = 0, staked = 0, rounds = 0 } = {}, now = Date.now()) {
  const season = ensure(profile, now);
  season.coins += profit;
  season.wagered += staked;
  season.rounds += rounds;
  if (profit > season.best) season.best = profit;
  return season;
}

/**
 * Vérifie si le mois a tourné. Si oui, inscrit le vainqueur au palmarès et
 * renvoie de quoi l'annoncer. On passe la liste des profils : le calcul est
 * fait une fois, au premier joueur qui se connecte après la bascule.
 */
function rollover(state, profiles, now = Date.now()) {
  const key = monthKey(new Date(now));
  if (!state.month) {
    state.month = key;
    return null;
  }
  if (state.month === key) return null;

  const ended = state.month;
  state.month = key;

  // Le vainqueur du mois écoulé : celui qui avait le plus gros compteur
  // encore marqué de ce mois-là.
  const ranked = profiles
    .filter((p) => p.season && p.season.month === ended && p.season.coins > 0 && !p.banned)
    .sort((a, b) => b.season.coins - a.season.coins);

  if (!ranked.length) return null;

  const winner = ranked[0];
  const entry = {
    month: ended,
    label: monthLabel(ended),
    id: winner.id,
    name: winner.name,
    avatar: winner.avatar,
    coins: winner.season.coins,
    prize: PRIZE,
    at: now,
    // Le lot n'est pas remis par le site : quelqu'un doit le faire à la main.
    delivered: false,
  };

  state.hallOfFame = [entry, ...(state.hallOfFame || [])].slice(0, 24);
  return entry;
}

/** Le classement du mois en cours. */
function ranking(profiles, limit = 20, now = Date.now()) {
  const key = monthKey(new Date(now));
  return profiles
    .filter((p) => p.season && p.season.month === key && p.season.coins > 0 && !p.banned)
    .sort((a, b) => b.season.coins - a.season.coins)
    .slice(0, limit)
    .map((p, i) => ({
      rank: i + 1,
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      coins: p.season.coins,
      rounds: p.season.rounds,
      best: p.season.best,
    }));
}

function view(state, now = Date.now()) {
  return {
    month: monthKey(new Date(now)),
    label: monthLabel(monthKey(new Date(now))),
    endsAt: nextReset(new Date(now)),
    serverNow: now,
    prize: PRIZE,
    hallOfFame: (state.hallOfFame || []).slice(0, 12),
  };
}

module.exports = { monthKey, monthLabel, nextReset, blankSeason, ensure, record, rollover, ranking, view, PRIZE };
