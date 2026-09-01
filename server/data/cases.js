'use strict';
/**
 * LES CAISSES.
 *
 * Deux familles :
 *
 *   • les GÉNÉRALES, qui piochent dans toute la collection et se
 *     différencient par leurs chances de sortir du rare ;
 *   • les THÉMATIQUES, qui ne piochent que dans une catégorie. Elles sont
 *     plus chères à volume égal, mais c'est le seul moyen raisonnable de
 *     compléter une catégorie précise quand il reste 518 objets à trouver.
 *
 * `boost` multiplie le poids d'une rareté. Un boost de 5 sur « mythic » ne
 * veut pas dire 5 % de chances : ça multiplie par cinq un poids qui reste
 * minuscule. Les probabilités réelles sont calculées par `odds()` et
 * affichées telles quelles au joueur.
 */

const { RARITY_ORDER, RARITIES, BY_CATEGORY, CATEGORIES } = require('./collection');

const CASES = [
  {
    id: 'starter',
    name: 'CAISSE STARTER',
    emoji: '📦',
    price: 120,
    color: '#93a1bb',
    blurb: 'Le tout-venant du web. Ça pique rarement, mais c’est gratuit toutes les dix minutes.',
    boost: {},
  },
  {
    id: 'boost',
    name: 'CAISSE RENFORCÉE',
    emoji: '🎁',
    price: 520,
    color: '#4da3ff',
    blurb: 'Deux fois plus de rares, trois fois plus d’épiques. Le bon rapport pour avancer.',
    boost: { rare: 2, epic: 3, legendary: 2 },
  },
  {
    id: 'viral',
    name: 'COFFRE VIRAL',
    emoji: '💥',
    price: 2200,
    color: '#a06bff',
    blurb: 'Les légendaires deviennent sérieusement probables.',
    boost: { common: 0.35, epic: 4, legendary: 9, mythic: 4 },
  },
  {
    id: 'relic',
    name: 'RELIQUAIRE',
    emoji: '🏛️',
    price: 9000,
    color: '#ffb03d',
    blurb: 'Pensé pour les mythiques. Cher, et assumé.',
    boost: { common: 0.06, rare: 0.3, epic: 2, legendary: 12, mythic: 30 },
  },
  {
    id: 'cursed',
    name: 'CAISSE MAUDITE',
    emoji: '💀',
    price: 26000,
    color: '#33e6c0',
    blurb: 'La seule qui donne une vraie chance au Maudit. Vingt objets sur 518.',
    boost: { common: 0.02, rare: 0.1, epic: 0.8, legendary: 8, mythic: 40, cursed: 220 },
  },
];

/* ─── Les caisses thématiques ──────────────────────────── */

/**
 * Une par catégorie. Elles ne tirent que dans leur thème, ce qui divise
 * énormément le nombre d'objets possibles : c'est ce qui rend une catégorie
 * finissable. Le prix suit la taille du thème.
 */
const THEMED = Object.values(CATEGORIES).map((cat) => ({
  id: `cat-${cat.id}`,
  name: `LOT ${cat.name.toUpperCase()}`,
  emoji: cat.icon,
  price: 900,
  color: '#3fd6ff',
  themed: cat.id,
  blurb: `Uniquement des objets « ${cat.name} » — ${BY_CATEGORY[cat.id]} à trouver dans ce thème.`,
  boost: { rare: 1.8, epic: 2.4, legendary: 1.6 },
}));

const ALL = [...CASES, ...THEMED];
const CASE_BY_ID = new Map(ALL.map((c) => [c.id, c]));

/* ─── Probabilités réelles ─────────────────────────────── */

/**
 * Les vraies chances de chaque rareté pour une caisse donnée. C'est ce qui
 * est affiché au joueur, et c'est aussi ce qui pilote le tirage : il n'y a
 * pas deux tables, une pour la vitrine et une pour de vrai.
 */
function odds(box) {
  const weights = RARITY_ORDER.map((r) => RARITIES[r].weight * ((box.boost || {})[r] || 1));
  const total = weights.reduce((a, b) => a + b, 0);
  return RARITY_ORDER.map((r, i) => ({
    rarity: r,
    name: RARITIES[r].name,
    color: RARITIES[r].color,
    percent: (weights[i] / total) * 100,
  }));
}

module.exports = { CASES: ALL, GENERAL: CASES, THEMED, CASE_BY_ID, odds };
