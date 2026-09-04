'use strict';
/**
 * PALIERS, MÉDAILLES ET COSMÉTIQUES.
 *
 * Tous les cinquante objets trouvés, on décroche un palier. Chaque palier
 * donne une médaille et débloque de quoi personnaliser son pseudo : un
 * contour d'avatar, un effet de texte, une icône animée.
 *
 * Un palier se mérite, il ne se réserve pas : TOUT LE MONDE peut décrocher
 * les mêmes. Il y a eu un temps une course au « premier du site », avec une
 * version dorée réservée au premier arrivé. À quelques joueurs, ça figeait
 * tout dès la première semaine — les paliers étaient pris, et les suivants
 * recevaient une médaille estampillée du nom de quelqu'un d'autre. Ce n'est
 * pas une course, c'est une collection.
 */

const collection = require('./data/collection');

const STEP = 50;
const TOTAL = collection.TOTAL;

/* ─── Les paliers ──────────────────────────────────────── */

/**
 * Un palier tous les cinquante objets, plus un dernier pour la collection
 * complète si elle ne tombe pas rond.
 */
function buildTiers() {
  const tiers = [];
  const NAMES = [
    'Chineur', 'Collectionneur', 'Curateur', 'Archiviste', 'Conservateur',
    'Antiquaire', 'Érudit', 'Gardien', 'Bibliothécaire', 'Maître du Musée',
    'Légende Vivante',
  ];
  const COSMETICS = [
    'frame-bronze', 'name-gradient', 'frame-argent', 'badge-etoile',
    'frame-or', 'name-neon', 'badge-couronne', 'frame-arcen',
    'name-flamme', 'frame-cosmos', 'badge-relique',
  ];

  for (let i = 1; i * STEP <= TOTAL; i++) {
    tiers.push({
      id: `t${i * STEP}`,
      need: i * STEP,
      name: NAMES[Math.min(i - 1, NAMES.length - 1)],
      icon: ['🥉', '🥈', '🥇', '🎖️', '🏅', '👑', '💠', '🌟', '🔥', '🌌', '⚜️'][Math.min(i - 1, 10)],
      unlocks: COSMETICS[Math.min(i - 1, COSMETICS.length - 1)],
    });
  }

  // La collection complète mérite son propre palier même si elle ne tombe
  // pas sur un multiple de cinquante.
  if (tiers.length && tiers[tiers.length - 1].need < TOTAL) {
    tiers.push({
      id: 'full',
      need: TOTAL,
      name: 'Collection Complète',
      icon: '🏛️',
      unlocks: 'frame-mythe',
    });
  }
  return tiers;
}

const TIERS = buildTiers();
const TIER_BY_ID = new Map(TIERS.map((t) => [t.id, t]));

/* ─── Les cosmétiques ──────────────────────────────────── */

/**
 * Trois familles, qui se cumulent : un contour d'avatar, un effet sur le
 * texte du pseudo, une icône posée à côté. Le rendu est entièrement en CSS
 * côté navigateur — rien à télécharger.
 */
const COSMETICS = {
  /* Contours */
  'frame-bronze': { id: 'frame-bronze', kind: 'frame', name: 'Contour bronze', hint: 'Un liseré chaud autour de l’avatar.' },
  'frame-argent': { id: 'frame-argent', kind: 'frame', name: 'Contour argent', hint: 'Froid et net.' },
  'frame-or': { id: 'frame-or', kind: 'frame', name: 'Contour or', hint: 'Ça se voit de loin.' },
  'frame-arcen': { id: 'frame-arcen', kind: 'frame', name: 'Contour arc-en-ciel', hint: 'Il tourne lentement.' },
  'frame-cosmos': { id: 'frame-cosmos', kind: 'frame', name: 'Contour cosmos', hint: 'Un ciel étoilé qui respire.' },
  'frame-mythe': { id: 'frame-mythe', kind: 'frame', name: 'Contour du mythe', hint: 'Réservé à la collection complète.' },

  /* Effets de pseudo */
  'name-gradient': { id: 'name-gradient', kind: 'name', name: 'Pseudo dégradé', hint: 'Du vert au cyan.' },
  'name-neon': { id: 'name-neon', kind: 'name', name: 'Pseudo néon', hint: 'Il brille dans le noir.' },
  'name-flamme': { id: 'name-flamme', kind: 'name', name: 'Pseudo en flammes', hint: 'Les lettres brûlent, doucement.' },

  /* Icônes */
  'badge-etoile': { id: 'badge-etoile', kind: 'badge', name: 'Étoile animée', icon: '✨', hint: 'Elle scintille à côté de ton nom.' },
  'badge-couronne': { id: 'badge-couronne', kind: 'badge', name: 'Couronne', icon: '👑', hint: 'Discrète. Enfin, presque.' },
  'badge-relique': { id: 'badge-relique', kind: 'badge', name: 'Relique', icon: '⚜️', hint: 'Le dernier palier.' },
};

/** Ce qu'on porte par défaut : rien. */
function blankCosmetics() {
  return { frame: null, name: null, badge: null };
}

function blankMedals() {
  // `firsts` ne sert plus à rien : il date de la course au « premier du
  // site ». On le garde vide pour ne pas casser les profils déjà écrits.
  return { tiers: [], firsts: [], best: 0, at: {} };
}

/* ─── Progression ──────────────────────────────────────── */

/** Combien d'objets distincts ce profil possède-t-il ? */
function collected(profile) {
  const items = (profile.vault && profile.vault.items) || {};
  return Object.values(items).filter((n) => n > 0).length;
}

/**
 * Met le profil à jour après une ouverture de caisse.
 *
 * `records` est une trace historique, écrite mais plus jamais affichée :
 * elle date de l'époque de la course au premier. On la garde parce
 * qu'effacer un historique déjà écrit ne rend service à personne.
 */
function check(profile, records) {
  const have = collected(profile);
  if (!profile.medals) profile.medals = blankMedals();
  const medals = profile.medals;
  medals.best = Math.max(medals.best || 0, have);

  const earned = [];

  for (const tier of TIERS) {
    if (have < tier.need) break;
    if (medals.tiers.includes(tier.id)) continue;

    medals.tiers.push(tier.id);

    /*
     * Il n'y a plus de « premier du site ».
     *
     * L'idée était de récompenser celui qui arrivait le premier à chaque
     * palier. En pratique, à quelques joueurs, ça figeait la course dès la
     * première semaine : les paliers étaient tous pris, et les suivants
     * décrochaient une médaille marquée du nom de quelqu'un d'autre. Un
     * palier, ça se mérite — ça ne se réserve pas. Tout le monde peut avoir
     * les mêmes, et on garde la date à laquelle on l'a eu, pour soi.
     *
     * On continue d'écrire la trace dans l'état du site : elle ne s'affiche
     * nulle part, mais effacer un historique déjà écrit ne rend service à
     * personne.
     */
    if (records && !records[tier.id]) {
      records[tier.id] = { id: profile.id, name: profile.name, at: Date.now() };
    }
    medals.at = medals.at || {};
    medals.at[tier.id] = Date.now();

    // Le cosmétique se débloque avec le palier.
    if (!profile.unlocked) profile.unlocked = [];
    if (tier.unlocks && !profile.unlocked.includes(tier.unlocks)) {
      profile.unlocked.push(tier.unlocks);
    }

    earned.push({ ...tier });
  }

  return earned;
}

/** Le joueur choisit ce qu'il porte, parmi ce qu'il a débloqué. */
function equip(profile, kind, id) {
  if (!['frame', 'name', 'badge'].includes(kind)) {
    return { ok: false, message: 'Emplacement inconnu.' };
  }
  if (!profile.cosmetics) profile.cosmetics = blankCosmetics();

  if (!id) {
    profile.cosmetics[kind] = null;
    return { ok: true, message: 'Retiré.' };
  }

  const cosmetic = COSMETICS[id];
  if (!cosmetic) return { ok: false, message: 'Cosmétique inconnu.' };
  if (cosmetic.kind !== kind) return { ok: false, message: 'Ce cosmétique ne va pas dans cet emplacement.' };
  if (!(profile.unlocked || []).includes(id)) {
    return { ok: false, message: 'Tu n’as pas encore débloqué celui-là.' };
  }

  profile.cosmetics[kind] = id;
  return { ok: true, message: `${cosmetic.name} équipé.` };
}

/* ─── Vues ─────────────────────────────────────────────── */

/** La vitrine : les paliers décrochés, et ceux qui restent à faire. */
function view(profile) {
  const have = collected(profile);
  const medals = profile.medals || blankMedals();
  const unlocked = profile.unlocked || [];

  return {
    collected: have,
    total: TOTAL,
    step: STEP,
    tiers: TIERS.map((t) => ({
      ...t,
      done: medals.tiers.includes(t.id),
      // La date à laquelle on l'a décroché, pour soi. Aucun nom d'autre
      // joueur ne part d'ici : un palier n'appartient à personne.
      at: (medals.at || {})[t.id] || null,
      cosmetic: COSMETICS[t.unlocks] || null,
    })),
    cosmetics: Object.values(COSMETICS).map((c) => ({
      ...c,
      unlocked: unlocked.includes(c.id),
      equipped: (profile.cosmetics || {})[c.kind] === c.id,
    })),
    equipped: profile.cosmetics || blankCosmetics(),
  };
}

/** Ce qu'on montre à côté d'un pseudo, partout sur le site. */
function publicCosmetics(profile) {
  const c = profile.cosmetics || blankCosmetics();
  return {
    frame: c.frame,
    name: c.name,
    badge: c.badge ? (COSMETICS[c.badge] || {}).icon || null : null,
    // Le nombre de paliers décrochés : c'est ce qui se frime le mieux, et
    // ça ne dépend de personne d'autre.
    tiers: (profile.medals && profile.medals.tiers.length) || 0,
  };
}

module.exports = {
  TIERS, TIER_BY_ID, COSMETICS, STEP, TOTAL,
  blankMedals, blankCosmetics, collected, check, equip, view, publicCosmetics,
};
