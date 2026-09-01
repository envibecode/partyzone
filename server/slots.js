'use strict';
/**
 * LA MACHINE À SOUS — « LES COPAINS ».
 *
 * Cinq rouleaux, trois rangées, dix lignes fixes. Les symboles sont ceux
 * d'un serveur Discord un soir de semaine : le micro, le casque, le statut
 * vert, le ne-pas-déranger, le bot qui répond n'importe quoi, la pizza qu'on
 * commande à minuit, et l'admin qui débarque.
 *
 * Deux choses valent d'être dites franchement :
 *
 *  • Le résultat vient de la graine publiée d'avance, comme partout ailleurs
 *    sur le site. Les rouleaux ne sont pas « ajustés » selon ce qu'on a misé.
 *
 *  • Le taux de redistribution n'est pas une promesse marketing : il est
 *    MESURÉ au démarrage sur des centaines de milliers de tours simulés,
 *    tour bonus compris, et c'est ce chiffre-là qui s'affiche.
 */

const fair = require('./fair');

const REELS = 5;
const ROWS = 3;

const MIN_BET = 10;      // par ligne
const MAX_BET = 20000;
const LINES = 10;

/* ─── Les symboles ─────────────────────────────────────── */

/**
 * `weight` pilote la fréquence sur les rouleaux, `pay` ce que rapportent
 * 3, 4 et 5 symboles alignés (multiplicateur de la mise par ligne).
 */
const SYMBOLS = [
  { id: 'online',  emoji: '🟢', name: 'En ligne',        weight: 100, pay: [5.0, 15, 50] },
  { id: 'idle',    emoji: '🌙', name: 'Absent',          weight: 95,  pay: [6.5, 19, 63] },
  { id: 'dnd',     emoji: '⛔', name: 'Ne pas déranger', weight: 88,  pay: [7.5, 23, 76] },
  { id: 'mic',     emoji: '🎤', name: 'Micro ouvert',    weight: 74,  pay: [11, 38, 125] },
  { id: 'head',    emoji: '🎧', name: 'Casque',          weight: 66,  pay: [15, 50, 175] },
  { id: 'pizza',   emoji: '🍕', name: 'Pizza de minuit', weight: 52,  pay: [23, 76, 275] },
  { id: 'bot',     emoji: '🤖', name: 'Bot du serveur',  weight: 38,  pay: [38, 140, 565] },
  { id: 'admin',   emoji: '👑', name: 'L’admin',         weight: 22,  pay: [76, 315, 1500] },
];

/** Le joker remplace tout, sauf le symbole bonus. */
const WILD = { id: 'wild', emoji: '🍀', name: 'Trèfle', weight: 26, wild: true, pay: [50, 225, 1000] };

/** Le bonus paie où qu'il tombe, et trois d'entre eux ouvrent le tour bonus. */
const SCATTER = { id: 'scatter', emoji: '📣', name: 'Le Ping', weight: 20, scatter: true };

const ALL = [...SYMBOLS, WILD, SCATTER];
const BY_ID = new Map(ALL.map((s) => [s.id, s]));

/** Le ruban dans lequel chaque rouleau pioche. */
const STRIP = [];
for (const s of ALL) {
  for (let i = 0; i < s.weight; i++) STRIP.push(s.id);
}

/* ─── Les lignes de paiement ───────────────────────────── */

/** Dix lignes fixes, décrites par la rangée touchée sur chaque rouleau. */
const PAYLINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 0, 0],
  [2, 2, 1, 2, 2],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 2],
];

/* ─── Le tour bonus ────────────────────────────────────── */

const BONUS_SPINS = 8;
const BONUS_MULT = 3;      // tout est multiplié par trois pendant le bonus
const SCATTER_PAY = { 3: 3, 4: 12, 5: 60 }; // multiplicateur de la mise TOTALE

/* ─── Un tour ──────────────────────────────────────────── */

/** Tire une grille de 5 × 3 à partir de nombres déjà fournis. */
function drawGrid(values) {
  const grid = [];
  for (let r = 0; r < REELS; r++) {
    const column = [];
    for (let row = 0; row < ROWS; row++) {
      const v = values[r * ROWS + row];
      column.push(STRIP[Math.min(STRIP.length - 1, Math.floor(v * STRIP.length))]);
    }
    grid.push(column);
  }
  return grid;
}

/**
 * Évalue une grille.
 * Les lignes se lisent de gauche à droite ; il faut au moins trois symboles
 * identiques d'affilée en partant du premier rouleau. Le trèfle remplace
 * n'importe quoi sauf le ping.
 */
function evaluate(grid, perLine) {
  const wins = [];
  let total = 0;

  PAYLINES.forEach((line, index) => {
    const ids = line.map((row, reel) => grid[reel][row]);

    // Le symbole de référence : le premier qui n'est pas un joker.
    let ref = null;
    for (const id of ids) {
      if (id === 'scatter') break;
      if (id !== 'wild') { ref = id; break; }
    }
    // Une ligne de jokers pleins compte comme des jokers.
    if (!ref && ids[0] === 'wild') ref = 'wild';
    if (!ref) return;

    let run = 0;
    for (const id of ids) {
      if (id === ref || (id === 'wild' && ref !== 'scatter')) run++;
      else break;
    }
    if (run < 3) return;

    const symbol = BY_ID.get(ref);
    if (!symbol || !symbol.pay) return;

    const gain = Math.round(perLine * symbol.pay[run - 3]);
    if (gain <= 0) return;

    total += gain;
    wins.push({
      line: index,
      rows: line.slice(0, run),
      symbol: ref,
      emoji: symbol.emoji,
      name: symbol.name,
      count: run,
      gain,
    });
  });

  // Le ping paie où qu'il soit tombé, sur la mise totale.
  const scatters = [];
  grid.forEach((column, reel) => {
    column.forEach((id, row) => {
      if (id === 'scatter') scatters.push({ reel, row });
    });
  });

  let scatterGain = 0;
  if (scatters.length >= 3) {
    scatterGain = Math.round(perLine * LINES * (SCATTER_PAY[Math.min(5, scatters.length)] || 0));
    total += scatterGain;
  }

  return { wins, total, scatters, scatterGain };
}

/* ─── Jouer ────────────────────────────────────────────── */

function spinOnce(profile, perLine) {
  const { nonce, values } = fair.draw(profile.fair, REELS * ROWS);
  const grid = drawGrid(values);
  return { nonce, grid, ...evaluate(grid, perLine) };
}

function play(profile, { bet } = {}) {
  const perLine = Math.floor(Number(bet) || 0);
  if (!Number.isFinite(perLine) || perLine < MIN_BET) {
    return { ok: false, message: `Mise minimum : ${MIN_BET} pièces par ligne.` };
  }
  if (perLine > MAX_BET) return { ok: false, message: `Mise maximum : ${MAX_BET} pièces par ligne.` };

  const staked = perLine * LINES;
  if (profile.vault.coins < staked) {
    return { ok: false, message: `Il te manque ${staked - profile.vault.coins} pièces.` };
  }

  profile.vault.coins -= staked;

  const main = spinOnce(profile, perLine);
  let payout = main.total;

  // Trois pings ou plus : le serveur déclenche les tours offerts et joue.
  const bonus = [];
  if (main.scatters.length >= 3) {
    for (let i = 0; i < BONUS_SPINS; i++) {
      const round = spinOnce(profile, perLine);
      const gain = round.total * BONUS_MULT;
      payout += gain;
      bonus.push({ ...round, gain });
    }
  }

  profile.vault.coins += payout;

  return {
    ok: true,
    perLine,
    lines: LINES,
    staked,
    payout,
    profit: payout - staked,
    spin: main,
    bonus,
    bonusMult: BONUS_MULT,
    coins: profile.vault.coins,
  };
}

/* ─── Redistribution mesurée ───────────────────────────── */

/**
 * On simule un grand nombre de tours avec un générateur ordinaire — on ne
 * cherche pas ici à être vérifiable, juste à connaître le vrai chiffre —
 * puis on l'affiche. Le calcul prend quelques centaines de millisecondes au
 * démarrage, une seule fois.
 */
function measureRtp(rounds = 400000) {
  const perLine = 100;
  const staked = perLine * LINES;
  let total = 0;
  let bonusHits = 0;

  // Générateur à graine fixe : le chiffre affiché doit être le même à chaque
  // démarrage. Avec Math.random il bougerait de quelques dixièmes entre deux
  // redémarrages, et un taux de redistribution qui change tout seul n'inspire
  // pas confiance — à juste titre.
  let seed = 987654321;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const randomGrid = () => {
    const grid = [];
    for (let r = 0; r < REELS; r++) {
      const column = [];
      for (let row = 0; row < ROWS; row++) {
        column.push(STRIP[Math.floor(rnd() * STRIP.length)]);
      }
      grid.push(column);
    }
    return grid;
  };

  for (let i = 0; i < rounds; i++) {
    const main = evaluate(randomGrid(), perLine);
    let payout = main.total;
    if (main.scatters.length >= 3) {
      bonusHits++;
      for (let b = 0; b < BONUS_SPINS; b++) {
        payout += evaluate(randomGrid(), perLine).total * BONUS_MULT;
      }
    }
    total += payout;
  }

  return {
    rtp: Math.round((total / (rounds * staked)) * 10000) / 100,
    bonusRate: Math.round((bonusHits / rounds) * 100000) / 1000,
    rounds,
  };
}

const MEASURED = measureRtp();

function view() {
  return {
    reels: REELS,
    rows: ROWS,
    lines: LINES,
    paylines: PAYLINES,
    minBet: MIN_BET,
    maxBet: MAX_BET,
    bonusSpins: BONUS_SPINS,
    bonusMult: BONUS_MULT,
    scatterPay: SCATTER_PAY,
    rtp: MEASURED.rtp,
    bonusRate: MEASURED.bonusRate,
    measuredOn: MEASURED.rounds,
    symbols: [...SYMBOLS, WILD].map((s) => ({
      id: s.id, emoji: s.emoji, name: s.name, pay: s.pay, wild: Boolean(s.wild),
    })),
    scatter: { id: SCATTER.id, emoji: SCATTER.emoji, name: SCATTER.name, pay: SCATTER_PAY },
  };
}

module.exports = { play, view, evaluate, drawGrid, SYMBOLS, WILD, SCATTER, PAYLINES, LINES, MIN_BET, MAX_BET };
