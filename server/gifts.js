'use strict';
/**
 * OFFRIR UNE CAISSE.
 *
 * Deux chemins : un joueur peut en offrir à un autre, et un administrateur
 * peut en distribuer sans payer.
 *
 * Un cadeau entre joueurs est un transfert de valeur, alors on le traite
 * comme tel plutôt que comme une gentillesse sans conséquence :
 *
 *  • le donneur paie le prix réel de la caisse ;
 *  • un plafond quotidien empêche de vider un compte dans un autre — sinon
 *    il suffirait de plusieurs comptes pour contourner les limites du jeu,
 *    et le classement du mois n'aurait plus aucun sens ;
 *  • on ne peut pas s'offrir un cadeau à soi-même ;
 *  • un compte tout neuf ne peut pas recevoir immédiatement : c'est la
 *    parade la plus simple contre les comptes jetables créés pour ça.
 *
 * Le cadeau arrive sous forme de bon : le receveur l'ouvre quand il veut,
 * avec la même animation que n'importe quelle caisse.
 */

const { CASE_BY_ID } = require('./data/cases');

const DAILY_LIMIT = 25000;      // pièces offertes par jour et par personne
const MAX_PER_GIFT = 10;        // caisses en une fois
const MIN_ACCOUNT_AGE_MS = 60 * 60 * 1000; // une heure d'ancienneté pour recevoir
const MAX_PENDING = 40;         // bons en attente

/* ─── Suivi du plafond ─────────────────────────────────── */

function today() {
  return new Date().toISOString().slice(0, 10);
}

function giftBudget(profile) {
  if (!profile.giftDay || profile.giftDay.date !== today()) {
    profile.giftDay = { date: today(), spent: 0 };
  }
  return profile.giftDay;
}

/* ─── Offrir ───────────────────────────────────────────── */

async function send(from, { to, caseId, count } = {}, store) {
  const box = CASE_BY_ID.get(caseId);
  if (!box) return { ok: false, message: 'Caisse inconnue.' };

  const n = Math.max(1, Math.min(MAX_PER_GIFT, Math.floor(Number(count) || 1)));
  const cost = box.price * n;

  const name = String(to || '').trim();
  if (!name) return { ok: false, message: 'À qui ?' };

  const all = await store.allProfiles();
  const target = all.find((p) => p.name.toLowerCase() === name.toLowerCase())
    || all.find((p) => p.id === name);

  if (!target) return { ok: false, message: `Personne ne s’appelle « ${name} » ici.` };
  if (target.id === from.id) return { ok: false, message: 'On ne s’offre pas de cadeau à soi-même.' };
  if (target.banned) return { ok: false, message: 'Ce compte est banni.' };

  if (Date.now() - target.createdAt < MIN_ACCOUNT_AGE_MS) {
    return { ok: false, message: 'Ce compte est trop récent pour recevoir un cadeau. Reviens dans une heure.' };
  }

  const budget = giftBudget(from);
  if (budget.spent + cost > DAILY_LIMIT) {
    const left = Math.max(0, DAILY_LIMIT - budget.spent);
    return {
      ok: false,
      message: `Plafond de cadeaux atteint pour aujourd’hui. Il te reste ${left} pièces à offrir.`,
    };
  }

  if (from.vault.coins < cost) {
    return { ok: false, message: `Il te manque ${cost - from.vault.coins} pièces.` };
  }

  if ((target.gifts || []).length >= MAX_PENDING) {
    return { ok: false, message: `${target.name} a déjà trop de cadeaux en attente.` };
  }

  from.vault.coins -= cost;
  budget.spent += cost;

  const gift = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    caseId: box.id,
    caseName: box.name,
    emoji: box.emoji,
    count: n,
    from: from.name,
    at: Date.now(),
  };

  if (!target.gifts) target.gifts = [];
  target.gifts.unshift(gift);
  await store.saveProfile(target);

  return {
    ok: true,
    message: `${n} × ${box.name} envoyée${n > 1 ? 's' : ''} à ${target.name}.`,
    gift,
    target,
    spent: budget.spent,
    left: DAILY_LIMIT - budget.spent,
  };
}

/** Version administrateur : on distribue sans payer. */
function grant(target, caseId, count = 1, by = 'administration') {
  const box = CASE_BY_ID.get(caseId);
  if (!box) return { ok: false, message: 'Caisse inconnue.' };
  const n = Math.max(1, Math.min(50, Math.floor(Number(count) || 1)));

  const gift = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    caseId: box.id,
    caseName: box.name,
    emoji: box.emoji,
    count: n,
    from: by,
    admin: true,
    at: Date.now(),
  };

  if (!target.gifts) target.gifts = [];
  target.gifts.unshift(gift);
  target.gifts.length = Math.min(target.gifts.length, MAX_PENDING);

  return { ok: true, message: `${n} × ${box.name} pour ${target.name}.`, gift };
}

const OPEN_AT_ONCE = 10; // ce qu'une animation peut montrer d'un coup

/**
 * Consomme tout ou partie d'un bon.
 *
 * Un cadeau de cinquante caisses ne s'ouvre pas d'un bloc : l'animation en
 * montre dix au maximum. On en prélève donc dix, on laisse les quarante
 * autres dans le bon, et le joueur reclique. Avant, le reste était
 * silencieusement perdu — quarante caisses envolées.
 */
function claim(profile, giftId, want = OPEN_AT_ONCE) {
  const list = profile.gifts || [];
  const index = list.findIndex((g) => g.id === giftId);
  if (index < 0) return { ok: false, message: 'Cadeau introuvable.' };

  const gift = list[index];
  const take = Math.max(1, Math.min(OPEN_AT_ONCE, Math.floor(Number(want) || OPEN_AT_ONCE), gift.count));
  const left = gift.count - take;

  if (left > 0) gift.count = left;
  else list.splice(index, 1);

  return {
    ok: true,
    gift: { ...gift, count: take },
    left,
    // De quoi remettre le bon en place si l'ouverture échoue.
    restore: () => {
      if (left > 0) gift.count = left + take;
      else list.splice(index, 0, { ...gift, count: take });
    },
  };
}

function view(profile) {
  const budget = giftBudget(profile);
  return {
    gifts: profile.gifts || [],
    dailyLimit: DAILY_LIMIT,
    spentToday: budget.spent,
    left: DAILY_LIMIT - budget.spent,
    maxPerGift: MAX_PER_GIFT,
  };
}

module.exports = { send, grant, claim, view, DAILY_LIMIT, MAX_PER_GIFT, OPEN_AT_ONCE };
