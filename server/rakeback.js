'use strict';
const ledger = require('./ledger');
/**
 * LE RAKEBACK.
 *
 * Une part de tout ce qu'on mise au casino revient au joueur, quel que soit
 * le résultat. C'est ce qui rend une mauvaise soirée supportable : on a perdu,
 * mais on n'est pas reparti les mains vides.
 *
 * Pourquoi ça ne fait pas exploser l'économie
 * ───────────────────────────────────────────
 * Les jeux redistribuent entre 95 et 97 % : sur 100 000 pièces misées, la
 * maison en DÉTRUIT donc entre 3 000 et 5 000. Le rakeback en rend 1 200.
 * Le solde reste très largement déflationniste — c'est la condition pour que
 * les pièces gardent de la valeur et que la mine reste utile.
 *
 * Si tu montes ce taux au-dessus de 3 %, tu inverses le signe : le site
 * fabrique alors plus de pièces qu'il n'en détruit, et tout se dévalue.
 *
 * Le taux monte avec le niveau : c'est la seule récompense de fidélité du
 * site, et elle est plafonnée.
 */

const BASE_RATE = 0.010;   // 1,0 % dès le premier jour
const MAX_RATE = 0.018;    // 1,8 % au niveau 60 et au-delà
const RATE_LEVEL_CAP = 60;

const MIN_CLAIM = 150;     // en dessous, on laisse le compteur monter
const COOLDOWN_MS = 30 * 60 * 1000; // une récolte toutes les 30 minutes

function blank() {
  return { pending: 0, claimed: 0, wagered: 0, lastClaimAt: 0 };
}

function ensure(profile) {
  if (!profile.rake) profile.rake = blank();
  const r = profile.rake;
  if (typeof r.pending !== 'number') r.pending = 0;
  if (typeof r.claimed !== 'number') r.claimed = 0;
  if (typeof r.wagered !== 'number') r.wagered = 0;
  if (typeof r.lastClaimAt !== 'number') r.lastClaimAt = 0;
  return r;
}

/** Le taux d'un joueur, selon son niveau de casino. */
function rateFor(level) {
  const t = Math.min(1, Math.max(0, (level - 1) / (RATE_LEVEL_CAP - 1)));
  return BASE_RATE + (MAX_RATE - BASE_RATE) * t;
}

/**
 * Enregistre une mise. Appelé pour CHAQUE mise du casino, gagnée ou perdue —
 * c'est bien le volume joué qui compte, pas le résultat.
 */
function record(profile, staked, level = 1) {
  const amount = Math.max(0, Math.floor(Number(staked) || 0));
  if (!amount) return 0;

  const r = ensure(profile);
  const gained = amount * rateFor(level);
  r.pending += gained;
  r.wagered += amount;
  return gained;
}

/** Récolte le rakeback accumulé. */
function claim(profile, now = Date.now()) {
  const r = ensure(profile);
  const amount = Math.floor(r.pending);

  if (amount < MIN_CLAIM) {
    return {
      ok: false,
      message: `Il faut au moins ${MIN_CLAIM} pièces de rakeback. Tu en as ${amount}.`,
    };
  }
  const left = r.lastClaimAt + COOLDOWN_MS - now;
  if (left > 0) {
    return {
      ok: false,
      message: `Prochaine récolte dans ${Math.ceil(left / 60000)} minutes.`,
    };
  }

  r.pending -= amount;
  r.claimed += amount;
  r.lastClaimAt = now;
  profile.vault.coins += amount;
  ledger.mint('rakeback', amount);

  return { ok: true, amount, coins: profile.vault.coins };
}

function view(profile, level = 1, now = Date.now()) {
  const r = ensure(profile);
  const rate = rateFor(level);
  const ready = Math.floor(r.pending);
  const cooldownLeft = Math.max(0, r.lastClaimAt + COOLDOWN_MS - now);

  return {
    pending: ready,
    claimed: r.claimed,
    wagered: r.wagered,
    rate: Math.round(rate * 10000) / 100, // en pourcentage
    minClaim: MIN_CLAIM,
    cooldownMs: COOLDOWN_MS,
    cooldownLeft,
    canClaim: ready >= MIN_CLAIM && cooldownLeft === 0,
    nextRate: Math.round(MAX_RATE * 10000) / 100,
    serverNow: now,
  };
}

module.exports = { blank, ensure, record, claim, view, rateFor, MIN_CLAIM, COOLDOWN_MS };
