'use strict';
/**
 * LE CARNET DES FAITS MARQUANTS.
 *
 * Le site enregistre déjà tout : chaque mise, chaque gain, chaque partie.
 * Mais des chiffres ne sont pas des souvenirs. Personne ne relit une
 * colonne de nombres, alors que tout le monde relit « Momo a perdu quarante
 * mille en douze minutes puis a tout repris sur un bonus ».
 *
 * Ce fichier ne fait qu'une chose : retenir ce qui MÉRITE d'être raconté.
 * Pas tout — sinon ce serait encore un journal de bord. Seulement ce qui
 * sort de l'ordinaire, mesuré par rapport à la mise et non dans l'absolu :
 * un gros gain à dix pièces n'intéresse personne, une grosse perte à cent
 * mille, si.
 *
 * Trois choses s'en servent :
 *
 *  · LE JOURNAL DU LENDEMAIN, qui en tire trois phrases chaque matin ;
 *  · LE PRIX CITRON, qui décerne chaque semaine un trophée à la pire
 *    décision de la bande ;
 *  · LA CARTE DE FIN DE SOIRÉE, qui a besoin du meilleur moment.
 *
 * TOUT EST GARDÉ PAR JOUR, ET QUATORZE JOURS SEULEMENT. Un site entre potes
 * n'a pas besoin d'archives : il a besoin de mémoire courte et vive.
 */

const store = () => require('./store');

const KEEP_DAYS = 14;
const MAX_PER_DAY = 400;

/* ─── Ce qui mérite d'être retenu ──────────────────────── */

/*
 * Les seuils. Ils sont volontairement hauts : un carnet qui retient tout ne
 * retient rien. À quatre joueurs, on veut trois ou quatre lignes par
 * soirée, pas trois cents.
 */
const GROS_GAIN = 15;        // fois la mise
const GROSSE_PERTE = 8000;   // pièces perdues d'un coup
const SERIE_MINI = 5;        // défaites d'affilée avant que ça devienne drôle

function jour(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/** La semaine ISO, pour le prix Citron. */
function semaine(now = Date.now()) {
  const d = new Date(now);
  const jeudi = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  jeudi.setUTCDate(jeudi.getUTCDate() + 3 - ((jeudi.getUTCDay() + 6) % 7));
  const debut = new Date(Date.UTC(jeudi.getUTCFullYear(), 0, 4));
  const n = 1 + Math.round(((jeudi - debut) / 86400000 - 3 + ((debut.getUTCDay() + 6) % 7)) / 7);
  return `${jeudi.getUTCFullYear()}-S${String(n).padStart(2, '0')}`;
}

function bucket(state, day) {
  if (!state.faits) state.faits = { days: {} };
  if (!state.faits.days[day]) state.faits.days[day] = [];
  return state.faits.days[day];
}

/** Oublie ce qui a plus de quinze jours. */
function prune(state, now = Date.now()) {
  if (!state.faits || !state.faits.days) return;
  const limite = jour(now - KEEP_DAYS * 86400000);
  for (const day of Object.keys(state.faits.days)) {
    if (day < limite) delete state.faits.days[day];
  }
}

/*
 * On écrit dans un tampon plutôt que directement dans l'état : `record` est
 * appelé depuis des endroits synchrones (le calcul d'une manche), alors que
 * lire l'état est asynchrone. Le tampon est vidé toutes les cinq secondes,
 * comme le registre de l'économie.
 */
let buffer = [];

function record(kind, payload = {}, now = Date.now()) {
  buffer.push({ kind, at: now, ...payload });
  if (buffer.length > MAX_PER_DAY) buffer = buffer.slice(-MAX_PER_DAY);
}

async function flush() {
  if (!buffer.length) return;
  const lot = buffer;
  buffer = [];
  try {
    const state = await store().siteState();
    for (const fait of lot) {
      const list = bucket(state, jour(fait.at));
      list.push(fait);
      if (list.length > MAX_PER_DAY) list.shift();
    }
    prune(state);
    store().touchState();
  } catch (err) {
    console.error('[faits]', err.message);
  }
}
setInterval(() => { flush(); }, 5000).unref();

/* ─── Les portes d'entrée ──────────────────────────────── */

/**
 * Une manche de casino vient de se jouer. On ne retient que les extrêmes.
 * `store.recordPlay` appelle ceci pour tous les jeux, donc aucun ne peut
 * l'oublier.
 */
function manche(profile, { staked, returned, game }) {
  if (!staked) return;
  const profit = returned - staked;
  const ratio = returned / staked;

  if (ratio >= GROS_GAIN) {
    record('gain', {
      id: profile.id, name: profile.name, game,
      staked, gain: returned, ratio: Math.round(ratio),
    });
  } else if (-profit >= GROSSE_PERTE) {
    record('perte', { id: profile.id, name: profile.name, game, perte: -profit });
  }
}

/** Une série de défaites : c'est ce qui fait rire, pas ce qui fait gagner. */
function serie(profile, longueur, game) {
  if (longueur < SERIE_MINI) return;
  record('serie', { id: profile.id, name: profile.name, game, longueur });
}

/** Une partie Party terminée. */
function party(game, gameName, winners, players) {
  record('party', {
    game, gameName,
    winners: winners.map((w) => ({ id: w.id, name: w.name })),
    players: players.length,
  });
}

/** Un objet rare sorti d'une caisse. */
function trouvaille(profile, item) {
  record('caisse', {
    id: profile.id, name: profile.name,
    item: item.name, emoji: item.emoji || '', rarete: item.rarity || '',
  });
}

/** Une soirée terminée. */
function soiree(gagnants, manches, table) {
  record('soiree', { winners: gagnants, manches, table });
}

/** Quelqu'un est remonté de très bas. */
function retour(profile, bas, haut) {
  record('retour', { id: profile.id, name: profile.name, bas, haut });
}

/* ─── Lecture ──────────────────────────────────────────── */

function of(state, day) {
  return ((state.faits || {}).days || {})[day] || [];
}

/** Tous les faits d'une plage de jours, du plus récent au plus ancien. */
function since(state, days = 7, now = Date.now()) {
  const out = [];
  for (let i = 0; i < days; i++) {
    out.push(...of(state, jour(now - i * 86400000)));
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Ce qui attend d'être écrit. Sert aux bancs d'essai, qui n'ont pas de base. */
function pending() { return buffer.slice(); }
function reset() { buffer = []; }

module.exports = {
  record, flush, manche, serie, party, trouvaille, soiree, retour, pending, reset,
  of, since, jour, semaine, prune,
  GROS_GAIN, GROSSE_PERTE, SERIE_MINI, KEEP_DAYS,
};
