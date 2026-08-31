'use strict';
/**
 * PIXEL FARM — le jeu solo qui tourne en tâche de fond.
 *
 * Un clicker/idle : on plante, ça pousse en temps réel (même déconnecté),
 * on arrose au clic pour accélérer, on récolte des pièces et de l'XP, et on
 * réinvestit dans des améliorations. Toute la logique vit ici, côté serveur :
 * le navigateur n'envoie que des intentions, jamais des résultats.
 */

const WATER_MAX = 60;
const WATER_EVERY_MS = 2000; // une goutte toutes les 2 s
const MAX_PLOTS = 12;
const OFFLINE_CAP_MS = 12 * 3600 * 1000; // 12 h de pousse hors ligne au maximum

/* ─── Contenu ──────────────────────────────────────────── */

const SEEDS = {
  wheat:   { id: 'wheat',   name: 'BLE',      icon: '🌾', level: 1,  cost: 2,   growMs: 30 * 1000,      coins: 8,    xp: 4 },
  carrot:  { id: 'carrot',  name: 'CAROTTE',  icon: '🥕', level: 3,  cost: 12,  growMs: 2 * 60 * 1000,  coins: 45,   xp: 18 },
  pumpkin: { id: 'pumpkin', name: 'CITROUILLE', icon: '🎃', level: 7, cost: 60, growMs: 8 * 60 * 1000,  coins: 260,  xp: 90 },
  crystal: { id: 'crystal', name: 'CRISTAL',  icon: '💎', level: 14, cost: 400, growMs: 30 * 60 * 1000, coins: 2000, xp: 420 },
};

const UPGRADES = {
  can: {
    id: 'can',
    name: 'ARROSOIR',
    icon: '💧',
    max: 3,
    costs: [150, 900, 4000],
    describe: (lvl) => `Chaque arrosage avance la pousse de ${[4, 9, 18, 35][lvl]} s.`,
  },
  fert: {
    id: 'fert',
    name: 'ENGRAIS',
    icon: '🧪',
    max: 3,
    costs: [300, 1500, 7000],
    describe: (lvl) => `Temps de pousse réduit de ${[0, 10, 22, 35][lvl]} %.`,
  },
  scare: {
    id: 'scare',
    name: 'EPOUVANTAIL',
    icon: '🎭',
    max: 3,
    costs: [250, 1200, 6000],
    describe: (lvl) => `Récoltes +${[0, 15, 32, 55][lvl]} % de pièces.`,
  },
  barn: {
    id: 'barn',
    name: 'GRANGE AUTO',
    icon: '🏚️',
    max: 1,
    costs: [5000],
    describe: (lvl) => (lvl ? 'Récolte automatique active.' : 'Aucune récolte automatique.'),
  },
};

const WATER_BOOST_MS = [4000, 9000, 18000, 35000];
const FERT_SPEED = [1, 0.9, 0.78, 0.65];
const SCARE_BONUS = [1, 1.15, 1.32, 1.55];

function plotPrice(plotCount) {
  return Math.round(200 * Math.pow(2.2, plotCount - 6));
}

/* ─── Calculs ──────────────────────────────────────────── */

function growMsFor(farm, seedId) {
  const seed = SEEDS[seedId];
  if (!seed) return Infinity;
  return Math.round(seed.growMs * FERT_SPEED[farm.upgrades.fert || 0]);
}

function harvestValue(farm, seedId) {
  const seed = SEEDS[seedId];
  return {
    coins: Math.round(seed.coins * SCARE_BONUS[farm.upgrades.scare || 0]),
    xp: seed.xp,
  };
}

/** Progression d'une parcelle, entre 0 et 1. */
function plotProgress(farm, plot, now) {
  if (!plot.seed) return 0;
  const total = growMsFor(farm, plot.seed);
  const elapsed = Math.min(now - plot.plantedAt, OFFLINE_CAP_MS) + (plot.boost || 0);
  return Math.max(0, Math.min(1, elapsed / total));
}

/** Régénère l'eau en fonction du temps écoulé. Modifie la ferme sur place. */
function refillWater(farm, now) {
  const cap = WATER_MAX;
  if (farm.water >= cap) {
    farm.waterAt = now;
    return;
  }
  const drops = Math.floor((now - farm.waterAt) / WATER_EVERY_MS);
  if (drops <= 0) return;
  farm.water = Math.min(cap, farm.water + drops);
  farm.waterAt = farm.water >= cap ? now : farm.waterAt + drops * WATER_EVERY_MS;
}

/**
 * Met la ferme à jour : eau régénérée, et récolte automatique si la grange
 * est achetée. Retourne ce qui a été gagné pendant l'absence.
 */
function tick(profile, now = Date.now()) {
  const farm = profile.farm;
  refillWater(farm, now);

  const gains = { coins: 0, xp: 0, harvested: 0 };
  if (farm.upgrades.barn) {
    for (const plot of farm.plots.slice(0, farm.plotCount)) {
      if (plot.seed && plotProgress(farm, plot, now) >= 1) {
        const value = harvestValue(farm, plot.seed);
        gains.coins += value.coins;
        gains.xp += value.xp;
        gains.harvested++;
        plot.seed = null;
        plot.plantedAt = 0;
        plot.boost = 0;
      }
    }
    if (gains.harvested) {
      farm.coins += gains.coins;
      farm.harvested += gains.harvested;
    }
  }
  return gains;
}

/* ─── Actions ──────────────────────────────────────────── */

/**
 * Applique une action. Retourne { ok, message, xp } — `xp` est l'XP à
 * créditer au joueur (le compteur global vit dans le profil, pas ici).
 */
function act(profile, action, payload = {}, playerLevel = 1, now = Date.now()) {
  const farm = profile.farm;
  refillWater(farm, now);

  const index = Number(payload.plot);
  const plot = Number.isInteger(index) && index >= 0 && index < farm.plotCount ? farm.plots[index] : null;

  switch (action) {
    /* ── Planter ── */
    case 'plant': {
      const seed = SEEDS[payload.seed];
      if (!seed) return { ok: false, message: 'Graine inconnue.' };
      if (!plot) return { ok: false, message: 'Parcelle invalide.' };
      if (plot.seed) return { ok: false, message: 'Cette parcelle est déjà occupée.' };
      if (playerLevel < seed.level) return { ok: false, message: `${seed.name} se débloque au niveau ${seed.level}.` };
      if (farm.coins < seed.cost) return { ok: false, message: 'Pas assez de pièces.' };
      farm.coins -= seed.cost;
      plot.seed = seed.id;
      plot.plantedAt = now;
      plot.boost = 0;
      return { ok: true, message: `${seed.name} plantée.`, xp: 0 };
    }

    /* ── Planter partout ── */
    case 'plant-all': {
      const seed = SEEDS[payload.seed];
      if (!seed) return { ok: false, message: 'Graine inconnue.' };
      if (playerLevel < seed.level) return { ok: false, message: `${seed.name} se débloque au niveau ${seed.level}.` };
      let planted = 0;
      for (const p of farm.plots.slice(0, farm.plotCount)) {
        if (p.seed || farm.coins < seed.cost) continue;
        farm.coins -= seed.cost;
        p.seed = seed.id;
        p.plantedAt = now;
        p.boost = 0;
        planted++;
      }
      if (!planted) return { ok: false, message: 'Rien à planter (parcelles pleines ou pièces insuffisantes).' };
      return { ok: true, message: `${planted} parcelle(s) plantée(s).`, xp: 0 };
    }

    /* ── Arroser (le clic du clicker) ── */
    case 'water': {
      if (!plot || !plot.seed) return { ok: false, message: 'Rien à arroser ici.' };
      if (farm.water < 1) return { ok: false, message: 'Réservoir vide, laisse-le se remplir.' };
      if (plotProgress(farm, plot, now) >= 1) return { ok: false, message: 'Déjà prêt à récolter !' };
      farm.water -= 1;
      farm.clicks = (farm.clicks || 0) + 1;
      plot.boost = (plot.boost || 0) + WATER_BOOST_MS[farm.upgrades.can || 0];
      return { ok: true, quiet: true, xp: 0 };
    }

    /* ── Récolter ── */
    case 'harvest': {
      if (!plot || !plot.seed) return { ok: false, message: 'Parcelle vide.' };
      if (plotProgress(farm, plot, now) < 1) return { ok: false, message: 'Pas encore mûr.' };
      const value = harvestValue(farm, plot.seed);
      const name = SEEDS[plot.seed].name;
      farm.coins += value.coins;
      farm.harvested++;
      plot.seed = null;
      plot.plantedAt = 0;
      plot.boost = 0;
      return { ok: true, message: `${name} récoltée : +${value.coins} pièces, +${value.xp} XP`, xp: value.xp };
    }

    /* ── Tout récolter ── */
    case 'harvest-all': {
      let coins = 0;
      let xp = 0;
      let count = 0;
      for (const p of farm.plots.slice(0, farm.plotCount)) {
        if (p.seed && plotProgress(farm, p, now) >= 1) {
          const value = harvestValue(farm, p.seed);
          coins += value.coins;
          xp += value.xp;
          count++;
          p.seed = null;
          p.plantedAt = 0;
          p.boost = 0;
        }
      }
      if (!count) return { ok: false, message: 'Rien de mûr pour le moment.' };
      farm.coins += coins;
      farm.harvested += count;
      return { ok: true, message: `${count} récolte(s) : +${coins} pièces, +${xp} XP`, xp };
    }

    /* ── Améliorations ── */
    case 'upgrade': {
      const up = UPGRADES[payload.id];
      if (!up) return { ok: false, message: 'Amélioration inconnue.' };
      const current = farm.upgrades[up.id] || 0;
      if (current >= up.max) return { ok: false, message: 'Déjà au maximum.' };
      const cost = up.costs[current];
      if (farm.coins < cost) return { ok: false, message: 'Pas assez de pièces.' };
      farm.coins -= cost;
      farm.upgrades[up.id] = current + 1;
      return { ok: true, message: `${up.name} niveau ${current + 1} !`, xp: 25 };
    }

    /* ── Nouvelle parcelle ── */
    case 'buy-plot': {
      if (farm.plotCount >= MAX_PLOTS) return { ok: false, message: 'Ferme au maximum.' };
      const cost = plotPrice(farm.plotCount);
      if (farm.coins < cost) return { ok: false, message: 'Pas assez de pièces.' };
      farm.coins -= cost;
      farm.plotCount++;
      return { ok: true, message: `Parcelle ${farm.plotCount} défrichée !`, xp: 40 };
    }

    default:
      return { ok: false, message: 'Action inconnue.' };
  }
}

/* ─── Vue envoyée au navigateur ────────────────────────── */

function view(profile, playerLevel, now = Date.now()) {
  const farm = profile.farm;
  return {
    coins: farm.coins,
    water: farm.water,
    waterMax: WATER_MAX,
    waterEveryMs: WATER_EVERY_MS,
    harvested: farm.harvested,
    clicks: farm.clicks || 0,
    plotCount: farm.plotCount,
    maxPlots: MAX_PLOTS,
    nextPlotPrice: farm.plotCount < MAX_PLOTS ? plotPrice(farm.plotCount) : null,
    serverNow: now,
    plots: farm.plots.slice(0, farm.plotCount).map((p, i) => {
      if (!p.seed) return { index: i, seed: null };
      const total = growMsFor(farm, p.seed);
      const elapsed = Math.min(now - p.plantedAt, OFFLINE_CAP_MS) + (p.boost || 0);
      return {
        index: i,
        seed: p.seed,
        icon: SEEDS[p.seed].icon,
        name: SEEDS[p.seed].name,
        progress: Math.max(0, Math.min(1, elapsed / total)),
        // `growMs` + `readyAt` suffisent au client pour animer la barre
        // sans redemander l'état au serveur à chaque image.
        growMs: total,
        readyAt: now + Math.max(0, total - elapsed),
        value: harvestValue(farm, p.seed),
      };
    }),
    seeds: Object.values(SEEDS).map((s) => ({
      ...s,
      growMs: growMsFor(farm, s.id),
      yield: harvestValue(farm, s.id),
      locked: playerLevel < s.level,
    })),
    upgrades: Object.values(UPGRADES).map((u) => {
      const lvl = farm.upgrades[u.id] || 0;
      return {
        id: u.id,
        name: u.name,
        icon: u.icon,
        level: lvl,
        max: u.max,
        price: lvl < u.max ? u.costs[lvl] : null,
        effect: u.describe(lvl),
        next: lvl < u.max ? u.describe(lvl + 1) : null,
      };
    }),
  };
}

module.exports = { tick, act, view, SEEDS, UPGRADES, WATER_MAX, MAX_PLOTS };
