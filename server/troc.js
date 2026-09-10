'use strict';
/**
 * LE TROC.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LE MARCHÉ NE SAIT PAS FAIRE
 * ─────────────────────────────────────────────────────────────────────────
 * Le marché fonctionne, mais il est anonyme et froid : on met un prix, un
 * inconnu achète. Entre quatre potes, ce n'est pas comme ça que ça se passe.
 * Ça se passe comme dans une cour de récréation : « je te donne mon Doge
 * contre ton Pepe ».
 *
 * Un troc, c'est nommé, c'est direct, et ça se négocie. Ce n'est pas une
 * transaction, c'est une conversation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES RÈGLES, ET POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  · ON N'ÉCHANGE QUE SES DOUBLONS. Exactement la règle du marché : le
 *    dernier exemplaire d'un objet reste dans la collection. Sans ça, on
 *    viderait sa collection pour dépanner un copain et on perdrait ses
 *    paliers de médailles sans s'en rendre compte.
 *
 *  · LES DEUX CÔTÉS SONT VÉRIFIÉS AU MOMENT D'ACCEPTER, pas au moment de
 *    proposer. Entre les deux, chacun a pu vendre, ouvrir des caisses,
 *    troquer ailleurs. Une proposition n'est qu'une intention.
 *
 *  · DES PIÈCES PEUVENT S'AJOUTER D'UN CÔTÉ. « Mon Pepe contre ton Nyan
 *    Cat plus 2 000 pièces » est une phrase qu'on dit vraiment. Elles vont
 *    toujours du proposeur vers l'autre : une seule direction, donc aucune
 *    ambiguïté sur qui paie.
 *
 *  · LE SITE NE PRÉLÈVE RIEN. Le marché prend 8 % parce qu'il faut bien
 *    détruire des pièces quelque part ; un troc entre potes, non. Ce n'est
 *    pas un canal d'échange assez large pour peser sur l'économie, et
 *    prélever sur un cadeau serait mesquin.
 *
 * Comme partout ailleurs : ce module VÉRIFIE et DÉCRIT. C'est `index.js`
 * qui déplace les objets et les pièces.
 */

const { BY_ID } = require('./data/collection');

const MAX_OBJETS = 4;         // par côté
const MAX_PIECES = 100000;
const EXPIRE_MS = 24 * 3600 * 1000;
const MAX_EN_COURS = 6;       // propositions simultanées par personne

const trocs = new Map();

const newId = () => `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/** Combien d'exemplaires de cet objet ce joueur peut-il donner ? */
function donnables(profile, itemId) {
  const owned = (profile.vault.items || {})[itemId] || 0;
  return Math.max(0, owned - 1);
}

/** Une liste d'identifiants → une liste d'objets, sans doublon d'entrée. */
function objets(ids) {
  const out = [];
  for (const id of (ids || []).slice(0, MAX_OBJETS)) {
    const item = BY_ID.get(id);
    if (!item) return null;
    if (!out.some((o) => o.id === item.id)) out.push(item);
  }
  return out;
}

/**
 * Propose un troc.
 *
 * @param {object} de     profil complet du proposeur (on vérifie ses doublons)
 * @param {object} a      { id, name } — le destinataire
 * @param {object} offre  { donne: [ids], veut: [ids], pieces }
 */
function proposer(de, a, { donne, veut, pieces = 0 } = {}, now = Date.now()) {
  if (!a || !a.id || a.id === de.id) return { ok: false, message: 'Choisis quelqu’un d’autre.' };

  const mes = objets(donne);
  const siens = objets(veut);
  if (!mes || !siens) return { ok: false, message: 'Objet inconnu.' };
  if (!mes.length && !siens.length) return { ok: false, message: 'Un troc, c’est au moins un objet.' };

  const coins = Math.max(0, Math.min(MAX_PIECES, Math.floor(Number(pieces) || 0)));
  if (!mes.length && !coins) {
    return { ok: false, message: 'Tu ne donnes rien : c’est une demande, pas un troc.' };
  }

  for (const item of mes) {
    if (donnables(de, item.id) < 1) {
      return {
        ok: false,
        message: `Tu n’as pas de doublon de ${item.name}. Le dernier exemplaire reste dans ta collection.`,
      };
    }
  }

  const miennes = [...trocs.values()].filter((t) => t.status === 'pending' && t.fromId === de.id);
  if (miennes.length >= MAX_EN_COURS) {
    return { ok: false, message: `Tu as déjà ${MAX_EN_COURS} propositions en attente.` };
  }

  const troc = {
    id: newId(),
    fromId: de.id, fromName: de.name,
    toId: a.id, toName: a.name,
    donne: mes.map((i) => ({ id: i.id, name: i.name, emoji: i.emoji, r: i.r })),
    veut: siens.map((i) => ({ id: i.id, name: i.name, emoji: i.emoji, r: i.r })),
    pieces: coins,
    status: 'pending',
    at: now,
    expiresAt: now + EXPIRE_MS,
  };
  trocs.set(troc.id, troc);
  return { ok: true, troc };
}

function get(id) { return trocs.get(String(id || '')); }

function inbox(userId, now = Date.now()) {
  return [...trocs.values()]
    .filter((t) => t.status === 'pending' && t.toId === userId && t.expiresAt > now)
    .sort((a, b) => b.at - a.at);
}

function outbox(userId, now = Date.now()) {
  return [...trocs.values()]
    .filter((t) => t.status === 'pending' && t.fromId === userId && t.expiresAt > now)
    .sort((a, b) => b.at - a.at);
}

/**
 * Est-ce que ce troc peut se faire, LÀ, MAINTENANT ?
 *
 * C'est la fonction qui compte. Elle est appelée au moment d'accepter, avec
 * les deux profils sous les yeux, et elle vérifie tout : les doublons des
 * deux côtés et les pièces du proposeur.
 */
function verifier(t, deProfil, aProfil) {
  if (!t) return { ok: false, message: 'Ce troc n’existe plus.' };
  if (t.status !== 'pending') return { ok: false, message: 'Ce troc n’attend plus de réponse.' };
  if (Date.now() > t.expiresAt) { t.status = 'expire'; return { ok: false, message: 'Ce troc a expiré.' }; }

  for (const o of t.donne) {
    if (donnables(deProfil, o.id) < 1) {
      return { ok: false, message: `${t.fromName} n’a plus de doublon de ${o.name}.` };
    }
  }
  for (const o of t.veut) {
    if (donnables(aProfil, o.id) < 1) {
      return {
        ok: false,
        message: `Tu n’as pas de doublon de ${o.name}. Le dernier exemplaire reste dans ta collection.`,
      };
    }
  }
  if (t.pieces > deProfil.vault.coins) {
    return { ok: false, message: `${t.fromName} n’a plus les ${t.pieces.toLocaleString('fr-FR')} pièces promises.` };
  }
  return { ok: true };
}

/** Marque le troc comme fait. L'échange lui-même se passe chez l'appelant. */
function conclure(t, now = Date.now()) {
  t.status = 'done';
  t.doneAt = now;
  return t;
}

function refuser(t, byId) {
  if (!t || t.status !== 'pending') return { ok: false, message: 'Ce troc n’existe plus.' };
  if (t.toId !== byId && t.fromId !== byId) return { ok: false, message: 'Ce troc ne te concerne pas.' };
  t.status = byId === t.fromId ? 'annule' : 'refuse';
  return { ok: true, troc: t };
}

/** Les propositions périmées, et le ménage des vieilles. */
function sweep(now = Date.now()) {
  let n = 0;
  for (const t of [...trocs.values()]) {
    if (t.status === 'pending' && t.expiresAt <= now) { t.status = 'expire'; n += 1; continue; }
    if (t.status !== 'pending' && now - (t.doneAt || t.at) > 6 * 3600 * 1000) trocs.delete(t.id);
  }
  return n;
}

function saveAll() {
  return [...trocs.values()].filter((t) => t.status === 'pending');
}

function restoreAll(saved) {
  let n = 0;
  for (const t of saved || []) {
    if (!t || !t.id) continue;
    trocs.set(t.id, { ...t });
    n += 1;
  }
  return n;
}

module.exports = {
  proposer, get, inbox, outbox, verifier, conclure, refuser, sweep,
  saveAll, restoreAll, donnables, trocs,
  MAX_OBJETS, MAX_PIECES, EXPIRE_MS,
};
