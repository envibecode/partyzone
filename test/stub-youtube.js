'use strict';
/**
 * Préchargement utilisé UNIQUEMENT par les tests d'interface :
 * remplace l'appel réseau à YouTube par un jeu de pistes factices,
 * pour pouvoir jouer un blind test sans accès à Internet.
 *
 *   node -r ./test/stub-youtube.js server/index.js
 */
const yt = require('../server/youtube');

const FAKE = [
  ['dQw4w9WgXcQ', 'Rick Astley - Never Gonna Give You Up (Official Video)', 'RickAstleyVEVO'],
  ['fake0000001', 'Daft Punk - Around the World (Official Video)', 'DaftPunkVEVO'],
  ['fake0000002', 'Stromae - Alors on danse [Clip Officiel]', 'Stromae'],
  ['fake0000003', 'Queen - Bohemian Rhapsody (Official Video)', 'Queen Official'],
  ['fake0000004', 'Angele - Balance ton quoi [Clip Officiel]', 'Angele'],
  ['fake0000005', 'Orelsan - Basique (Clip Officiel)', 'OrelsanVEVO'],
];

yt.buildTracksFromIds = async () =>
  FAKE.map(([videoId, rawTitle, channel]) => ({
    videoId,
    rawTitle,
    channel,
    thumbnail: null,
    ...yt.parseTrack(rawTitle, channel),
  }));

const parsed = FAKE.map(([, rawTitle, channel]) => yt.parseTrack(rawTitle, channel));
module.exports = {
  FAKE,
  TITLES: parsed.map((t) => t.title),
  ARTISTS: parsed.map((t) => t.artist),
};

console.log('[test] métadonnées YouTube simulées');
