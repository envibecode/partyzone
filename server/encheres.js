'use strict';
/**
 * LES ENCHÈRES DU DIMANCHE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UN RENDEZ-VOUS, PAS UNE BOUTIQUE
 * ─────────────────────────────────────────────────────────────────────────
 * Le site est ouvert tout le temps, et c'est son problème : quand tout est
 * possible à toute heure, plus rien n'est un événement. Les enchères ne
 * durent qu'un dimanche. Un seul objet, une seule fois par semaine, et
 * quand c'est fini, c'est fini.
 *
 * L'objet est tiré de la semaine elle-même : tout le monde voit le même,
 * il est annoncé d'avance, et personne ne peut le choisir — ni un
 * administrateur, ni le hasard d'un tirage secret.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * OÙ PART L'ARGENT : IL EST DÉTRUIT
 * ─────────────────────────────────────────────────────────────────────────
 * C'est le point important, et il est délibéré. La mise gagnante ne va à
 * personne : elle sort de l'économie.
 *
 * Un site où l'on gagne des pièces en jouant a besoin d'endroits où elles
 * disparaissent, sinon tout le monde finit millionnaire et plus rien n'a de
 * valeur — les caisses, la commission du marché et les enchères jouent ce
 * rôle. Et surtout : si le pot allait à quelqu'un, l'enchère deviendrait un
 * transfert entre joueurs, donc un moyen de faire monter un copain au
 * classement. Détruites, les pièces ne profitent à personne.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CONTRE LE TIR AU DERNIER MOMENT
 * ─────────────────────────────────────────────────────────────────────────
 * Une enchère qui ferme à l'heure pile récompense celui qui a une horloge,
 * pas celui qui veut l'objet. Toute mise déposée dans les trois dernières
 * minutes REPOUSSE la fin de trois minutes. On ne gagne donc jamais en
 * arrivant à la dernière seconde : il faut que plus personne ne veuille
 * suivre.
 */

const { ITEMS, RARITIES } = require('./data/collection');

/** Le dimanche, de midi à 21 h (heure de Paris ≈ UTC+2 l'été). */
const JOUR = 0;                 // 0 = dimanche
const DEBUT_H = 10;             // 12 h à Paris en été
const FIN_H = 19;               // 21 h à Paris en été
const PROLONGE_MS = 3 * 60 * 1000;
const FIN_MAX_H = 20;           // on ne prolonge pas indéfiniment

const PAS = 0.05;               // il faut monter d'au moins 5 %
const DEPART = 3;               // prix de départ : trois fois la valeur de revente

/** Les objets dignes d'une enchère : rien en dessous d'épique. */
const LOTS = ITEMS.filter((i) => ['epic', 'legendary', 'mythic'].includes(i.r));

/** La semaine ISO — le même repère que le prix Citron. */
function semaine(now = Date.now()) {
  const d = new Date(now);
  const jeudi = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  jeudi.setUTCDate(jeudi.getUTCDate() + 3 - ((jeudi.getUTCDay() + 6) % 7));
  const debut = new Date(Date.UTC(jeudi.getUTCFullYear(), 0, 4));
  const n = 1 + Math.round(((jeudi - debut) / 86400000 - 3 + ((debut.getUTCDay() + 6) % 7)) / 7);
  return `${jeudi.getUTCFullYear()}-S${String(n).padStart(2, '0')}`;
}

/** Le dimanche de la semaine en cours, à l'heure d'ouverture. */
function dimanche(now = Date.now()) {
  const d = new Date(now);
  const jours = (JOUR - d.getUTCDay() + 7) % 7;
  const jour = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + jours, DEBUT_H));
  // Si on est dimanche APRÈS l'ouverture, c'est bien celui d'aujourd'hui.
  if (jours === 0 && now < jour.getTime() - 0) return jour.getTime();
  return jour.getTime();
}

/**
 * Le lot de la semaine, tiré de la clé de semaine.
 *
 * Déterministe : le même pour tout le monde, connu d'avance, et impossible
 * à influencer. C'est le même principe que les défis du jour.
 */
function lot(cle) {
  let h = 0;
  for (const ch of cle) h = (h * 31 + ch.codePointAt(0)) % 2147483647;
  return LOTS[h % LOTS.length];
}

function prixDepart(item) {
  return Math.round(RARITIES[item.r].dust * DEPART);
}

function ensure(state, now = Date.now()) {
  const cle = semaine(now);
  if (!state.enchere || state.enchere.semaine !== cle) {
    const debut = dimanche(now);
    const item = lot(cle);
    state.enchere = {
      semaine: cle,
      itemId: item.id,
      debut,
      fin: debut + (FIN_H - DEBUT_H) * 3600000,
      finMax: debut + (FIN_MAX_H - DEBUT_H) * 3600000,
      depart: prixDepart(item),
      bids: [],
      closed: false,
      result: null,
    };
  }
  return state.enchere;
}

const meilleur = (e) => (e.bids.length ? e.bids[e.bids.length - 1] : null);

/** Le minimum à poser pour prendre la tête. */
function minimum(e) {
  const top = meilleur(e);
  return top ? Math.max(top.amount + 1, Math.ceil(top.amount * (1 + PAS))) : e.depart;
}

const ouverte = (e, now = Date.now()) => !e.closed && now >= e.debut && now < e.fin;

/**
 * Poser une mise.
 *
 * Renvoie aussi QUI vient d'être dépassé : sa mise doit lui être rendue,
 * et c'est l'appelant qui la rend.
 */
function miser(e, qui, montant, now = Date.now()) {
  if (e.closed) return { ok: false, message: 'L’enchère est terminée.' };
  if (now < e.debut) return { ok: false, message: 'L’enchère n’a pas commencé.' };
  if (now >= e.fin) return { ok: false, message: 'L’enchère est close.' };

  const m = Math.floor(Number(montant) || 0);
  const mini = minimum(e);
  if (m < mini) return { ok: false, message: `Il faut au moins ${mini.toLocaleString('fr-FR')} pièces.` };

  const top = meilleur(e);
  if (top && top.id === qui.id) {
    return { ok: false, message: 'Tu es déjà en tête : inutile de surenchérir contre toi-même.' };
  }

  e.bids.push({ id: qui.id, name: qui.name, amount: m, at: now });

  /*
   * Le sursis. Une mise dans les trois dernières minutes repousse la fin
   * d'autant : on ne gagne pas au chronomètre, on gagne parce que plus
   * personne ne suit.
   */
  let prolonge = false;
  if (e.fin - now < PROLONGE_MS) {
    e.fin = Math.min(e.finMax, now + PROLONGE_MS);
    prolonge = true;
  }

  return { ok: true, amount: m, prolonge, fin: e.fin, depasse: top || null };
}

/**
 * La clôture. Le gagnant reçoit l'objet ; sa mise est DÉTRUITE.
 * Les autres ont déjà été remboursés au fur et à mesure.
 */
function clore(e, now = Date.now()) {
  if (e.closed) return null;
  if (now < e.fin) return null;

  e.closed = true;
  const top = meilleur(e);
  e.result = top
    ? { winner: top.id, name: top.name, amount: top.amount, itemId: e.itemId, at: now }
    : { winner: null, itemId: e.itemId, at: now };
  return e.result;
}

/** Ce que voit le navigateur. */
function view(state, userId = null, now = Date.now()) {
  const e = ensure(state, now);
  const { BY_ID } = require('./data/collection');
  const item = BY_ID.get(e.itemId);
  const top = meilleur(e);

  return {
    semaine: e.semaine,
    item: item ? { id: item.id, name: item.name, emoji: item.emoji, r: item.r, rarity: RARITIES[item.r].name, color: RARITIES[item.r].color } : null,
    debut: e.debut,
    fin: e.fin,
    serverNow: now,
    ouverte: ouverte(e, now),
    aVenir: now < e.debut,
    closed: e.closed,
    depart: e.depart,
    minimum: minimum(e),
    top: top ? { name: top.name, amount: top.amount, moi: userId === top.id } : null,
    enchereurs: new Set(e.bids.map((b) => b.id)).size,
    coups: e.bids.length,
    // Les cinq dernières, du plus récent au plus ancien.
    derniers: e.bids.slice(-5).reverse().map((b) => ({ name: b.name, amount: b.amount, at: b.at })),
    result: e.result,
    pas: PAS,
  };
}

module.exports = {
  ensure, miser, clore, view, minimum, meilleur, ouverte, semaine, dimanche, lot, prixDepart,
  LOTS, PAS, PROLONGE_MS, DEBUT_H, FIN_H,
};
