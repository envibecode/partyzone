'use strict';
/**
 * LE MARCHÉ — revente d'objets entre joueurs.
 *
 * On met un doublon en vente au prix qu'on veut, quelqu'un l'achète, les
 * pièces changent de main. C'est le seul endroit du site où deux joueurs
 * s'échangent directement de la valeur.
 *
 * Trois garde-fous, et ils comptent
 * ─────────────────────────────────
 *
 *  • LA COMMISSION. Le vendeur touche le prix moins 8 %, et ces 8 % ne vont
 *    à personne : ils sont DÉTRUITS. C'est ce qui empêche le marché d'être
 *    une pompe à inflation et ce qui décourage de faire tourner un objet en
 *    boucle entre deux comptes complices — chaque aller-retour coûte cher.
 *
 *  • ON NE VEND QUE SES DOUBLONS. Le dernier exemplaire d'un objet reste
 *    dans la collection : on ne peut pas se vider la collection pour de
 *    l'argent, et la progression des médailles garde son sens.
 *
 *  • UN PRIX PLANCHER ET UN PLAFOND. Le plancher, c'est la valeur de
 *    revente automatique, sinon personne n'utiliserait le marché. Le
 *    plafond empêche d'afficher un objet à un milliard pour blanchir un
 *    transfert entre deux comptes.
 *
 * Les offres vivent dans l'état partagé du site, donc elles survivent aux
 * mises à jour comme le reste.
 */

const collection = require('./data/collection');
const ledger = require('./ledger');
const { ITEMS, BY_ID, RARITIES } = collection;

const FEE = 0.08;              // commission, détruite
const MAX_LISTINGS = 12;       // offres simultanées par joueur
const LISTING_MS = 7 * 24 * 60 * 60 * 1000; // une offre expire au bout d'une semaine
const MIN_MULT = 1;            // prix plancher : la valeur de revente auto
const MAX_MULT = 60;           // plafond : 60 fois cette valeur

/** La valeur de revente automatique d'un objet — le plancher du marché. */
function baseValue(item) {
  return RARITIES[item.r].dust;
}

function priceRange(item) {
  const base = baseValue(item);
  return { min: Math.max(1, Math.round(base * MIN_MULT)), max: Math.round(base * MAX_MULT), base };
}

/* ─── L'état ───────────────────────────────────────────── */

function ensure(state) {
  if (!state.market) state.market = { listings: [], nextId: 1, sales: 0, burned: 0 };
  const m = state.market;
  if (!Array.isArray(m.listings)) m.listings = [];
  if (typeof m.nextId !== 'number') m.nextId = 1;
  if (typeof m.sales !== 'number') m.sales = 0;
  if (typeof m.burned !== 'number') m.burned = 0;
  return m;
}

/** Combien d'exemplaires de cet objet ce joueur peut-il vendre ? */
function sellable(profile, itemId, market) {
  const owned = (profile.vault.items || {})[itemId] || 0;
  // Ce qui est déjà en vente ne compte plus comme disponible.
  const listed = market.listings
    .filter((l) => l.sellerId === profile.id && l.itemId === itemId)
    .reduce((sum, l) => sum + l.count, 0);
  // Le dernier exemplaire n'est jamais vendable : il reste dans la collection.
  return Math.max(0, owned - 1 - listed);
}

/* ─── Mettre en vente ──────────────────────────────────── */

function list(profile, state, { itemId, price, count = 1 } = {}, now = Date.now()) {
  const market = ensure(state);
  const item = BY_ID.get(itemId);
  if (!item) return { ok: false, message: 'Objet inconnu.' };

  const n = Math.max(1, Math.min(20, Math.floor(Number(count) || 1)));
  const asked = Math.floor(Number(price) || 0);
  const { min, max } = priceRange(item);

  if (asked < min) return { ok: false, message: `Prix minimum pour cet objet : ${min} pièces.` };
  if (asked > max) return { ok: false, message: `Prix maximum pour cet objet : ${max} pièces.` };

  const mine = market.listings.filter((l) => l.sellerId === profile.id).length;
  if (mine >= MAX_LISTINGS) {
    return { ok: false, message: `Tu as déjà ${MAX_LISTINGS} offres en cours. Retires-en une d'abord.` };
  }

  const available = sellable(profile, itemId, market);
  if (available < n) {
    return {
      ok: false,
      message: available === 0
        ? 'Tu n’as pas de doublon de cet objet. Le dernier exemplaire reste dans ta collection.'
        : `Tu n’as que ${available} doublon${available > 1 ? 's' : ''} de cet objet.`,
    };
  }

  // Les objets partent du coffre tout de suite : on ne peut pas les revendre
  // en double pendant qu'ils sont en vitrine.
  profile.vault.items[itemId] -= n;

  const listing = {
    id: market.nextId++,
    itemId,
    count: n,
    price: asked,
    sellerId: profile.id,
    sellerName: profile.name,
    at: now,
    expiresAt: now + LISTING_MS,
  };
  market.listings.push(listing);

  return { ok: true, listing, message: `${n} × ${item.name} en vente à ${asked} pièces.` };
}

/* ─── Retirer une offre ────────────────────────────────── */

function cancel(profile, state, listingId) {
  const market = ensure(state);
  const index = market.listings.findIndex((l) => l.id === Number(listingId));
  if (index < 0) return { ok: false, message: 'Cette offre n’existe plus.' };

  const listing = market.listings[index];
  // Un administrateur passe par `takeDown` : ici on rend l'objet au profil
  // qui appelle, donc laisser passer un admin lui offrirait l'objet de
  // quelqu'un d'autre. Ce n'est pas un raccourci, c'est un vol.
  if (listing.sellerId !== profile.id) {
    return { ok: false, message: 'Ce n’est pas ton offre.' };
  }

  market.listings.splice(index, 1);
  profile.vault.items[listing.itemId] = (profile.vault.items[listing.itemId] || 0) + listing.count;

  const item = BY_ID.get(listing.itemId);
  return { ok: true, message: `${item ? item.name : 'Objet'} retiré de la vente.`, listing };
}

/* ─── Retrait par un administrateur ────────────────────── */

/**
 * Sort une offre de la vitrine sans toucher aux coffres.
 *
 * L'objet doit revenir à SON vendeur, pas à l'administrateur qui a cliqué :
 * l'appelant charge le profil du vendeur et le crédite. On rend donc ici
 * l'offre retirée, à charge de qui appelle d'aller rendre l'objet.
 */
function takeDown(state, listingId) {
  const market = ensure(state);
  const index = market.listings.findIndex((l) => l.id === Number(listingId));
  if (index < 0) return { ok: false, message: 'Cette offre n’existe plus.' };
  const [listing] = market.listings.splice(index, 1);
  return { ok: true, listing, item: BY_ID.get(listing.itemId) || null };
}

/** Toutes les offres, telles quelles, pour le panel d'administration. */
function all(state) {
  const market = ensure(state);
  return market.listings.map((l) => {
    const item = BY_ID.get(l.itemId);
    return {
      id: l.id,
      itemId: l.itemId,
      name: item ? item.name : l.itemId,
      emoji: item ? item.emoji : '❔',
      r: item ? item.r : null,
      rarity: item ? RARITIES[item.r].name : '—',
      color: item ? RARITIES[item.r].color : '#888',
      base: item ? baseValue(item) : 0,
      // Le rapport au prix de revente automatique : c'est ce qui saute aux
      // yeux quand une offre est là pour transférer des pièces, pas pour vendre.
      ratio: item ? Math.round((l.price / baseValue(item)) * 10) / 10 : null,
      price: l.price,
      count: l.count,
      seller: l.sellerName,
      sellerId: l.sellerId,
      at: l.at,
      expiresAt: l.expiresAt,
    };
  }).sort((a, b) => (b.ratio || 0) - (a.ratio || 0));
}

/* ─── Acheter ──────────────────────────────────────────── */

function buy(buyer, state, listingId, sellerProfile) {
  const market = ensure(state);
  const index = market.listings.findIndex((l) => l.id === Number(listingId));
  if (index < 0) return { ok: false, message: 'Cette offre vient de partir.' };

  const listing = market.listings[index];
  if (listing.sellerId === buyer.id) {
    return { ok: false, message: 'Tu ne peux pas acheter ta propre offre. Retire-la plutôt.' };
  }
  if (buyer.vault.coins < listing.price) {
    return { ok: false, message: `Il te manque ${listing.price - buyer.vault.coins} pièces.` };
  }

  const item = BY_ID.get(listing.itemId);
  if (!item) {
    market.listings.splice(index, 1);
    return { ok: false, message: 'Cet objet n’existe plus.' };
  }

  const fee = Math.ceil(listing.price * FEE);
  const net = listing.price - fee;

  buyer.vault.coins -= listing.price;
  buyer.vault.items[listing.itemId] = (buyer.vault.items[listing.itemId] || 0) + listing.count;

  // Le vendeur peut très bien être hors ligne : on crédite son profil, que
  // l'appelant se chargera d'enregistrer.
  if (sellerProfile) {
    sellerProfile.vault.coins += net;
    if (!sellerProfile.marketSales) sellerProfile.marketSales = [];
    sellerProfile.marketSales.unshift({
      itemId: listing.itemId,
      name: item.name,
      emoji: item.emoji,
      count: listing.count,
      price: listing.price,
      net,
      buyer: buyer.name,
      at: Date.now(),
    });
    sellerProfile.marketSales.length = Math.min(sellerProfile.marketSales.length, 30);
  }

  market.listings.splice(index, 1);
  market.sales += 1;
  market.burned += fee;
  ledger.burn('marché', fee);
  if (sellerProfile) require('./store').quest(sellerProfile, 'sell', { coins: net, count: listing.count });

  return {
    ok: true,
    listing,
    item,
    paid: listing.price,
    fee,
    net,
    message: `${listing.count} × ${item.name} acheté pour ${listing.price} pièces.`,
  };
}

/* ─── Ménage ───────────────────────────────────────────── */

/**
 * Rend à leurs propriétaires les objets des offres périmées.
 * `resolve(id)` doit renvoyer le profil du vendeur, ou rien.
 */
async function sweep(state, resolve, now = Date.now()) {
  const market = ensure(state);
  const expired = market.listings.filter((l) => l.expiresAt <= now);
  if (!expired.length) return [];

  market.listings = market.listings.filter((l) => l.expiresAt > now);

  const returned = [];
  for (const listing of expired) {
    const seller = await resolve(listing.sellerId);
    if (!seller) continue;
    seller.vault.items[listing.itemId] = (seller.vault.items[listing.itemId] || 0) + listing.count;
    returned.push({ seller, listing });
  }
  return returned;
}

/* ─── Vue ──────────────────────────────────────────────── */

function view(profile, state, { sort = 'recent', rarity = 'all', search = '' } = {}) {
  const market = ensure(state);
  const q = String(search || '').trim().toLowerCase();

  const rows = market.listings
    .map((l) => {
      const item = BY_ID.get(l.itemId);
      if (!item) return null;
      const rarity_ = RARITIES[item.r];
      return {
        id: l.id,
        itemId: l.itemId,
        name: item.name,
        emoji: item.emoji,
        cat: item.cat,
        r: item.r,
        rarity: rarity_.name,
        color: rarity_.color,
        base: baseValue(item),
        price: l.price,
        count: l.count,
        seller: l.sellerName,
        mine: l.sellerId === profile.id,
        at: l.at,
        expiresAt: l.expiresAt,
        // Le rapport au prix de revente automatique : c'est ce qui dit d'un
        // coup d'œil si une offre est une affaire ou une arnaque.
        ratio: Math.round((l.price / baseValue(item)) * 10) / 10,
      };
    })
    .filter(Boolean)
    .filter((r) => rarity === 'all' || r.r === rarity)
    .filter((r) => !q || r.name.toLowerCase().includes(q));

  const sorters = {
    recent: (a, b) => b.at - a.at,
    cheap: (a, b) => a.price - b.price,
    expensive: (a, b) => b.price - a.price,
    deal: (a, b) => a.ratio - b.ratio,
  };
  rows.sort(sorters[sort] || sorters.recent);

  // Ce que le joueur peut mettre en vente : ses doublons, avec leur fourchette.
  const owned = Object.entries(profile.vault.items || {})
    .filter(([, n]) => n > 1)
    .map(([id, n]) => {
      const item = BY_ID.get(id);
      if (!item) return null;
      const range = priceRange(item);
      return {
        id,
        name: item.name,
        emoji: item.emoji,
        r: item.r,
        rarity: RARITIES[item.r].name,
        color: RARITIES[item.r].color,
        spare: sellable(profile, id, market),
        ...range,
      };
    })
    .filter(Boolean)
    .filter((o) => o.spare > 0)
    .sort((a, b) => b.base - a.base);

  return {
    listings: rows.slice(0, 120),
    total: rows.length,
    mine: market.listings.filter((l) => l.sellerId === profile.id).length,
    maxListings: MAX_LISTINGS,
    fee: Math.round(FEE * 100),
    owned,
    sales: market.sales,
    burned: market.burned,
    history: profile.marketSales || [],
    itemsTotal: ITEMS.length,
  };
}

module.exports = {
  ensure, list, cancel, takeDown, all, buy, sweep, view, priceRange, baseValue,
  FEE, MAX_LISTINGS, LISTING_MS,
};
