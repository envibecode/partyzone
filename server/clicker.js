'use strict';
/**
 * LA MINE — le robinet à pièces.
 *
 * C'est un clicker/idle classique : on tape sur le filon, on achète des
 * améliorations, et une partie du revenu finit par tomber toute seule. C'est
 * la seule source de pièces avec les gains du casino — il n'existe aucun
 * moyen d'en acheter avec de l'argent réel, et c'est volontaire.
 *
 * Le serveur compte les clics et plafonne la cadence : un script qui
 * enverrait mille clics par seconde n'en obtiendrait pas plus que la main
 * la plus rapide.
 */

const MAX_CLICKS_PER_SEC = 20;
const OFFLINE_CAP_MS = 8 * 3600 * 1000; // 8 h de revenu passif rattrapé au maximum
const CRIT_CHANCE = 0.06;
const CRIT_MULT = 10;

/* ─── Améliorations ────────────────────────────────────── */

const UPGRADES = [
  {
    id: 'pick',
    name: 'Pioche renforcée',
    icon: '⛏️',
    max: 25,
    base: 50,
    growth: 1.35,
    describe: (n) => `+${2 * n} pièces par clic`,
  },
  {
    id: 'gloves',
    name: 'Gants de mineur',
    icon: '🧤',
    max: 15,
    base: 400,
    growth: 1.5,
    describe: (n) => `+${25 * n} % sur chaque clic`,
  },
  {
    id: 'drill',
    name: 'Foreuse',
    icon: '🛠️',
    max: 30,
    base: 250,
    growth: 1.4,
    describe: (n) => `${n} pièce${n > 1 ? 's' : ''} par seconde, sans rien faire`,
  },
  {
    id: 'cart',
    name: 'Wagonnet',
    icon: '🛒',
    max: 20,
    base: 1200,
    growth: 1.55,
    describe: (n) => `+${8 * n} % de revenu passif`,
  },
  {
    id: 'crystal',
    name: 'Veine de cristal',
    icon: '💎',
    max: 12,
    base: 8000,
    growth: 1.8,
    describe: (n) => `+${5 * n} % sur tout, clic et passif`,
  },
];

const BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

function priceOf(up, level) {
  return Math.round(up.base * Math.pow(up.growth, level));
}

/* ─── État ─────────────────────────────────────────────── */

function blankClicker(now = Date.now()) {
  return {
    clicks: 0,
    earned: 0,
    upgrades: { pick: 0, gloves: 0, drill: 0, cart: 0, crystal: 0 },
    lastTick: now,
    lastClickAt: 0,
    clickBudget: MAX_CLICKS_PER_SEC,
  };
}

function levels(mine) {
  return { pick: 0, gloves: 0, drill: 0, cart: 0, crystal: 0, ...(mine.upgrades || {}) };
}

/** Pièces gagnées par clic, hors coup critique. */
function clickValue(mine) {
  const l = levels(mine);
  return (1 + 2 * l.pick) * (1 + 0.25 * l.gloves) * (1 + 0.05 * l.crystal);
}

/** Pièces gagnées par seconde sans rien faire. */
function perSecond(mine) {
  const l = levels(mine);
  return l.drill * (1 + 0.08 * l.cart) * (1 + 0.05 * l.crystal);
}

/**
 * Encaisse le revenu passif accumulé depuis le dernier passage.
 * Retourne ce qui vient d'être versé, pour pouvoir l'annoncer au joueur.
 */
function collect(profile, now = Date.now()) {
  const mine = profile.clicker;
  const elapsed = Math.min(now - (mine.lastTick || now), OFFLINE_CAP_MS);
  mine.lastTick = now;
  if (elapsed <= 0) return { coins: 0, seconds: 0 };

  const seconds = elapsed / 1000;
  const coins = Math.floor(perSecond(mine) * seconds);
  if (coins > 0) {
    profile.vault.coins += coins;
    mine.earned += coins;
  }
  return { coins, seconds: Math.round(seconds) };
}

/* ─── Actions ──────────────────────────────────────────── */

/**
 * Enregistre une salve de clics. Le navigateur peut en regrouper plusieurs
 * pour ne pas saturer le réseau, mais le serveur refait le calcul et
 * plafonne la cadence.
 */
function click(profile, count = 1, now = Date.now()) {
  const mine = profile.clicker;

  // Seau à jetons : on récupère MAX_CLICKS_PER_SEC jetons par seconde.
  const since = Math.max(0, now - (mine.lastClickAt || now));
  mine.clickBudget = Math.min(
    MAX_CLICKS_PER_SEC * 2,
    (mine.clickBudget ?? MAX_CLICKS_PER_SEC) + (since / 1000) * MAX_CLICKS_PER_SEC
  );
  mine.lastClickAt = now;

  const asked = Math.max(1, Math.min(40, Math.floor(Number(count) || 1)));
  const allowed = Math.floor(Math.min(asked, mine.clickBudget));
  if (allowed <= 0) return { coins: 0, crits: 0, throttled: true };

  mine.clickBudget -= allowed;

  const value = clickValue(mine);
  let coins = 0;
  let crits = 0;
  for (let i = 0; i < allowed; i++) {
    if (Math.random() < CRIT_CHANCE) {
      coins += value * CRIT_MULT;
      crits++;
    } else {
      coins += value;
    }
  }

  coins = Math.floor(coins);
  profile.vault.coins += coins;
  mine.clicks += allowed;
  mine.earned += coins;

  return { coins, crits, counted: allowed, throttled: allowed < asked };
}

function buy(profile, id) {
  const up = BY_ID.get(id);
  if (!up) return { ok: false, message: 'Amélioration inconnue.' };
  const mine = profile.clicker;
  const level = levels(mine)[up.id];
  if (level >= up.max) return { ok: false, message: `${up.name} est déjà au maximum.` };

  const price = priceOf(up, level);
  if (profile.vault.coins < price) {
    return { ok: false, message: `Il te manque ${price - profile.vault.coins} pièces.` };
  }

  profile.vault.coins -= price;
  mine.upgrades[up.id] = level + 1;
  return { ok: true, message: `${up.name} niveau ${level + 1} !`, id: up.id, level: level + 1 };
}

/* ─── Vue ──────────────────────────────────────────────── */

function view(profile, now = Date.now()) {
  const mine = profile.clicker;
  const l = levels(mine);
  return {
    coins: profile.vault.coins,
    clicks: mine.clicks,
    earned: mine.earned,
    perClick: Math.round(clickValue(mine) * 10) / 10,
    perSecond: Math.round(perSecond(mine) * 10) / 10,
    critChance: CRIT_CHANCE,
    critMult: CRIT_MULT,
    maxClicksPerSec: MAX_CLICKS_PER_SEC,
    offlineCapHours: OFFLINE_CAP_MS / 3600000,
    serverNow: now,
    upgrades: UPGRADES.map((up) => {
      const level = l[up.id];
      const maxed = level >= up.max;
      return {
        id: up.id,
        name: up.name,
        icon: up.icon,
        level,
        max: up.max,
        price: maxed ? null : priceOf(up, level),
        effect: level ? up.describe(level) : 'Pas encore acheté',
        next: maxed ? null : up.describe(level + 1),
        affordable: !maxed && profile.vault.coins >= priceOf(up, level),
      };
    }),
  };
}

module.exports = { blankClicker, collect, click, buy, view, clickValue, perSecond, UPGRADES, MAX_CLICKS_PER_SEC };
