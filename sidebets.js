'use strict';
/**
 * LES MISES ANNEXES DU BLACKJACK.
 *
 * Deux paris classiques, posés en même temps que la mise principale et
 * réglés dès la distribution :
 *
 *   • PAIRE      — tes deux premières cartes forment une paire.
 *   • 21+3       — tes deux cartes plus la carte visible du croupier
 *                  forment une main de poker.
 *
 * Un mot d'honnêteté : ces paris rendent MOINS que la table principale.
 * C'est vrai dans tous les casinos du monde, et plutôt que de le cacher on
 * calcule ici le taux de redistribution exact — par dénombrement complet,
 * pas à la louche — et on l'affiche au joueur avant qu'il mise.
 */

const DECKS = 6;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const RED = new Set(['♥', '♦']);

const MIN_BET = 10;
const MAX_BET = 5000;

/* ─── Grilles de gain (en profit, « x pour 1 misé ») ───── */

const PAIRS = {
  perfect: { name: 'Paire parfaite', payout: 25 },  // même rang, même couleur d'enseigne
  coloured: { name: 'Paire colorée', payout: 12 },  // même rang, même couleur
  mixed: { name: 'Paire mixte', payout: 6 },        // même rang, couleurs opposées
};

const TRIO = {
  suitedTrips: { name: 'Brelan assorti', payout: 100 },
  straightFlush: { name: 'Quinte flush', payout: 40 },
  trips: { name: 'Brelan', payout: 30 },
  straight: { name: 'Suite', payout: 10 },
  flush: { name: 'Couleur', payout: 5 },
};

/* ─── Évaluation ───────────────────────────────────────── */

function pairKind(a, b) {
  if (a.r !== b.r) return null;
  if (a.s === b.s) return 'perfect';
  return RED.has(a.s) === RED.has(b.s) ? 'coloured' : 'mixed';
}

/** Ordre des rangs pour les suites. L'as compte haut ET bas. */
const ORDER = { A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13 };

function isStraight(ranks) {
  const v = ranks.map((r) => ORDER[r]).sort((a, b) => a - b);
  if (v[0] + 1 === v[1] && v[1] + 1 === v[2]) return true;
  // Q-K-A : l'as remonte en 14.
  const high = ranks.map((r) => (r === 'A' ? 14 : ORDER[r])).sort((a, b) => a - b);
  return high[0] + 1 === high[1] && high[1] + 1 === high[2];
}

function trioKind(cards) {
  const [a, b, c] = cards;
  const sameSuit = a.s === b.s && b.s === c.s;
  const sameRank = a.r === b.r && b.r === c.r;

  if (sameRank && sameSuit) return 'suitedTrips';
  if (sameRank) return 'trips';
  const straight = isStraight([a.r, b.r, c.r]);
  if (straight && sameSuit) return 'straightFlush';
  if (straight) return 'straight';
  if (sameSuit) return 'flush';
  return null;
}

/* ─── Taux de redistribution, par dénombrement ─────────── */

/**
 * On ne devine pas : on énumère toutes les mains possibles dans un sabot de
 * six jeux, avec leurs multiplicités, et on calcule l'espérance exacte.
 */
/** Énumération complète des trios de trois cartes tirés du sabot. */
function trioRtp() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  const COPIES = DECKS;

  let total = 0;
  let ev = 0;

  const score = (cards) => {
    const kind = trioKind(cards);
    return kind ? TRIO[kind].payout : -1;
  };

  // Trois cartes distinctes du paquet de 52 types.
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      for (let k = j + 1; k < deck.length; k++) {
        const ways = COPIES * COPIES * COPIES;
        total += ways;
        ev += ways * score([deck[i], deck[j], deck[k]]);
      }
    }
  }
  // Deux cartes identiques + une autre.
  for (let i = 0; i < deck.length; i++) {
    for (let j = 0; j < deck.length; j++) {
      if (i === j) continue;
      const ways = (COPIES * (COPIES - 1) / 2) * COPIES;
      total += ways;
      ev += ways * score([deck[i], deck[i], deck[j]]);
    }
  }
  // Trois cartes identiques.
  for (let i = 0; i < deck.length; i++) {
    const ways = (COPIES * (COPIES - 1) * (COPIES - 2)) / 6;
    total += ways;
    ev += ways * score([deck[i], deck[i], deck[i]]);
  }

  return 1 + ev / total;
}

/** Redistribution du pari « paire », calculée proprement. */
function pairsRtpExact() {
  const rest = DECKS * 52 - 1;
  const win = 5 * PAIRS.perfect.payout + 6 * PAIRS.coloured.payout + 12 * PAIRS.mixed.payout;
  const lose = rest - 23;
  return 1 + (win - lose) / rest;
}

const RTP = {
  pairs: Math.round(pairsRtpExact() * 10000) / 100,
  trio: Math.round(trioRtp() * 10000) / 100,
};

/* ─── Règlement ────────────────────────────────────────── */

/**
 * Règle les deux paris annexes d'un siège.
 * `hand` = les deux premières cartes du joueur, `upCard` = la carte visible
 * du croupier.
 */
function settle(side, hand, upCard) {
  const out = { pairs: null, trio: null, payout: 0 };
  if (!side) return out;

  if (side.pairs > 0) {
    const kind = pairKind(hand[0], hand[1]);
    const gain = kind ? side.pairs * (PAIRS[kind].payout + 1) : 0;
    out.pairs = {
      staked: side.pairs,
      kind,
      name: kind ? PAIRS[kind].name : null,
      payout: gain,
    };
    out.payout += gain;
  }

  if (side.trio > 0 && upCard) {
    const kind = trioKind([hand[0], hand[1], upCard]);
    const gain = kind ? side.trio * (TRIO[kind].payout + 1) : 0;
    out.trio = {
      staked: side.trio,
      kind,
      name: kind ? TRIO[kind].name : null,
      payout: gain,
    };
    out.payout += gain;
  }

  return out;
}

/** Vérifie et normalise ce que le navigateur propose comme paris annexes. */
function normalise(raw, coins) {
  const pairs = Math.max(0, Math.floor(Number(raw && raw.pairs) || 0));
  const trio = Math.max(0, Math.floor(Number(raw && raw.trio) || 0));

  for (const [label, value] of [['paire', pairs], ['21+3', trio]]) {
    if (value === 0) continue;
    if (value < MIN_BET) return { ok: false, message: `Mise annexe minimum (${label}) : ${MIN_BET} pièces.` };
    if (value > MAX_BET) return { ok: false, message: `Mise annexe maximum (${label}) : ${MAX_BET} pièces.` };
  }
  const total = pairs + trio;
  if (total > coins) return { ok: false, message: `Il te manque ${total - coins} pièces pour les paris annexes.` };

  return { ok: true, side: total > 0 ? { pairs, trio } : null, total };
}

function view() {
  return {
    minBet: MIN_BET,
    maxBet: MAX_BET,
    rtp: RTP,
    pairs: Object.entries(PAIRS).map(([id, p]) => ({ id, name: p.name, payout: p.payout })),
    trio: Object.entries(TRIO).map(([id, p]) => ({ id, name: p.name, payout: p.payout })),
  };
}

module.exports = { settle, normalise, view, RTP, PAIRS, TRIO, pairKind, trioKind, MIN_BET, MAX_BET };
