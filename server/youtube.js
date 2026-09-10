'use strict';
/**
 * LIRE UNE PLAYLIST YOUTUBE, VITE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 * La première version lisait les playlists depuis le NAVIGATEUR de l'hôte :
 * on chargeait la liste dans un lecteur caché, puis on avançait de piste en
 * piste en relevant le titre de chacune. Ça évitait de demander une clé
 * d'API, ce qui était l'objectif — mais ça coûtait entre un tiers de
 * seconde et deux secondes et demie PAR MORCEAU. Une playlist de soixante
 * titres demandait deux minutes, et il suffisait d'une vidéo bloquée, d'un
 * onglet en arrière-plan ou d'une connexion lente pour que tout s'arrête au
 * milieu sans rien dire.
 *
 * Ici, le serveur va chercher la playlist lui-même. Une requête, tout le
 * monde attend deux secondes, et c'est fini.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TROIS CHEMINS, DU MEILLEUR AU PLUS DÉBROUILLARD
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  1. LA CLÉ D'API, si `YOUTUBE_API_KEY` est renseignée. C'est le chemin
 *     officiel, documenté et stable : cinquante titres par requête, et un
 *     quota gratuit de dix mille unités par jour — soit, à une unité par
 *     requête, de quoi charger deux cents playlists quotidiennes. La clé est
 *     FACULTATIVE : sans elle le site marche, avec elle il ne se trompe
 *     jamais. La marche à suivre est dans le README.
 *
 *  2. LA PAGE PUBLIQUE, sinon. YouTube livre le contenu de la playlist dans
 *     un gros objet JSON planqué dans le HTML (`ytInitialData`). On le lit,
 *     et on suit les « continuations » pour les playlists longues. Aucune
 *     clé, aucun compte, aucun quota.
 *
 *  3. LE NAVIGATEUR DE L'HÔTE, en dernier recours — l'ancienne méthode. Elle
 *     est lente, mais elle marche depuis une machine qui a le droit d'aller
 *     sur YouTube même quand le serveur, lui, ne l'a pas. C'est le cas de
 *     certains hébergements, et c'est aussi le cas de l'atelier dans lequel
 *     ce fichier a été écrit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'ANALYSE EST VOLONTAIREMENT BÊTE
 * ─────────────────────────────────────────────────────────────────────────
 * On ne suit pas le chemin exact des objets de YouTube — il change tous les
 * six mois et personne ne prévient. On parcourt tout l'arbre à la recherche
 * d'objets qui RESSEMBLENT à une piste : un `videoId` et un titre. Tant que
 * ces deux mots existent quelque part, ça continue de marcher.
 */

const MAX_TRACKS = 200;
const TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;   // six heures

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** Le cache : une playlist chargée deux fois dans la soirée ne coûte rien. */
const cache = new Map();   // id → { at, data }

/* ─── Petits outils ────────────────────────────────────── */

/**
 * L'identifiant d'une playlist, quelle que soit la forme de l'adresse.
 *
 * Collé tout seul, sans adresse autour, on exige un des préfixes que
 * YouTube utilise vraiment (`PL`, `UU`, `LL`, `RD`…). Sinon n'importe quelle
 * phrase d'une douzaine de lettres passait pour un identifiant, et on
 * répondait « le serveur n'a pas réussi à lire cette playlist » à quelqu'un
 * qui avait simplement tapé n'importe quoi.
 */
const BARE_ID = /^((?:PL|UU|LL|FL|OL|RD|PU|TL)[\w-]{8,})$/i;

function playlistId(input) {
  const raw = String(input || '').trim();
  const m = raw.match(/[?&]list=([\w-]+)/) || raw.match(BARE_ID);
  return m ? m[1] : null;
}

/** Une requête HTTP qui abandonne au bout de douze secondes. */
async function get(url, { json = false, method = 'GET', body = null } = {}) {
  const stop = AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
  const res = await fetch(url, {
    method,
    signal: stop,
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return json ? res.json() : res.text();
}

/** Le texte d'un champ YouTube, qui a trois formes selon l'humeur du jour. */
function textOf(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((r) => r.text || '').join('');
  return '';
}

/**
 * Parcourt tout l'arbre et ramasse ce qui ressemble à une piste.
 *
 * On ne cherche pas `playlistVideoRenderer` par son nom : on cherche la
 * FORME. Un objet qui porte un `videoId` et un titre lisible est une piste,
 * quel que soit le nom que YouTube lui donne cette année.
 */
function harvest(node, out = [], seen = new Set(), depth = 0) {
  if (!node || typeof node !== 'object' || depth > 30 || out.length >= MAX_TRACKS) return out;

  if (Array.isArray(node)) {
    for (const item of node) harvest(item, out, seen, depth + 1);
    return out;
  }

  const id = typeof node.videoId === 'string' ? node.videoId : null;
  if (id && !seen.has(id)) {
    const title = textOf(node.title);
    if (title) {
      seen.add(id);
      out.push({
        id,
        title,
        author: textOf(node.shortBylineText) || textOf(node.ownerText)
          || textOf(node.longBylineText) || textOf(node.videoOwnerChannelTitle) || '',
      });
    }
  }

  for (const key of Object.keys(node)) harvest(node[key], out, seen, depth + 1);
  return out;
}

/** Le jeton de continuation, s'il y en a un : les playlists longues arrivent en tranches. */
function continuationOf(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 30) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = continuationOf(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (node.continuationCommand && typeof node.continuationCommand.token === 'string') {
    return node.continuationCommand.token;
  }
  for (const key of Object.keys(node)) {
    const found = continuationOf(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/* ─── 1. La clé d'API ──────────────────────────────────── */

async function viaApi(id, key) {
  const tracks = [];
  let page = '';
  let title = '';

  for (let i = 0; i < 5 && tracks.length < MAX_TRACKS; i++) {
    const url = 'https://www.googleapis.com/youtube/v3/playlistItems'
      + `?part=snippet&maxResults=50&playlistId=${encodeURIComponent(id)}`
      + `&key=${encodeURIComponent(key)}${page ? `&pageToken=${page}` : ''}`;
    const data = await get(url, { json: true });

    for (const item of data.items || []) {
      const sn = item.snippet || {};
      const videoId = sn.resourceId && sn.resourceId.videoId;
      // Une vidéo supprimée ou privée garde une entrée, mais son titre le
      // dit — on ne veut pas d'un blindtest sur « Deleted video ».
      if (!videoId || !sn.title) continue;
      if (/^(deleted|private) video$/i.test(sn.title)) continue;
      if (!title) title = sn.channelTitle || '';
      tracks.push({ id: videoId, title: sn.title, author: sn.videoOwnerChannelTitle || sn.channelTitle || '' });
    }

    page = data.nextPageToken || '';
    if (!page) break;
  }

  return { tracks, title, source: 'api' };
}

/* ─── 2. La page publique ──────────────────────────────── */

/** Extrait le gros objet JSON que YouTube laisse dans sa page. */
function initialData(html) {
  const start = html.indexOf('ytInitialData');
  if (start < 0) return null;
  const brace = html.indexOf('{', start);
  if (brace < 0) return null;

  // On compte les accolades, en tenant compte des chaînes et des
  // échappements : une expression régulière ne s'en sort pas sur un objet
  // de deux mégaoctets qui contient des accolades dans ses titres.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(brace, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

async function viaPage(id) {
  const html = await get(`https://www.youtube.com/playlist?list=${encodeURIComponent(id)}&hl=fr`);
  const data = initialData(html);
  if (!data) throw new Error('page illisible');

  const seen = new Set();
  const tracks = harvest(data, [], seen);
  const title = textOf(
    (((data.metadata || {}).playlistMetadataRenderer || {}).title) || ''
  ) || '';

  // Les playlists longues arrivent en tranches de cent : on suit le fil.
  let token = continuationOf(data);
  const apiKey = (html.match(/"INNERTUBE_API_KEY":"([\w-]+)"/) || [])[1];
  const version = (html.match(/"clientVersion":"([\d.]+)"/) || [])[1] || '2.20240101.00.00';

  let guard = 0;
  while (token && apiKey && tracks.length < MAX_TRACKS && guard++ < 4) {
    const more = await get(
      `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`,
      {
        json: true,
        method: 'POST',
        body: {
          context: { client: { clientName: 'WEB', clientVersion: version, hl: 'fr' } },
          continuation: token,
        },
      }
    ).catch(() => null);
    if (!more) break;
    const before = tracks.length;
    harvest(more, tracks, seen);
    token = continuationOf(more);
    if (tracks.length === before) break;   // plus rien ne vient : on arrête
  }

  return { tracks, title, source: 'page' };
}

/* ─── L'entrée publique ────────────────────────────────── */

/**
 * Charge une playlist. Renvoie `{ ok, id, title, tracks, source }`.
 *
 * On ne jette pas d'exception : l'appelant a besoin de savoir POURQUOI ça
 * n'a pas marché pour pouvoir proposer le repli navigateur.
 */
async function playlist(input, { key = process.env.YOUTUBE_API_KEY || '' } = {}) {
  const id = playlistId(input);
  if (!id) return { ok: false, reason: 'adresse', message: 'Ce n’est pas une adresse de playlist YouTube.' };

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...hit.data, ok: true, cached: true };
  }

  const errors = [];
  for (const attempt of [
    key ? () => viaApi(id, key) : null,
    () => viaPage(id),
  ].filter(Boolean)) {
    try {
      const out = await attempt();
      const tracks = out.tracks.filter((t) => t.id && t.title).slice(0, MAX_TRACKS);
      if (tracks.length >= 4) {
        const data = { id, title: out.title, tracks, source: out.source };
        cache.set(id, { at: Date.now(), data });
        return { ...data, ok: true };
      }
      errors.push(`${out.source} : ${tracks.length} morceau(x)`);
    } catch (err) {
      errors.push(err.message);
    }
  }

  return {
    ok: false,
    reason: 'lecture',
    message: 'Le serveur n’a pas réussi à lire cette playlist.',
    detail: errors.join(' · '),
  };
}

module.exports = { playlist, playlistId, harvest, initialData, textOf, continuationOf, MAX_TRACKS };
