'use strict';
/**
 * LA PORTE.
 *
 * Tant que le site n'a pas ouvert, il n'y a rien à voir : n'importe quelle
 * adresse renvoie le compte à rebours. Pas de « entrer quand même » caché
 * dans un coin, pas de page qui fuit parce qu'on connaît son URL — une
 * ouverture qu'on peut contourner n'est pas une ouverture, c'est une
 * décoration.
 *
 * Trois exceptions, et elles sont toutes nécessaires :
 *
 *   · les fontes et le socle CSS, sans quoi le compte à rebours lui-même
 *     s'affiche en Times New Roman ;
 *   · /api/gate, la seule porte dérobée : elle demande la clé ADMIN_KEY et
 *     pose un laissez-passer signé valable douze heures ;
 *   · /healthz, que l'hébergeur interroge pour savoir si le serveur vit.
 *
 * L'heure d'ouverture est une vraie date, pas un compteur de secondes :
 * quelqu'un qui recharge la page, ferme son onglet ou revient demain voit
 * le même chiffre que tout le monde. Un compte à rebours qui repart de zéro
 * à chaque visite est un mensonge, et ça se remarque tout de suite.
 */

const path = require('path');
const crypto = require('crypto');
const auth = require('./auth');
const store = require('./store');

/*
 * L'ouverture : 2 septembre 2026 à midi, heure de Paris.
 *
 * Le +02:00 est explicite exprès. En septembre la France est encore à
 * l'heure d'été ; écrire « 12:00 » sans décalage aurait donné midi UTC,
 * c'est-à-dire quatorze heures pour les joueurs — et personne ne s'en
 * serait aperçu avant le jour J.
 */
const DEFAULT_OPENS_AT = Date.parse('2026-09-02T12:00:00+02:00');

const PASS_COOKIE = 'pz_gate';
const PASS_MS = 12 * 3600 * 1000;

/* Les chemins qui passent même porte close. */
const ALWAYS = [
  '/fonts/',
  '/img/',            // la pile de jetons, partagée avec l'écran de connexion
  '/css/tokens.css',
  '/api/gate',
  '/healthz',
  '/favicon.ico',
];

/* ─── L'état ──────────────────────────────────────────────────────────── */

/**
 * Trois modes, et un seul est automatique :
 *
 *   'auto'   — fermé jusqu'à l'heure dite, ouvert après. C'est le mode
 *              normal : personne n'a à être devant son écran à midi.
 *   'open'   — ouvert quoi qu'il arrive (on a ouvert plus tôt).
 *   'closed' — fermé quoi qu'il arrive (on referme pour une mise à jour).
 */
async function config() {
  const state = await store.siteState();
  if (!state.gate) {
    state.gate = { mode: 'auto', opensAt: DEFAULT_OPENS_AT };
    store.touchState();
  }
  // Une variable d'environnement l'emporte : c'est le seul moyen de
  // rouvrir un site dont on n'a plus accès au panel.
  const envAt = Date.parse(process.env.OPENS_AT || '');
  if (Number.isFinite(envAt)) state.gate.opensAt = envAt;
  return state.gate;
}

async function setConfig(patch) {
  const gate = await config();
  if (patch.mode && ['auto', 'open', 'closed'].includes(patch.mode)) gate.mode = patch.mode;
  if (patch.opensAt) {
    const at = typeof patch.opensAt === 'number' ? patch.opensAt : Date.parse(patch.opensAt);
    if (Number.isFinite(at)) gate.opensAt = at;
  }
  store.touchState();
  return gate;
}

async function isOpen() {
  const gate = await config();
  if (gate.mode === 'open') return true;
  if (gate.mode === 'closed') return false;
  return Date.now() >= gate.opensAt;
}

/** Ce que la page de maintenance a besoin de savoir. */
async function publicInfo() {
  const gate = await config();
  return {
    opensAt: gate.opensAt,
    // L'horloge du serveur voyage avec : celle du visiteur peut être fausse
    // de plusieurs minutes, et le compte à rebours doit rester juste.
    serverNow: Date.now(),
    open: await isOpen(),
  };
}

/* ─── Le laissez-passer ───────────────────────────────────────────────── */

function hasPass(req) {
  const token = req.cookies && req.cookies[PASS_COOKIE];
  const data = auth.verifyToken(token);
  return Boolean(data && data.gate === true);
}

function grantPass(res) {
  res.cookie(PASS_COOKIE, auth.signToken({ gate: true, exp: Date.now() + PASS_MS }), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: PASS_MS,
    secure: (process.env.BASE_URL || '').startsWith('https://'),
  });
}

/** Le même contrôle, depuis l'en-tête brut : Socket.IO n'a pas de req.cookies. */
function hasPassHeader(header) {
  if (!header) return false;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== PASS_COOKIE) continue;
    const data = auth.verifyToken(decodeURIComponent(part.slice(i + 1).trim()));
    return Boolean(data && data.gate === true);
  }
  return false;
}

/* ─── La tentative de clé ─────────────────────────────────────────────── */

/*
 * Un compteur d'essais par adresse. Il ne prétend pas arrêter quelqu'un de
 * déterminé — l'ADMIN_KEY fait vingt caractères, elle ne se devine pas —
 * mais il évite qu'un script tape dessus en boucle et remplisse les
 * journaux. La fenêtre glisse toute seule, sans minuterie à nettoyer.
 */
const tries = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_TRIES = 8;

function tooManyTries(ip) {
  const now = Date.now();
  const list = (tries.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  tries.set(ip, list);
  if (tries.size > 500) tries.clear();
  return list.length >= MAX_TRIES;
}

function noteTry(ip) {
  const list = tries.get(ip) || [];
  list.push(Date.now());
  tries.set(ip, list);
}

function keyMatches(given) {
  const expected = process.env.ADMIN_KEY || '';
  if (!expected || expected.length < 6) return false;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  // Longueurs différentes : on compare quand même quelque chose de la même
  // taille, pour ne pas répondre plus vite à une clé trop courte.
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/* ─── Le branchement ──────────────────────────────────────────────────── */

function mount(app) {
  /** L'état de la porte, lisible sans laissez-passer : c'est le compteur. */
  app.get('/api/gate', async (req, res) => {
    res.json(await publicInfo());
  });

  /** La clé. */
  app.post('/api/gate', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'inconnu';
    if (tooManyTries(ip)) {
      return res.status(429).json({ ok: false, message: 'Trop d’essais. Reviens dans dix minutes.' });
    }
    if (!process.env.ADMIN_KEY || process.env.ADMIN_KEY.length < 6) {
      return res.status(503).json({ ok: false, message: 'Aucune clé n’est configurée sur ce serveur.' });
    }
    if (!keyMatches(req.body && req.body.key)) {
      noteTry(ip);
      // Une seconde de délai : invisible quand on tape la bonne clé,
      // rédhibitoire pour un script qui en essaie des milliers.
      await new Promise((r) => setTimeout(r, 1000));
      return res.status(401).json({ ok: false, message: 'Clé refusée.' });
    }
    grantPass(res);
    res.json({ ok: true });
  });

  /** Le filtre. Tout le reste du site passe par là. */
  app.use(async (req, res, next) => {
    if (ALWAYS.some((p) => req.path === p || req.path.startsWith(p))) return next();
    if (await isOpen()) return next();
    if (hasPass(req)) return next();

    // Une requête de données reçoit une réponse de données : c'est ce qui
    // permet à une page ouverte au moment de la fermeture de comprendre ce
    // qui lui arrive au lieu de recevoir du HTML dans un fetch JSON.
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
      return res.status(503).json({ ok: false, closed: true, message: 'Le site n’a pas encore ouvert.' });
    }
    res.status(503).sendFile(path.join(__dirname, '..', 'public', 'maintenance.html'));
  });
}

module.exports = {
  mount, isOpen, config, setConfig, publicInfo,
  hasPassHeader, DEFAULT_OPENS_AT,
};
