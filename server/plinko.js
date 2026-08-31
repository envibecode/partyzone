'use strict';
/**
 * PLINKO.
 *
 * La bille tombe entre les picots ; à chaque rangée elle part à gauche ou à
 * droite, à pile ou face. Après `rows` rangées elle atterrit dans l'une des
 * `rows + 1` cases. Le nombre de « droites » suit une loi binomiale : le
 * centre est très probable, les bords quasi introuvables.
 *
 * Les multiplicateurs ne sont pas inventés à la main : ils sont calculés à
 * partir des probabilités réelles, puis mis à l'échelle pour que le taux de
 * redistribution tombe exactement sur la cible. Le RTP affiché au joueur est
 * ensuite recalculé APRÈS arrondi, donc c'est le vrai.
 */
const fair = require('./fair');

const TARGET_RTP = 0.97;
const ROWS = [8, 12, 16];
const RISKS = ['low', 'medium', 'high'];

const RISK_LABEL = { low: 'Prudent', medium: 'Équilibré', high: 'Casse-cou' };

/** Le plus gros multiplicateur visé, par (rangées, risque). */
const PEAKS = {
  8: { low: 5.6, medium: 13, high: 29 },
  12: { low: 8.4, medium: 33, high: 170 },
  16: { low: 16, medium: 110, high: 1000 },
};

/* ─── Construction des tables ──────────────────────────── */

function binomial(n, k) {
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/** Probabilité d'atterrir dans chaque case, pour `rows` rangées. */
function probabilities(rows) {
  const total = Math.pow(2, rows);
  return Array.from({ length: rows + 1 }, (_, i) => binomial(rows, i) / total);
}

/**
 * Multiplicateurs bruts, avant mise à l'échelle : l'inverse de la
 * probabilité élevé à la puissance alpha. Plus alpha est grand, plus les
 * bords explosent — c'est exactement le curseur « risque ».
 */
function rawMultipliers(probs, alpha) {
  return probs.map((p) => Math.pow(1 / p, alpha));
}

function rtpOf(probs, mults) {
  return probs.reduce((sum, p, i) => sum + p * mults[i], 0);
}

/** Cherche l'alpha qui place le multiplicateur maximal sur la cible. */
function solveAlpha(probs, peak) {
  let lo = 0.1;
  let hi = 1.4;
  for (let step = 0; step < 60; step++) {
    const alpha = (lo + hi) / 2;
    const raw = rawMultipliers(probs, alpha);
    const scale = TARGET_RTP / rtpOf(probs, raw);
    const max = raw[0] * scale;
    if (max < peak) lo = alpha;
    else hi = alpha;
  }
  return (lo + hi) / 2;
}

/** Arrondi lisible : deux décimales en bas, entier en haut. */
function prettify(m) {
  if (m < 1) return Math.round(m * 100) / 100;
  if (m < 10) return Math.round(m * 10) / 10;
  if (m < 100) return Math.round(m);
  return Math.round(m / 5) * 5;
}

function buildTable(rows, risk) {
  const probs = probabilities(rows);
  const alpha = solveAlpha(probs, PEAKS[rows][risk]);
  const raw = rawMultipliers(probs, alpha);
  const scale = TARGET_RTP / rtpOf(probs, raw);
  const mults = raw.map((m) => Math.max(0.1, prettify(m * scale)));
  return { rows, risk, multipliers: mults, probabilities: probs, rtp: rtpOf(probs, mults) };
}

const TABLES = {};
for (const rows of ROWS) {
  TABLES[rows] = {};
  for (const risk of RISKS) TABLES[rows][risk] = buildTable(rows, risk);
}

function tableFor(rows, risk) {
  const r = ROWS.includes(Number(rows)) ? Number(rows) : 16;
  const k = RISKS.includes(risk) ? risk : 'medium';
  return TABLES[r][k];
}

/* ─── Une bille ────────────────────────────────────────── */

const MIN_BET = 10;
const MAX_BET = 100000;
const MAX_BALLS = 10;

/**
 * Lâche `balls` billes. Chaque bille consomme un nonce, et son chemin est
 * entièrement déterminé par l'empreinte HMAC : rien n'est décidé après coup.
 */
function play(profile, { bet, rows, risk, balls = 1 } = {}) {
  const table = tableFor(rows, risk);
  const count = Math.max(1, Math.min(MAX_BALLS, Math.floor(Number(balls) || 1)));
  const stake = Math.floor(Number(bet) || 0);

  if (!Number.isFinite(stake) || stake < MIN_BET) {
    return { ok: false, message: `Mise minimum : ${MIN_BET} pièces.` };
  }
  if (stake > MAX_BET) return { ok: false, message: `Mise maximum : ${MAX_BET} pièces.` };

  const total = stake * count;
  if (profile.vault.coins < total) {
    return { ok: false, message: `Il te manque ${total - profile.vault.coins} pièces.` };
  }

  profile.vault.coins -= total;

  const drops = [];
  let payout = 0;

  for (let b = 0; b < count; b++) {
    const { nonce, values } = fair.draw(profile.fair, table.rows);
    // Chaque rangée : au-dessus de 0,5 la bille part à droite.
    const path = values.map((v) => (v < 0.5 ? 0 : 1));
    const bucket = path.reduce((a, x) => a + x, 0);
    const multiplier = table.multipliers[bucket];
    const win = Math.round(stake * multiplier);
    payout += win;
    drops.push({ nonce, path, bucket, multiplier, win });
  }

  profile.vault.coins += payout;

  return {
    ok: true,
    drops,
    staked: total,
    payout,
    profit: payout - total,
    rows: table.rows,
    risk: table.risk,
    coins: profile.vault.coins,
  };
}

/* ─── Vue ──────────────────────────────────────────────── */

function view() {
  return {
    minBet: MIN_BET,
    maxBet: MAX_BET,
    maxBalls: MAX_BALLS,
    rowOptions: ROWS,
    riskOptions: RISKS.map((r) => ({ id: r, name: RISK_LABEL[r] })),
    tables: ROWS.reduce((acc, rows) => {
      acc[rows] = RISKS.reduce((a, risk) => {
        const t = TABLES[rows][risk];
        a[risk] = { multipliers: t.multipliers, rtp: Math.round(t.rtp * 10000) / 100 };
        return a;
      }, {});
      return acc;
    }, {}),
  };
}

module.exports = { play, view, tableFor, TABLES, probabilities, MIN_BET, MAX_BET };
