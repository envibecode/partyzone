'use strict';
/**
 * Récupération et nettoyage des métadonnées YouTube.
 *
 * Deux chemins possibles :
 *  1. YOUTUBE_API_KEY définie → on lit la playlist directement côté serveur (rapide, fiable).
 *  2. Sans clé → le navigateur de l'hôte extrait les IDs via l'IFrame Player API,
 *     et le serveur complète les titres avec l'endpoint public oEmbed (aucune clé requise).
 */

const BRACKETS = /\s*[\(\[\{][^\)\]\}]*(official|clip|video|audio|lyric|lyrics|hd|hq|4k|remaster|remastered|mv|m\/v|visualizer|paroles|live|version|edit|explicit|cover art|color coded)[^\)\]\}]*[\)\]\}]/gi;
const TRAILING_TAGS = /\s*[\(\[\{][^\)\]\}]{0,40}[\)\]\}]\s*$/;
const NOISE = /\s*(official\s*(music\s*)?video|official\s*audio|official\s*lyric\s*video|music\s*video|lyric\s*video|audio officiel|clip officiel|hd|hq|4k)\s*$/gi;
// Le \s+ initial est indispensable : sans lui, « Daft Punk » serait tronqué en « Da ».
const FEAT = /\s+(?:feat\.?|ft\.?|featuring|avec|with)\s+.+$/i;

function cleanPiece(str) {
  return String(str || '')
    .replace(BRACKETS, ' ')
    .replace(NOISE, ' ')
    .replace(/["\u201c\u201d\u00ab\u00bb]/g, '')
    .replace(/\s*[|•·]\s*.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanChannel(name) {
  return String(name || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s*Official$/i, '')
    .trim();
}

/**
 * Transforme un titre YouTube brut en { title, artist, acceptTitles, acceptArtists }.
 * Gère « Artiste - Titre », « Artiste – Titre », « Artiste : Titre » et le repli sur la chaîne.
 */
function parseTrack(rawTitle, channel) {
  const raw = String(rawTitle || '').trim();
  let artist = cleanChannel(channel);
  let title = raw;

  const sep = raw.match(/^(.{1,60}?)\s+[-–—:|]\s+(.+)$/);
  if (sep) {
    artist = cleanPiece(sep[1]);
    title = cleanPiece(sep[2]);
  } else {
    title = cleanPiece(raw);
  }

  title = title.replace(TRAILING_TAGS, '').trim() || cleanPiece(raw) || raw;
  artist = artist.replace(TRAILING_TAGS, '').trim() || cleanChannel(channel) || 'Inconnu';

  // Le titre « propre » (sans le featuring) devient la réponse affichée ;
  // la version longue reste acceptée.
  const withoutFeat = title.replace(FEAT, '').trim();
  const acceptTitles = new Set([title]);
  if (withoutFeat && withoutFeat !== title && withoutFeat.length >= 3) {
    acceptTitles.add(withoutFeat);
    title = withoutFeat;
  }

  const acceptArtists = new Set([artist]);
  const artistNoFeat = artist.replace(FEAT, '').trim();
  if (artistNoFeat) acceptArtists.add(artistNoFeat);
  // « A & B », « A x B », « A, B » → chaque nom est accepté séparément
  for (const part of artist.split(/\s*(?:,|&|\bx\b|\bet\b|\band\b|\bfeat\.?\b|\bft\.?\b)\s*/i)) {
    const p = part.trim();
    if (p.length >= 3) acceptArtists.add(p);
  }
  if (channel) acceptArtists.add(cleanChannel(channel));

  return {
    title,
    artist,
    acceptTitles: [...acceptTitles].filter(Boolean),
    acceptArtists: [...acceptArtists].filter(Boolean),
  };
}

/** Extrait l'ID de playlist d'une URL YouTube. */
function parsePlaylistId(input) {
  const str = String(input || '').trim();
  if (!str) return null;
  const m = str.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^(PL|UU|LL|FL|OL|RD)[A-Za-z0-9_-]{10,}$/.test(str)) return str;
  return null;
}

function parseVideoId(input) {
  const str = String(input || '').trim();
  const m =
    str.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
    str.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
    str.match(/\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(str)) return str;
  return null;
}

/** Métadonnées d'une vidéo via l'endpoint public oEmbed (aucune clé API). */
async function fetchOEmbed(videoId) {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': 'PartyZone/1.0' } });
  if (!res.ok) throw new Error('oembed ' + res.status);
  const data = await res.json();
  return { videoId, rawTitle: data.title, channel: data.author_name, thumbnail: data.thumbnail_url };
}

/** Applique fn en parallèle avec une limite de concurrence. */
async function mapLimit(items, limit, fn) {
  const out = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      try {
        out[i] = await fn(items[i]);
      } catch {
        out[i] = null;
      }
    }
  });
  await Promise.all(workers);
  return out.filter(Boolean);
}

/** Construit les pistes jouables à partir d'une liste d'IDs vidéo. */
async function buildTracksFromIds(videoIds) {
  const unique = [...new Set(videoIds.filter(Boolean))].slice(0, 200);
  const metas = await mapLimit(unique, 8, fetchOEmbed);
  return metas.map((m) => ({
    videoId: m.videoId,
    thumbnail: m.thumbnail,
    rawTitle: m.rawTitle,
    channel: m.channel,
    ...parseTrack(m.rawTitle, m.channel),
  }));
}

/** Lecture d'une playlist côté serveur (nécessite YOUTUBE_API_KEY). */
async function fetchPlaylistWithApi(playlistId) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  const items = [];
  let pageToken = '';
  for (let page = 0; page < 4; page++) {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'snippet,contentDetails,status');
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('key', key);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url);
    if (!res.ok) throw new Error('youtube api ' + res.status);
    const data = await res.json();
    for (const it of data.items || []) {
      if (it.status && it.status.privacyStatus === 'private') continue;
      const videoId = it.contentDetails && it.contentDetails.videoId;
      if (!videoId) continue;
      items.push({
        videoId,
        rawTitle: it.snippet.title,
        channel: (it.snippet.videoOwnerChannelTitle || it.snippet.channelTitle || '').trim(),
        thumbnail: it.snippet.thumbnails && (it.snippet.thumbnails.medium || it.snippet.thumbnails.default || {}).url,
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return items
    .filter((i) => i.rawTitle && !/^(Deleted|Private) video$/i.test(i.rawTitle))
    .map((i) => ({ ...i, ...parseTrack(i.rawTitle, i.channel) }));
}

module.exports = {
  parseTrack,
  parsePlaylistId,
  parseVideoId,
  buildTracksFromIds,
  fetchPlaylistWithApi,
  fetchOEmbed,
};
