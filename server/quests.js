'use strict';
/**
 * LES DÉFIS DU JOUR.
 *
 * Trois objectifs, renouvelés chaque jour à minuit, payés en pièces. C'est
 * le seul mécanisme du site qui donne une raison de revenir demain, et le
 * seul qui récompense la régularité plutôt que la chance.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI ÇA NE CASSE PAS L'ÉCONOMIE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La règle du site est que gagner des pièces doit être DUR. Trois défis à
 * deux ou trois cents pièces font moins de mille par jour : à peine de quoi
 * ouvrir une caisse. Ce n'est pas un robinet, c'est un rendez-vous. Et
 * comme tout le reste, ça passe par le registre d'économie : si un jour ça
 * devient la première source de pièces du site, ça se verra dans le panel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES MÊMES POUR TOUT LE MONDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les trois défis du jour sont tirés à partir de la DATE seule, pas de
 * l'identifiant du joueur. Tout le monde a donc les mêmes, et c'est
 * volontaire : « t'as réussi celui des trois caisses ? » est une phrase
 * qu'on peut dire à ses potes. Des défis personnalisés seraient plus
 * ajustés et beaucoup moins amusants.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE PAIEMENT EST AUTOMATIQUE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Pas de bouton « récupérer ». Un bouton, c'est une récompense qu'on
 * oublie de prendre et qui disparaît à minuit — une punition déguisée en
 * fonctionnalité. Ici le défi tombe, la fenêtre s'affiche, les pièces sont
 * déjà là.
 */

const ledger = require('./ledger');

/* ─── Le catalogue ─────────────────────────────────────────
 *
 * Chaque défi dit ce qu'il compte (`on`, l'événement) et combien il en
 * faut. Un `filter` optionnel restreint l'événement — « seulement quand on
 * a gagné », « seulement au blackjack ». Rien d'autre : ajouter un défi,
 * c'est ajouter une ligne ici.
 */
const CATALOG = [
  { id: 'rounds20', on: 'play', goal: 20, coins: 200,
    label: 'Joue 20 manches', hint: 'Roulette, Plinko, machine à sous, blackjack — tout compte.' },
  { id: 'wins5', on: 'play', goal: 5, coins: 250, filter: (e) => e.returned > e.staked,
    label: 'Gagne 5 manches', hint: 'Une manche gagnée, c’est plus récupéré que misé.' },
  { id: 'wager2k', on: 'play', goal: 2000, amount: (e) => e.staked, coins: 200,
    label: 'Mise 2 000 pièces en tout', hint: 'Le total de la journée, pas d’un coup.' },
  { id: 'big1k', on: 'play', goal: 1, coins: 300, filter: (e) => e.returned >= 1000,
    label: 'Encaisse 1 000 pièces d’un coup', hint: 'Un seul gros coup suffit.' },
  { id: 'cases3', on: 'case', goal: 3, coins: 250,
    label: 'Ouvre 3 caisses', hint: 'N’importe lesquelles, cadeaux compris.' },
  // 200 et pas 300 : une barre d'endurance pleine vaut une soixantaine de
  // pièces, donc 300 demanderait cinq recharges dans la journée — un défi
  // qu'on ne peut pas finir n'est pas un défi, c'est un décor.
  { id: 'mine200', on: 'mine', goal: 200, amount: (e) => e.coins, coins: 200,
    label: 'Extrais 200 pièces à la mine', hint: 'Le robinet de secours, à la sueur du clic.' },
  { id: 'party1', on: 'party', goal: 1, coins: 300,
    label: 'Joue une partie Party', hint: 'Undercover, poker, Uno, belote ou Monopoly.' },
  { id: 'partyWin', on: 'party', goal: 1, coins: 400, filter: (e) => e.won,
    label: 'Gagne une partie Party', hint: 'La plus dure des trois, et la plus honnête.' },
  { id: 'three', on: 'play', goal: 3, distinct: (e) => e.game, coins: 300,
    label: 'Joue à trois jeux différents', hint: 'Le tour du propriétaire.' },
  { id: 'sell', on: 'sell', goal: 1, coins: 150,
    label: 'Revends des doublons', hint: 'Au marché ou en revente automatique.' },
  { id: 'blackjack', on: 'play', goal: 3, coins: 250, filter: (e) => e.game === 'blackjack',
    label: 'Joue 3 mains de blackjack', hint: 'À une table, avec du monde de préférence.' },
  { id: 'roulette', on: 'play', goal: 5, coins: 250, filter: (e) => e.game === 'roulette',
    label: 'Tente 5 tours de roulette', hint: 'La table tourne toute seule, il suffit de miser.' },
];

const BY_ID = new Map(CATALOG.map((q) => [q.id, q]));
const PER_DAY = 3;

/* ─── Le jour, et le tirage ────────────────────────────── */

function dayOf(at = Date.now()) {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(at));
}

/** Un mélange déterministe à partir d'une chaîne : même jour, même tirage. */
function seedFrom(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Les trois défis d'un jour donné.
 *
 * Tirés de la date seule : tout le monde a les mêmes, et on peut donc en
 * parler. Le tirage est reproductible, donc un redémarrage du serveur en
 * milieu de journée ne change pas les défis en cours.
 */
function pickFor(day) {
  let seed = seedFrom(day);
  const pool = [...CATALOG];
  const out = [];
  while (out.length < PER_DAY && pool.length) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    out.push(pool.splice(seed % pool.length, 1)[0]);
  }
  return out.map((q) => q.id);
}

/* ─── L'état dans le profil ────────────────────────────── */

function blank(now = Date.now()) {
  return { day: dayOf(now), ids: pickFor(dayOf(now)), progress: {}, seen: {}, done: [], earned: 0 };
}

/**
 * Remet les défis à jour si le jour a changé.
 *
 * Les compteurs repartent à zéro : un défi « joue 20 manches » qui
 * garderait les manches d'hier ne serait pas un défi quotidien.
 */
function ensure(profile, now = Date.now()) {
  if (!profile.quests || typeof profile.quests !== 'object') profile.quests = blank(now);
  const q = profile.quests;
  const today = dayOf(now);
  if (q.day !== today) {
    q.day = today;
    q.ids = pickFor(today);
    q.progress = {};
    q.seen = {};
    q.done = [];
  }
  if (!Array.isArray(q.ids) || q.ids.length !== PER_DAY) q.ids = pickFor(today);
  if (!q.progress || typeof q.progress !== 'object') q.progress = {};
  if (!q.seen || typeof q.seen !== 'object') q.seen = {};
  if (!Array.isArray(q.done)) q.done = [];
  if (typeof q.earned !== 'number') q.earned = 0;
  return q;
}

/* ─── L'avancement ─────────────────────────────────────── */

/**
 * Enregistre un événement et renvoie les défis qui viennent de tomber.
 *
 * `event` est l'un de 'play', 'case', 'mine', 'party', 'sell' ; `payload`
 * porte ce que le défi a besoin de savoir. L'appelant se contente de dire
 * ce qui s'est passé — il n'a aucune idée de quels défis existent, ce qui
 * permet d'en ajouter sans toucher aux jeux.
 */
function record(profile, event, payload = {}, now = Date.now()) {
  const q = ensure(profile, now);
  const finished = [];

  for (const id of q.ids) {
    const def = BY_ID.get(id);
    if (!def || def.on !== event) continue;
    if (q.done.includes(id)) continue;
    if (def.filter && !def.filter(payload)) continue;

    if (def.distinct) {
      // « Trois jeux différents » : on retient lesquels, pas combien.
      const key = def.distinct(payload);
      if (!key) continue;
      const seen = q.seen[id] || (q.seen[id] = []);
      if (!seen.includes(key)) seen.push(key);
      q.progress[id] = seen.length;
    } else {
      const step = def.amount ? Math.max(0, Math.round(def.amount(payload))) : 1;
      if (!step) continue;
      q.progress[id] = (q.progress[id] || 0) + step;
    }

    if (q.progress[id] >= def.goal) {
      q.done.push(id);
      q.earned += def.coins;
      profile.vault.coins += def.coins;
      ledger.mint('défis du jour', def.coins);
      finished.push({ id, label: def.label, coins: def.coins });
    }
  }

  return finished;
}

/* ─── Ce que voit le joueur ────────────────────────────── */

function view(profile, now = Date.now()) {
  const q = ensure(profile, now);

  // Le temps qu'il reste avant la rotation, en heure de Paris.
  const paris = new Date(new Date(now).toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const midnight = new Date(paris);
  midnight.setHours(24, 0, 0, 0);
  const resetsIn = midnight - paris;

  return {
    day: q.day,
    resetsIn,
    earned: q.earned,
    // Le total du jour : ce qu'on peut encore aller chercher.
    total: q.ids.reduce((sum, id) => sum + ((BY_ID.get(id) || {}).coins || 0), 0),
    list: q.ids.map((id) => {
      const def = BY_ID.get(id) || { label: '—', goal: 1, coins: 0 };
      const at = Math.min(def.goal, q.progress[id] || 0);
      return {
        id,
        label: def.label,
        hint: def.hint || '',
        goal: def.goal,
        at,
        done: q.done.includes(id),
        coins: def.coins,
        ratio: def.goal ? Math.min(1, at / def.goal) : 0,
      };
    }),
  };
}

module.exports = { CATALOG, PER_DAY, blank, ensure, record, view, dayOf, pickFor };
