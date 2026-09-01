'use strict';
/**
 * ÉVALUATION D'UNE MAIN DE POKER.
 *
 * On cherche la meilleure combinaison de cinq cartes parmi sept. Plutôt que
 * d'énumérer les 21 combinaisons — ce qui marche mais devient lent quand on
 * simule — on classe directement à partir des comptes de hauteurs et de
 * couleurs.
 *
 * Une main devient un nombre : catégorie × 15^5 plus les cinq hauteurs qui
 * départagent. Comparer deux mains, c'est alors comparer deux entiers, et
 * l'égalité parfaite (le « split pot ») tombe naturellement.
 */

const RANKS = '23456789TJQKA';
const SUITS = ['♠', '♥', '♦', '♣'];

const CATEGORIES = [
  'Carte haute', 'Paire', 'Deux paires', 'Brelan', 'Quinte',
  'Couleur', 'Full', 'Carré', 'Quinte flush', 'Quinte flush royale',
];

/** Un jeu de 52 cartes : { r: 0-12, s: 0-3 }. */
function freshDeck() {
  const deck = [];
  for (let s = 0; s < 4; s++) {
    for (let r = 0; r < 13; r++) deck.push({ r, s });
  }
  return deck;
}

function cardLabel(card) {
  return `${RANKS[card.r]}${SUITS[card.s]}`;
}

/** Les cinq meilleures hauteurs d'une suite décroissante de comptes. */
function straightHigh(rankSet) {
  // L'as compte aussi comme un 1 : la quinte A-2-3-4-5 existe, et beaucoup
  // d'évaluateurs maison l'oublient.
  const present = new Set(rankSet);
  if (present.has(12)) present.add(-1);

  for (let high = 12; high >= 3; high--) {
    let ok = true;
    for (let k = 0; k < 5; k++) {
      if (!present.has(high - k)) { ok = false; break; }
    }
    if (ok) return high;
  }
  return null;
}

/**
 * Évalue sept cartes (ou cinq, ou six).
 * Renvoie `{ score, category, name, best }`.
 */
function evaluate(cards) {
  const byRank = new Array(13).fill(0);
  const bySuit = [[], [], [], []];

  for (const c of cards) {
    byRank[c.r]++;
    bySuit[c.s].push(c.r);
  }

  const flushSuit = bySuit.findIndex((list) => list.length >= 5);

  /* Quinte flush — on cherche la quinte dans la seule couleur qui compte. */
  if (flushSuit >= 0) {
    const high = straightHigh(bySuit[flushSuit]);
    if (high !== null) {
      const category = high === 12 ? 9 : 8;
      return pack(category, [high, 0, 0, 0, 0], cards, flushSuit, high);
    }
  }

  /* Carré, full, brelan, paires : on trie les hauteurs par nombre d'exemplaires. */
  const groups = [];
  for (let r = 12; r >= 0; r--) {
    if (byRank[r]) groups.push({ r, n: byRank[r] });
  }
  groups.sort((a, b) => b.n - a.n || b.r - a.r);

  const kickers = (used, count) => groups
    .filter((g) => !used.includes(g.r))
    .map((g) => g.r)
    .slice(0, count);

  if (groups[0].n === 4) {
    return pack(7, [groups[0].r, ...kickers([groups[0].r], 1)], cards);
  }
  if (groups[0].n === 3 && groups[1] && groups[1].n >= 2) {
    return pack(6, [groups[0].r, groups[1].r], cards);
  }
  if (flushSuit >= 0) {
    const top = [...bySuit[flushSuit]].sort((a, b) => b - a).slice(0, 5);
    return pack(5, top, cards, flushSuit);
  }
  const high = straightHigh(groups.map((g) => g.r));
  if (high !== null) {
    return pack(4, [high, 0, 0, 0, 0], cards, -1, high);
  }
  if (groups[0].n === 3) {
    return pack(3, [groups[0].r, ...kickers([groups[0].r], 2)], cards);
  }
  if (groups[0].n === 2 && groups[1] && groups[1].n === 2) {
    return pack(2, [groups[0].r, groups[1].r, ...kickers([groups[0].r, groups[1].r], 1)], cards);
  }
  if (groups[0].n === 2) {
    return pack(1, [groups[0].r, ...kickers([groups[0].r], 3)], cards);
  }
  return pack(0, groups.map((g) => g.r).slice(0, 5), cards);
}

function pack(category, ranks, cards, flushSuit = -1, straight = null) {
  const padded = [...ranks, 0, 0, 0, 0, 0].slice(0, 5);
  let score = category;
  for (const r of padded) score = score * 15 + (r + 1);

  return {
    score,
    category,
    name: CATEGORIES[category],
    detail: describe(category, padded),
    best: bestFive(cards, category, padded, flushSuit, straight),
  };
}

const RANK_NAMES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Valet', 'Dame', 'Roi', 'As'];

/* Le français ne se contente pas d'un nom de carte collé derrière « de » :
   on dit un brelan d'As mais un brelan de Rois, une couleur à l'As mais une
   couleur au Roi. Ces trois helpers évitent les « Brelan de As » qui font
   tache dans une interface soignée. */
const n = (r) => RANK_NAMES[r] || '?';
const plural = (r) => (r === 12 ? 'As' : `${n(r)}s`);
const de = (r) => (r === 12 ? 'd’As' : `de ${plural(r)}`);
const au = (r) => (r === 12 ? 'à l’As' : `au ${n(r)}`);

function describe(category, ranks) {
  switch (category) {
    case 9: return 'Quinte flush royale';
    case 8: return `Quinte flush ${au(ranks[0])}`;
    case 7: return `Carré ${de(ranks[0])}`;
    case 6: return `Full ${ranks[0] === 12 ? 'aux As' : `aux ${plural(ranks[0])}`} par les ${plural(ranks[1])}`;
    case 5: return `Couleur ${au(ranks[0])}`;
    case 4: return `Quinte ${au(ranks[0])}`;
    case 3: return `Brelan ${de(ranks[0])}`;
    case 2: return `Deux paires, ${plural(ranks[0])} et ${plural(ranks[1])}`;
    case 1: return `Paire ${de(ranks[0])}`;
    default: return `Hauteur ${n(ranks[0])}`;
  }
}

/** Les cinq cartes à surligner à l'écran. */
function bestFive(cards, category, ranks, flushSuit, straight) {
  const pool = flushSuit >= 0 && (category === 5 || category >= 8)
    ? cards.filter((c) => c.s === flushSuit)
    : cards;

  if (straight !== null && (category === 4 || category >= 8)) {
    const wanted = [straight, straight - 1, straight - 2, straight - 3, straight - 4]
      .map((r) => (r === -1 ? 12 : r));
    const out = [];
    for (const r of wanted) {
      const found = pool.find((c) => c.r === r && !out.includes(c));
      if (found) out.push(found);
    }
    return out;
  }

  const out = [];
  for (const r of ranks) {
    if (r === 0 && out.length >= 5) break;
    for (const c of pool) {
      if (c.r === r && !out.includes(c) && out.length < 5) out.push(c);
    }
  }
  // On complète avec les plus hautes cartes restantes.
  const rest = pool.filter((c) => !out.includes(c)).sort((a, b) => b.r - a.r);
  while (out.length < 5 && rest.length) out.push(rest.shift());
  return out.slice(0, 5);
}

module.exports = { freshDeck, evaluate, cardLabel, RANKS, SUITS, CATEGORIES, straightHigh };
