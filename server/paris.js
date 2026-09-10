'use strict';
/**
 * LES PARIS ENTRE POTES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REGARDER UNE PARTIE, C'EST ENNUYEUX
 * ─────────────────────────────────────────────────────────────────────────
 * À quatre, il y a toujours quelqu'un qui attend : la belote se joue à
 * quatre pile, l'Undercover démarre à trois, et celui qui arrive en retard
 * regarde. Le site lui donnait un chat et rien d'autre.
 *
 * Un pari change ça complètement. On mise cent pièces sur quelqu'un, et on
 * suit la partie d'un œil différent — on a un cheval.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA RÈGLE QUI FAIT TOUT TENIR : ON NE PARIE JAMAIS CONTRE SOI-MÊME
 * ─────────────────────────────────────────────────────────────────────────
 * Si un joueur pouvait miser sur son adversaire, il aurait tout intérêt à
 * perdre — et une partie où quelqu'un a intérêt à perdre n'est plus une
 * partie. C'est la seule règle non négociable ici :
 *
 *  · si tu joues, tu ne peux miser que SUR TOI ;
 *  · si tu ne joues pas, tu mises sur qui tu veux.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UNE MUTUELLE, PAS UNE COTE
 * ─────────────────────────────────────────────────────────────────────────
 * Le site ne fixe aucune cote : il n'a aucun moyen sérieux d'estimer les
 * chances de Momo à l'Uno, et une cote fausse serait pire que pas de cote
 * du tout. Tout part dans un pot commun, et ceux qui avaient raison se le
 * partagent au prorata de leur mise. C'est le principe du PMU, et c'est
 * exactement ce qu'on veut : ce sont les parieurs qui font la cote.
 *
 * LE SITE NE PRÉLÈVE RIEN. Le pot ressort entier. Le site n'a aucune raison
 * de vouloir qu'on parie plus.
 *
 * LES PARIS FERMENT AU LANCEMENT DE LA PARTIE. Après, on connaît la donne,
 * la première main, le mot de l'Undercover — miser à ce moment-là n'est
 * plus parier, c'est encaisser.
 *
 * PERSONNE N'AVAIT RAISON ? TOUT LE MONDE EST REMBOURSÉ. Un pot qui
 * disparaît parce que le vainqueur n'avait aucun parieur, c'est de l'argent
 * détruit sans raison — et une bonne façon de dégoûter tout le monde.
 */

const MIN_MISE = 50;
const MAX_MISE = 20000;      // par personne et par partie

/** Les pots ouverts, par code de salon. */
const pots = new Map();

function open(room, now = Date.now()) {
  if (pots.has(room.code)) return pots.get(room.code);
  const pot = {
    code: room.code,
    game: room.game,
    gameName: room.gameName,
    open: true,
    bets: [],
    at: now,
    result: null,
  };
  pots.set(room.code, pot);
  return pot;
}

function of(code) { return pots.get(String(code || '').toUpperCase()); }

/** Le total misé sur chaque joueur. */
function tally(pot) {
  const out = {};
  for (const b of pot.bets) {
    if (!out[b.on]) out[b.on] = { id: b.on, name: b.onName, total: 0, parieurs: 0 };
    out[b.on].total += b.amount;
    out[b.on].parieurs += 1;
  }
  return Object.values(out).sort((a, b) => b.total - a.total);
}

function total(pot) {
  return pot.bets.reduce((n, b) => n + b.amount, 0);
}

/** Ce qu'une personne a déjà misé sur ce pot. */
function mise(pot, userId) {
  return pot.bets.filter((b) => b.id === userId).reduce((n, b) => n + b.amount, 0);
}

/**
 * Poser un pari.
 *
 * On ne touche à aucune pièce ici : l'appelant vérifie le solde et débite.
 *
 * @param {object} pot
 * @param {object} qui    { id, name }
 * @param {object} sur    { id, name } — un joueur de la partie
 * @param {number} amount
 * @param {boolean} joueur  est-ce que « qui » est dans la partie ?
 */
function place(pot, qui, sur, amount, { joueur = false } = {}, now = Date.now()) {
  if (!pot || !pot.open) return { ok: false, message: 'Les paris sont fermés sur cette partie.' };
  if (!sur || !sur.id) return { ok: false, message: 'Ce joueur n’est pas dans la partie.' };

  // LA règle. Elle est ici, en haut, et nulle part ailleurs.
  if (joueur && sur.id !== qui.id) {
    return { ok: false, message: 'Tu joues cette partie : tu ne peux miser que sur toi.' };
  }

  const m = Math.floor(Number(amount) || 0);
  if (m < MIN_MISE) return { ok: false, message: `Mise minimum : ${MIN_MISE} pièces.` };

  const deja = mise(pot, qui.id);
  if (deja + m > MAX_MISE) {
    return { ok: false, message: `Maximum ${MAX_MISE.toLocaleString('fr-FR')} pièces par partie (tu en as déjà ${deja.toLocaleString('fr-FR')}).` };
  }

  // Deux paris sur deux personnes différentes reviendraient à parier sur
  // tout le monde et à récupérer sa mise à coup sûr : le pot ne serait plus
  // un pari, juste une file d'attente. Un seul cheval par personne.
  const autre = pot.bets.find((b) => b.id === qui.id && b.on !== sur.id);
  if (autre) return { ok: false, message: `Tu as déjà misé sur ${autre.onName}.` };

  pot.bets.push({
    id: qui.id, name: qui.name,
    on: sur.id, onName: sur.name,
    amount: m, at: now,
  });
  return { ok: true, amount: m, total: total(pot) };
}

/** La partie commence : plus personne ne mise. */
function close(pot, now = Date.now()) {
  if (!pot || !pot.open) return false;
  pot.open = false;
  pot.closedAt = now;
  return true;
}

/**
 * Le règlement.
 *
 * @returns {{pot:number, winners:string[], payouts:Array<{id,name,amount,mise}>, refund:boolean}}
 */
function settle(pot, ranking, now = Date.now()) {
  if (!pot || pot.result) return null;
  close(pot, now);

  if (!pot.bets.length) {
    pot.result = { pot: 0, winners: [], payouts: [], refund: false, at: now };
    return pot.result;
  }

  const scores = (ranking || []).filter((r) => r && r.id);

  /*
   * LE CHEVAL QUI NE PREND PAS LE DÉPART.
   *
   * Quelqu'un a misé sur Momo, et Momo a quitté le salon avant le début.
   * Sa mise n'a plus d'objet : elle lui est rendue, et elle ne rejoint pas
   * le pot des autres. Sans ça, partir d'un salon reviendrait à confisquer
   * l'argent de celui qui vous faisait confiance.
   */
  const partants = new Set(scores.map((r) => r.id));
  const absents = pot.bets.filter((b) => !partants.has(b.on));
  const rendus = absents.map((b) => ({ id: b.id, name: b.name, amount: b.amount, mise: b.amount, on: b.onName, absent: true }));
  const enJeu = pot.bets.filter((b) => partants.has(b.on));

  const pool = enJeu.reduce((n, b) => n + b.amount, 0);
  if (!pool) {
    pot.result = { pot: 0, winners: [], payouts: rendus, refund: true, at: now };
    return pot.result;
  }
  const best = scores.length ? Math.max(...scores.map((r) => r.score)) : null;
  const winners = best === null ? [] : scores.filter((r) => r.score === best).map((r) => r.id);

  const gagnants = enJeu.filter((b) => winners.includes(b.on));
  const misesGagnantes = gagnants.reduce((n, b) => n + b.amount, 0);

  // Personne n'avait raison (ou la partie n'a pas de vainqueur) : chacun
  // récupère exactement ce qu'il a posé.
  if (!misesGagnantes) {
    pot.result = {
      pot: pool, winners, refund: true, at: now,
      payouts: [...rendus, ...enJeu.map((b) => ({ id: b.id, name: b.name, amount: b.amount, mise: b.amount, on: b.onName }))],
    };
    return pot.result;
  }

  const payouts = gagnants.map((b) => ({
    id: b.id, name: b.name, mise: b.amount, on: b.onName,
    amount: Math.floor(pool * (b.amount / misesGagnantes)),
  }));

  /*
   * L'arrondi laisse toujours quelques pièces au fond du pot. On ne les
   * détruit pas : elles vont au plus gros parieur gagnant. C'est arbitraire
   * mais constant, et ça garantit que la somme versée est EXACTEMENT la
   * somme misée — c'est cette égalité-là qu'un banc d'essai peut vérifier.
   */
  const reste = pool - payouts.reduce((n, p) => n + p.amount, 0);
  if (reste > 0 && payouts.length) {
    const gros = payouts.reduce((a, b) => (b.mise > a.mise ? b : a), payouts[0]);
    gros.amount += reste;
  }

  pot.result = { pot: pool, winners, payouts: [...rendus, ...payouts], refund: false, at: now };
  return pot.result;
}

/** La partie n'aura pas lieu : tout le monde récupère sa mise. */
function cancel(pot, raison = 'partie annulée', now = Date.now()) {
  if (!pot || pot.result) return null;
  close(pot, now);
  pot.result = {
    pot: total(pot), winners: [], refund: true, raison, at: now,
    payouts: pot.bets.map((b) => ({ id: b.id, name: b.name, amount: b.amount, mise: b.amount, on: b.onName })),
  };
  return pot.result;
}

/** Ce que voit le navigateur. */
function view(pot, userId = null) {
  if (!pot) return null;
  return {
    code: pot.code,
    open: pot.open,
    total: total(pot),
    tally: tally(pot),
    mine: pot.bets.filter((b) => b.id === userId).map((b) => ({ on: b.on, onName: b.onName, amount: b.amount })),
    parieurs: new Set(pot.bets.map((b) => b.id)).size,
    result: pot.result,
    min: MIN_MISE,
    max: MAX_MISE,
  };
}

/**
 * Le ménage : les pots dont le salon a disparu sans règlement sont à
 * rembourser (l'appelant rembourse), les pots réglés partent au bout d'un
 * quart d'heure.
 */
function sweep(roomsRegistry, now = Date.now()) {
  const perdus = [];
  for (const pot of [...pots.values()]) {
    const salon = roomsRegistry.get(pot.code);
    if (!salon && !pot.result) { perdus.push(pot); continue; }
    if (pot.result && now - pot.result.at > 15 * 60 * 1000) pots.delete(pot.code);
    if (!salon && pot.result) pots.delete(pot.code);
  }
  return perdus;
}

function saveAll() {
  return [...pots.values()].filter((p) => !p.result);
}

function restoreAll(saved) {
  let n = 0;
  for (const p of saved || []) {
    if (!p || !p.code) continue;
    pots.set(p.code, { ...p, bets: p.bets || [] });
    n += 1;
  }
  return n;
}

module.exports = {
  open, of, place, close, settle, cancel, view, tally, total, mise, sweep,
  saveAll, restoreAll, pots, MIN_MISE, MAX_MISE,
};
