'use strict';
/**
 * MEMEVAULT — l'ouverture de caisses.
 *
 * Le principe : on achète une caisse avec des pièces, on l'ouvre, on tire un
 * meme selon les probabilités de la caisse. Les doublons se revendent en
 * pièces, ce qui permet de rouvrir : la boucle ne s'arrête jamais.
 *
 * « Plus tu en ouvres, plus tu gagnes » se joue sur le COMBO : chaque
 * ouverture enchaînée dans la minute et demie fait grimper un multiplicateur
 * de points, jusqu'à x2.5. Arrête-toi trop longtemps et il retombe.
 *
 * Tout est calculé ici, côté serveur. Le navigateur ne fait qu'afficher.
 */
const { MEMES, BY_ID, RARITIES, RARITY_ORDER, CASES, CASE_BY_ID, odds } = require('./data/memes');

const COMBO_WINDOW_MS = 90 * 1000; // au-delà, le combo retombe
const COMBO_MAX = 25;
const COMBO_STEP = 0.06; // +6 % de points par palier
const FREE_CASE_MS = 10 * 60 * 1000; // une caisse offerte toutes les 10 minutes
const RESCUE_MS = 30 * 1000; // fauché ? une caisse de secours toutes les 30 s
const FREE_CASE_ID = 'starter';
const MAX_BATCH = 10;

/* ─── État par défaut ──────────────────────────────────── */

function blankVault(now = Date.now()) {
  return {
    coins: 300, // de quoi ouvrir quelques caisses tout de suite
    items: {}, // memeId → nombre possédés
    opened: 0,
    dustEarned: 0,
    combo: 0,
    comboAt: 0,
    freeAt: now, // la première caisse gratuite est disponible immédiatement
    rescueAt: 0, // le filet de sécurité : on ne peut jamais rester bloqué
    best: null, // le meilleur item jamais tiré
  };
}

/* ─── Tirage ───────────────────────────────────────────── */

function rarityWeights(box) {
  return RARITY_ORDER.map((r) => RARITIES[r].weight * (box.boost[r] || 1));
}

function rollRarity(box) {
  const weights = rarityWeights(box);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return RARITY_ORDER[i];
  }
  return 'common';
}

function rollItem(box) {
  const rarity = rollRarity(box);
  const pool = MEMES.filter((m) => m.r === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ─── Combo ────────────────────────────────────────────── */

function currentCombo(vault, now) {
  if (!vault.comboAt || now - vault.comboAt > COMBO_WINDOW_MS) return 0;
  return vault.combo;
}

function comboMultiplier(combo) {
  return 1 + Math.min(combo, COMBO_MAX) * COMBO_STEP;
}

/* ─── Le bandeau qui défile ────────────────────────────── */

const REEL_LENGTH = 58;
const REEL_WIN_INDEX = 50; // l'item gagnant, assez loin pour laisser le temps de freiner

/**
 * Construit la bande d'items qui défile devant le curseur, façon caisse CS:GO.
 * Les leurres sont tirés dans la vraie distribution de la caisse : ce que tu
 * vois défiler est exactement ce que tu aurais pu obtenir, avec les bonnes
 * fréquences. Rien n'est mis là pour faire joli.
 */
function buildReel(box, winner) {
  const strip = [];
  for (let i = 0; i < REEL_LENGTH; i++) {
    const item = i === REEL_WIN_INDEX ? winner : rollItem(box);
    const rarity = RARITIES[item.r];
    strip.push({
      id: item.id,
      emoji: item.emoji,
      name: item.name,
      r: item.r,
      rarity: rarity.name,
      color: rarity.color,
      glow: rarity.glow,
    });
  }
  return { strip, winIndex: REEL_WIN_INDEX };
}

/* ─── Ouverture ────────────────────────────────────────── */

/**
 * Ouvre `count` caisses. Retourne le détail de chaque tirage, l'XP à créditer
 * au profil, et l'état du combo après coup.
 */
function open(profile, caseId, count = 1, now = Date.now()) {
  const vault = profile.vault;
  const box = CASE_BY_ID.get(caseId);
  if (!box) return { ok: false, message: 'Caisse inconnue.' };

  const n = Math.max(1, Math.min(MAX_BATCH, Math.floor(Number(count) || 1)));

  // Deux façons d'ouvrir sans payer, toutes deux limitées à la caisse starter :
  // la caisse offerte toutes les 10 minutes, et le filet de sécurité qui garantit
  // qu'on n'est JAMAIS bloqué faute de pièces.
  const isStarter = caseId === FREE_CASE_ID;
  const timerFree = isStarter && now >= vault.freeAt;
  const rescueFree = isStarter && !timerFree && vault.coins < box.price && now >= (vault.rescueAt || 0);
  const freeReady = timerFree || rescueFree;

  const paidCount = freeReady ? n - 1 : n;
  const cost = box.price * paidCount;

  if (cost > vault.coins) {
    return {
      ok: false,
      message: `Il te manque ${cost - vault.coins} pièces. Revends des doublons, joue une partie, ou prends la caisse de secours.`,
    };
  }

  vault.coins -= cost;
  if (timerFree) vault.freeAt = now + FREE_CASE_MS;
  if (rescueFree) vault.rescueAt = now + RESCUE_MS;

  let combo = currentCombo(vault, now);
  const pulls = [];
  let xp = 0;
  let dust = 0;

  for (let i = 0; i < n; i++) {
    const item = rollItem(box);
    const rarity = RARITIES[item.r];
    const owned = vault.items[item.id] || 0;
    const isNew = owned === 0;

    combo = Math.min(COMBO_MAX, combo + 1);
    const mult = comboMultiplier(combo);
    const gained = Math.round(rarity.xp * mult * (isNew ? 1.5 : 1));
    const refund = isNew ? 0 : rarity.dust;

    vault.items[item.id] = owned + 1;
    xp += gained;
    dust += refund;

    if (!vault.best || RARITY_ORDER.indexOf(item.r) > RARITY_ORDER.indexOf(vault.best.r)) {
      vault.best = { id: item.id, r: item.r, at: now };
    }

    pulls.push({
      ...item,
      rarity: rarity.name,
      color: rarity.color,
      glow: rarity.glow,
      isNew,
      xp: gained,
      dust: refund,
      combo,
      mult: Number(mult.toFixed(2)),
      count: owned + 1,
      reel: buildReel(box, item),
    });
  }

  vault.coins += dust;
  vault.dustEarned += dust;
  vault.opened += n;
  vault.combo = combo;
  vault.comboAt = now;

  return {
    ok: true,
    pulls,
    xp,
    dust,
    spent: cost,
    free: freeReady,
    rescue: rescueFree,
    caseId,
    caseName: box.name,
  };
}

/** Revend d'un coup tous les exemplaires en double. */
function sellDuplicates(profile) {
  const vault = profile.vault;
  let coins = 0;
  let count = 0;
  for (const [id, owned] of Object.entries(vault.items)) {
    const item = BY_ID.get(id);
    if (!item || owned <= 1) continue;
    const extra = owned - 1;
    coins += RARITIES[item.r].dust * extra;
    count += extra;
    vault.items[id] = 1;
  }
  if (!count) return { ok: false, message: 'Aucun doublon à revendre.' };
  vault.coins += coins;
  vault.dustEarned += coins;
  return { ok: true, message: `${count} doublon(s) revendu(s) : +${coins} pièces.`, coins, count };
}

/* ─── Vue envoyée au navigateur ────────────────────────── */

function view(profile, now = Date.now()) {
  const vault = profile.vault;
  const combo = currentCombo(vault, now);

  const owned = Object.entries(vault.items).filter(([, n]) => n > 0);
  const byRarity = RARITY_ORDER.map((r) => {
    const total = MEMES.filter((m) => m.r === r).length;
    const have = owned.filter(([id]) => BY_ID.get(id) && BY_ID.get(id).r === r).length;
    return { rarity: r, name: RARITIES[r].name, color: RARITIES[r].color, have, total };
  });

  return {
    coins: vault.coins,
    opened: vault.opened,
    dustEarned: vault.dustEarned,
    combo,
    comboMax: COMBO_MAX,
    comboMult: Number(comboMultiplier(combo).toFixed(2)),
    comboExpiresAt: combo ? vault.comboAt + COMBO_WINDOW_MS : null,
    serverNow: now,
    freeAt: vault.freeAt,
    freeReady: now >= vault.freeAt,
    rescueReady: vault.coins < 60 && now >= (vault.rescueAt || 0),
    rescueAt: vault.rescueAt || 0,
    freeCaseId: FREE_CASE_ID,
    duplicates: owned.reduce((sum, [, n]) => sum + Math.max(0, n - 1), 0),
    collection: {
      have: owned.length,
      total: MEMES.length,
      byRarity,
    },
    best: vault.best ? { ...BY_ID.get(vault.best.id), color: RARITIES[vault.best.r].color, rarity: RARITIES[vault.best.r].name } : null,
    cases: CASES.map((c) => ({
      id: c.id,
      name: c.name,
      emoji: c.emoji,
      price: c.price,
      color: c.color,
      blurb: c.blurb,
      odds: odds(c).map((o) => ({ ...o, percent: Number(o.percent.toFixed(o.percent < 1 ? 2 : 1)) })),
    })),
    items: MEMES.map((m) => ({
      ...m,
      rarity: RARITIES[m.r].name,
      color: RARITIES[m.r].color,
      count: vault.items[m.id] || 0,
    })),
  };
}

module.exports = { blankVault, open, sellDuplicates, view, buildReel, CASES, FREE_CASE_MS, RESCUE_MS, COMBO_MAX };
