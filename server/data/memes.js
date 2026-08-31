'use strict';
/**
 * Catalogue de MEMEVAULT.
 *
 * Chaque item est un meme d'internet représenté par un emoji et un nom :
 * aucune image externe, donc rien à héberger et rien à charger.
 * `r` est la rareté, qui détermine les points, la valeur de revente
 * des doublons, et l'effet visuel à l'ouverture.
 */

const RARITIES = {
  common: {
    id: 'common',
    name: 'COMMUN',
    color: '#9aa3b2',
    glow: 'rgba(154,163,178,.5)',
    xp: 6,
    dust: 8,
    weight: 5800,
  },
  rare: {
    id: 'rare',
    name: 'RARE',
    color: '#4da3ff',
    glow: 'rgba(77,163,255,.55)',
    xp: 22,
    dust: 32,
    weight: 2600,
  },
  epic: {
    id: 'epic',
    name: 'ÉPIQUE',
    color: '#b56cff',
    glow: 'rgba(181,108,255,.6)',
    xp: 80,
    dust: 120,
    weight: 1050,
  },
  legendary: {
    id: 'legendary',
    name: 'LÉGENDAIRE',
    color: '#ffb020',
    glow: 'rgba(255,176,32,.65)',
    xp: 280,
    dust: 430,
    weight: 450,
  },
  mythic: {
    id: 'mythic',
    name: 'MYTHIQUE',
    color: '#ff3d71',
    glow: 'rgba(255,61,113,.7)',
    xp: 950,
    dust: 1600,
    weight: 90,
  },
  cursed: {
    id: 'cursed',
    name: 'MAUDIT',
    color: '#25f4c8',
    glow: 'rgba(37,244,200,.75)',
    xp: 3200,
    dust: 5200,
    weight: 10,
  },
};

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic', 'cursed'];

/** [id, emoji, nom, rareté] */
const MEMES = [
  /* ── COMMUN ─────────────────────────────────────────── */
  ['doge', '🐕', 'Doge', 'common'],
  ['trollface', '😈', 'Troll Face', 'common'],
  ['lolcat', '🐱', 'LOLcat', 'common'],
  ['rickroll', '🎵', 'Rickroll', 'common'],
  ['pepe', '🐸', 'Pepe Triste', 'common'],
  ['facepalm', '🤦', 'Facepalm', 'common'],
  ['stonks', '📈', 'Stonks', 'common'],
  ['notstonks', '📉', 'Not Stonks', 'common'],
  ['wojak', '😐', 'Wojak', 'common'],
  ['bruh', '💀', 'Bruh Moment', 'common'],
  ['npc', '🤖', 'NPC', 'common'],
  ['cringe', '😬', 'Cringe', 'common'],
  ['ratio', '➗', 'Ratio', 'common'],
  ['yeet', '🚀', 'Yeet', 'common'],
  ['copium', '💊', 'Copium', 'common'],
  ['sadge', '😢', 'Sadge', 'common'],
  ['popcorn', '🍿', 'Popcorn Guy', 'common'],

  /* ── RARE ───────────────────────────────────────────── */
  ['nyancat', '🌈', 'Nyan Cat', 'rare'],
  ['shrek', '🧅', 'Shrek Onion', 'rare'],
  ['chad', '💪', 'Chad', 'rare'],
  ['karen', '💇', 'Karen', 'rare'],
  ['bigbrain', '🧠', 'Big Brain', 'rare'],
  ['sus', '🔴', 'Sus', 'rare'],
  ['cheems', '🐶', 'Cheems', 'rare'],
  ['bonk', '🔨', 'Bonk', 'rare'],
  ['moai', '🗿', 'Moai', 'rare'],
  ['coffin', '⚰️', 'Coffin Dance', 'rare'],
  ['vibecheck', '✅', 'Vibe Check', 'rare'],
  ['touchgrass', '🌱', 'Touch Grass', 'rare'],
  ['sheesh', '🦅', 'Sheesh', 'rare'],
  ['fumo', '🧸', 'Fumo', 'rare'],
  ['catjam', '🎧', 'Cat Jam', 'rare'],
  ['clown', '🤡', 'Clown Makeup', 'rare'],

  /* ── ÉPIQUE ─────────────────────────────────────────── */
  ['deepfried', '🍟', 'Deep Fried', 'epic'],
  ['galaxybrain', '🌌', 'Galaxy Brain', 'epic'],
  ['thisisfine', '🔥', 'This Is Fine', 'epic'],
  ['drake', '👉', 'Drake Approves', 'epic'],
  ['pikachu', '⚡', 'Surprised Pikachu', 'epic'],
  ['kermit', '☕', 'Kermit Tea', 'epic'],
  ['bellcurve', '📊', 'Bell Curve', 'epic'],
  ['trollge', '😱', 'Trollge', 'epic'],
  ['spiderman', '🕷️', 'Spider-Man Pointing', 'epic'],
  ['distracted', '👀', 'Distracted BF', 'epic'],
  ['gigachad', '🦾', 'Gigachad', 'epic'],
  ['buttons', '🔘', 'Two Buttons', 'epic'],

  /* ── LÉGENDAIRE ─────────────────────────────────────── */
  ['rickastley', '🕺', 'Rick Astley', 'legendary'],
  ['sigma', '😎', 'Sigma Grindset', 'legendary'],
  ['ohio', '🌽', 'Ohio Final Boss', 'legendary'],
  ['skibidi', '🚽', 'Skibidi', 'legendary'],
  ['backrooms', '🟨', 'Backrooms', 'legendary'],
  ['johnpork', '🐷', 'John Pork', 'legendary'],
  ['goofy', '🤪', 'Goofy Ahh', 'legendary'],
  ['grimace', '🟣', 'Grimace Shake', 'legendary'],

  /* ── MYTHIQUE ───────────────────────────────────────── */
  ['goldendoge', '👑', 'Doge Doré', 'mythic'],
  ['ancientmoai', '🌋', 'Moai Ancestral', 'mythic'],
  ['prismacat', '💠', 'Nyan Prismatique', 'mythic'],
  ['lemonke', '🐵', 'Le Monke', 'mythic'],
  ['cosmicwojak', '🌠', 'Wojak Cosmique', 'mythic'],

  /* ── MAUDIT ─────────────────────────────────────────── */
  ['original', '🥇', 'Le Meme Originel', 'cursed'],
  ['notfound', '❓', '404 Meme Not Found', 'cursed'],
].map(([id, emoji, name, r]) => ({ id, emoji, name, r }));

const BY_ID = new Map(MEMES.map((m) => [m.id, m]));
const BY_RARITY = RARITY_ORDER.reduce((acc, r) => {
  acc[r] = MEMES.filter((m) => m.r === r);
  return acc;
}, {});

/**
 * Les caisses. `boost` multiplie le poids d'une rareté par rapport
 * aux poids de base : plus la caisse est chère, plus le haut du tableau
 * devient atteignable.
 */
const CASES = [
  {
    id: 'starter',
    name: 'CAISSE STARTER',
    emoji: '📦',
    price: 60,
    color: '#9aa3b2',
    blurb: 'Le tout-venant du web. Ça pique rarement.',
    boost: {},
  },
  {
    id: 'meme',
    name: 'BOOSTER MEME',
    emoji: '🎁',
    price: 260,
    color: '#4da3ff',
    blurb: 'Trois fois plus de chances de sortir un épique.',
    boost: { rare: 1.5, epic: 3, legendary: 2.4, mythic: 2, cursed: 1.6 },
  },
  {
    id: 'viral',
    name: 'COFFRE VIRAL',
    emoji: '💥',
    price: 1100,
    color: '#ffb020',
    blurb: 'Les légendaires deviennent sérieusement probables.',
    boost: { common: 0.45, rare: 1.2, epic: 4, legendary: 9, mythic: 6, cursed: 5 },
  },
  {
    id: 'cursed',
    name: 'CAISSE MAUDITE',
    emoji: '☠️',
    price: 4200,
    color: '#25f4c8',
    blurb: 'La seule qui donne une vraie chance au Maudit.',
    boost: { common: 0.15, rare: 0.6, epic: 3, legendary: 14, mythic: 22, cursed: 40 },
  },
];

const CASE_BY_ID = new Map(CASES.map((c) => [c.id, c]));

/** Probabilités affichées au joueur, en pourcentage, pour une caisse donnée. */
function odds(box) {
  const weights = RARITY_ORDER.map((r) => RARITIES[r].weight * (box.boost[r] || 1));
  const total = weights.reduce((a, b) => a + b, 0);
  return RARITY_ORDER.map((r, i) => ({
    rarity: r,
    name: RARITIES[r].name,
    color: RARITIES[r].color,
    percent: (weights[i] / total) * 100,
  }));
}

module.exports = { MEMES, BY_ID, BY_RARITY, RARITIES, RARITY_ORDER, CASES, CASE_BY_ID, odds };
