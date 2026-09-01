'use strict';
/**
 * Équité vérifiable (« provably fair »).
 *
 * Le principe, celui des vrais sites : le serveur tire une graine secrète et
 * en publie l'empreinte SHA-256 AVANT que tu joues. Tu choisis ta propre
 * graine, et chaque partie incrémente un compteur (le nonce). Le résultat est
 * un HMAC des trois. Quand tu changes de graine, l'ancienne graine serveur
 * t'est révélée : tu peux alors recalculer toi-même chaque manche jouée et
 * vérifier que son empreinte correspond bien à celle publiée au départ.
 *
 * Autrement dit : le serveur ne peut pas décider du résultat après coup, et
 * tu peux le prouver.
 */
const crypto = require('crypto');

function newServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

function hashSeed(seed) {
  return crypto.createHash('sha256').update(String(seed)).digest('hex');
}

function newClientSeed() {
  return crypto.randomBytes(8).toString('hex');
}

/** L'empreinte HMAC d'une manche, en hexadécimal. */
function digest(serverSeed, clientSeed, nonce, cursor = 0) {
  return crypto
    .createHmac('sha256', String(serverSeed))
    .update(`${clientSeed}:${nonce}:${cursor}`)
    .digest('hex');
}

/**
 * Transforme une empreinte en une suite de nombres dans [0, 1).
 * On lit l'hexadécimal 8 chiffres par 8 chiffres : chaque bloc donne un
 * entier 32 bits qu'on ramène dans l'intervalle unité.
 */
function floatsFrom(hex, count = 1) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const chunk = hex.slice((i * 8) % 56, ((i * 8) % 56) + 8);
    out.push(parseInt(chunk, 16) / 0x100000000);
  }
  return out;
}

/**
 * Suite de flottants aussi longue qu'on veut : on rallonge en changeant le
 * curseur, ce qui donne une nouvelle empreinte.
 */
function floats(serverSeed, clientSeed, nonce, count) {
  const out = [];
  let cursor = 0;
  while (out.length < count) {
    const hex = digest(serverSeed, clientSeed, nonce, cursor);
    for (let i = 0; i < 7 && out.length < count; i++) {
      out.push(parseInt(hex.slice(i * 8, i * 8 + 8), 16) / 0x100000000);
    }
    cursor++;
  }
  return out;
}

/** Un entier dans [0, max). */
function intBelow(f, max) {
  return Math.min(max - 1, Math.floor(f * max));
}

/* ─── État par joueur ──────────────────────────────────── */

function blankFair() {
  const serverSeed = newServerSeed();
  return {
    serverSeed,
    serverSeedHash: hashSeed(serverSeed),
    clientSeed: newClientSeed(),
    nonce: 0,
    previous: null, // la graine précédente, révélée après rotation
  };
}

/** Consomme un nonce et renvoie les flottants de la manche. */
function draw(fair, count) {
  fair.nonce += 1;
  return {
    nonce: fair.nonce,
    values: floats(fair.serverSeed, fair.clientSeed, fair.nonce, count),
  };
}

/**
 * Change de graine : l'ancienne est révélée (pour vérification) et une
 * nouvelle est tirée.
 */
function rotate(fair, clientSeed) {
  fair.previous = {
    serverSeed: fair.serverSeed,
    serverSeedHash: fair.serverSeedHash,
    clientSeed: fair.clientSeed,
    nonce: fair.nonce,
  };
  const serverSeed = newServerSeed();
  fair.serverSeed = serverSeed;
  fair.serverSeedHash = hashSeed(serverSeed);
  fair.clientSeed = String(clientSeed || '').trim().slice(0, 40) || newClientSeed();
  fair.nonce = 0;
  return fair;
}

/** Ce que le navigateur a le droit de voir : jamais la graine en cours. */
function publicFair(fair) {
  return {
    serverSeedHash: fair.serverSeedHash,
    clientSeed: fair.clientSeed,
    nonce: fair.nonce,
    previous: fair.previous,
  };
}

module.exports = {
  newServerSeed,
  newClientSeed,
  hashSeed,
  digest,
  floats,
  floatsFrom,
  intBelow,
  blankFair,
  draw,
  rotate,
  publicFair,
};
