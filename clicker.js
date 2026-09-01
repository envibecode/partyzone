'use strict';
/**
 * LA MINE — le robinet de secours.
 *
 * Quatre principes, et ils sont volontaires :
 *
 *  1. AUCUN revenu hors ligne. On ne gagne rien en fermant l'onglet.
 *
 *  2. L'ENDURANCE plutôt qu'un simple plafond. Chaque coup en consomme, et
 *     elle remonte LENTEMENT. On tape vite pendant cinq secondes, puis le
 *     rendement s'effondre pendant une minute et demie. Un autoclic ne
 *     rapporte donc rien de plus qu'une main humaine — il vide juste la
 *     barre plus vite et mine ensuite à perte.
 *
 *  3. Ça rapporte peu, et c'est le but. Une barre pleine, c'est environ
 *     soixante pièces : de quoi poser une petite mise, pas de quoi
 *     s'enrichir. Si miner devenait rentable, plus personne ne jouerait, et
 *     un site de casino où l'on ne joue pas n'a aucun intérêt.
 *
 *  4. Les vraies pièces viennent d'ailleurs : du jeu (avec le rakeback qui
 *     rend une part de ce qu'on a misé), du rang Party, du marché entre
 *     joueurs, et de la revente des doublons.
 */

const MAX_CLICKS_PER_SEC = 10;   // plafond dur, en plus de l'endurance
const CRIT_CHANCE = 0.04;
const CRIT_MULT = 6;

/* ─── Endurance ────────────────────────────────────────── */

const STAMINA_MAX = 60;          // coups tapables d'affilée à plein régime
const STAMINA_REGEN = 0.7;       // points par seconde → 85 s pour tout refaire
const TIRED_FACTOR = 0.04;       // rendement une fois la barre vide : presque rien

/* ─── Améliorations ────────────────────────────────────── */
/* Toutes agissent sur le clic ou sur l'endurance. Aucune ne produit de
   pièces toute seule : il n'y a plus rien à farmer en AFK. */

/*
 * Les prix montent vite et les paliers sont peu nombreux. Le but n'est pas
 * de rendre la mine puissante mais de donner un objectif à long terme : même
 * entièrement améliorée, elle rapporte moins qu'une soirée de blackjack.
 */
const UPGRADES = [
  {
    id: 'pick',
    name: 'Pioche renforcée',
    icon: '⛏️',
    max: 10,
    base: 2500,
    growth: 1.85,
    describe: (n) => `+${n} pièce${n > 1 ? 's' : ''} par coup`,
  },
  {
    id: 'gloves',
    name: 'Gants de mineur',
    icon: '🧤',
    max: 8,
    base: 9000,
    growth: 1.95,
    describe: (n) => `+${8 * n} % sur chaque coup`,
  },
  {
    id: 'lungs',
    name: 'Souffle du mineur',
    icon: '🫁',
    max: 10,
    base: 6000,
    growth: 1.9,
    describe: (n) => `+${5 * n} points d’endurance`,
  },
  {
    id: 'rest',
    name: 'Pause thé',
    icon: '🍵',
    max: 10,
    base: 15000,
    growth: 2,
    describe: (n) => `récupération +${12 * n} %`,
  },
  {
    id: 'crystal',
    name: 'Veine de cristal',
    icon: '💎',
    max: 6,
    base: 120000,
    growth: 2.3,
    describe: (n) => `+${3 * n} % de chances de coup critique`,
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
    upgrades: { pick: 0, gloves: 0, lungs: 0, rest: 0, crystal: 0 },
    stamina: STAMINA_MAX,
    lastClickAt: now,
    clickBudget: MAX_CLICKS_PER_SEC,
  };
}

function levels(mine) {
  return { pick: 0, gloves: 0, lungs: 0, rest: 0, crystal: 0, ...(mine.upgrades || {}) };
}

/** Pièces par coup, à pleine endurance et hors critique. */
function clickValue(mine) {
  const l = levels(mine);
  return (1 + l.pick) * (1 + 0.08 * l.gloves);
}

function staminaMax(mine) {
  return STAMINA_MAX + 5 * levels(mine).lungs;
}

function staminaRegen(mine) {
  return STAMINA_REGEN * (1 + 0.12 * levels(mine).rest);
}

function critChance(mine) {
  return Math.min(0.25, CRIT_CHANCE + 0.03 * levels(mine).crystal);
}

/** Remonte l'endurance en fonction du temps écoulé depuis le dernier coup. */
function recover(mine, now) {
  const since = Math.max(0, now - (mine.lastClickAt || now));
  const max = staminaMax(mine);
  mine.stamina = Math.min(max, (mine.stamina ?? max) + (since / 1000) * staminaRegen(mine));
  return mine.stamina;
}

/* ─── Actions ──────────────────────────────────────────── */

/**
 * Enregistre une salve de coups. Le navigateur peut en regrouper plusieurs
 * pour ne pas saturer le réseau ; le serveur refait tout le calcul.
 */
function click(profile, count = 1, now = Date.now()) {
  const mine = profile.clicker;
  recover(mine, now);

  // Plafond dur, en plus de l'endurance : personne ne dépasse la cadence
  // d'une main rapide, même en trichant sur le regroupement des coups.
  const since = Math.max(0, now - (mine.lastClickAt || now));
  mine.clickBudget = Math.min(
    MAX_CLICKS_PER_SEC * 2,
    (mine.clickBudget ?? MAX_CLICKS_PER_SEC) + (since / 1000) * MAX_CLICKS_PER_SEC
  );
  mine.lastClickAt = now;

  const asked = Math.max(1, Math.min(30, Math.floor(Number(count) || 1)));
  const allowed = Math.floor(Math.min(asked, mine.clickBudget));
  if (allowed <= 0) return { coins: 0, crits: 0, counted: 0, throttled: true, stamina: mine.stamina };

  mine.clickBudget -= allowed;

  const value = clickValue(mine);
  const crit = critChance(mine);
  let coins = 0;
  let crits = 0;
  let tired = 0;

  for (let i = 0; i < allowed; i++) {
    // Chaque coup puise dans l'endurance. Une fois la barre vide, on tape
    // toujours, mais ça ne rapporte presque plus rien.
    let factor = 1;
    if (mine.stamina >= 1) {
      mine.stamina -= 1;
    } else {
      factor = TIRED_FACTOR;
      tired++;
    }
    const gain = value * factor;
    if (Math.random() < crit) {
      coins += gain * CRIT_MULT;
      crits++;
    } else {
      coins += gain;
    }
  }

  coins = Math.floor(coins);
  profile.vault.coins += coins;
  mine.clicks += allowed;
  mine.earned += coins;

  return {
    coins,
    crits,
    counted: allowed,
    throttled: allowed < asked,
    tired,
    stamina: Math.round(mine.stamina),
    staminaMax: staminaMax(mine),
  };
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
  recover(mine, now);
  const l = levels(mine);

  return {
    coins: profile.vault.coins,
    clicks: mine.clicks,
    earned: mine.earned,
    perClick: Math.round(clickValue(mine) * 10) / 10,
    critChance: Math.round(critChance(mine) * 1000) / 1000,
    critMult: CRIT_MULT,
    stamina: Math.round(mine.stamina),
    staminaMax: staminaMax(mine),
    staminaRegen: Math.round(staminaRegen(mine) * 10) / 10,
    tiredFactor: TIRED_FACTOR,
    maxClicksPerSec: MAX_CLICKS_PER_SEC,
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

/**
 * Ancienne fonction de revenu hors ligne. Elle ne verse plus rien : on la
 * garde le temps que les profils enregistrés avec l'ancien format passent
 * par la migration, et pour ne pas casser les appels existants.
 */
function collect() {
  return { coins: 0, seconds: 0 };
}

module.exports = {
  blankClicker, collect, click, buy, view,
  clickValue, staminaMax, UPGRADES, MAX_CLICKS_PER_SEC,
};
