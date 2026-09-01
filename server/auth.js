'use strict';
/**
 * Authentification Discord OAuth2 + sessions signées (cookie HMAC, sans base de données).
 *
 * Flow :
 *   GET /auth/discord           → redirige vers Discord (avec un state anti-CSRF)
 *   GET /auth/discord/callback  → échange le code contre un token, récupère le profil,
 *                                 pose un cookie de session signé, renvoie sur /
 *   POST /auth/guest            → session invité (pseudo libre, avatar généré)
 *   POST /auth/logout           → efface la session
 *   GET  /api/me                → profil courant (ou null)
 */
const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'partyzone-dev-secret-change-me';
const COOKIE = 'pz_session';
const MAX_AGE_MS = 30 * 24 * 3600 * 1000; // 30 jours

/* ─── Signature de session ─────────────────────────────────────────────── */

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(crypto.createHmac('sha256', SECRET).update(body).digest());
  return `${body}.${mac}`;
}
function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = b64url(crypto.createHmac('sha256', SECRET).update(body).digest());
  // comparaison à temps constant
  const a = Buffer.from(mac || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(unb64url(body));
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function setSession(res, user) {
  const token = sign({ ...user, exp: Date.now() + MAX_AGE_MS });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: MAX_AGE_MS,
    secure: (process.env.BASE_URL || '').startsWith('https://'),
  });
}

/** Lit l'utilisateur depuis un objet de cookies déjà parsé. */
function userFromCookies(cookies) {
  const data = verify(cookies && cookies[COOKIE]);
  if (!data) return null;
  const { exp, ...user } = data;
  return user;
}

/** Lit l'utilisateur depuis l'en-tête Cookie brut (utilisé par Socket.IO). */
function userFromCookieHeader(header) {
  if (!header) return null;
  const jar = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) jar[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return userFromCookies(jar);
}

/* ─── Discord ─────────────────────────────────────────────────────────── */

const DISCORD_API = 'https://discord.com/api/v10';

function discordConfigured() {
  return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
}
function redirectUri() {
  const base = (process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000)).replace(/\/$/, '');
  return `${base}/auth/discord/callback`;
}

function avatarUrl(profile) {
  if (profile.avatar) {
    const ext = profile.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${ext}?size=128`;
  }
  const index = profile.discriminator && profile.discriminator !== '0'
    ? Number(profile.discriminator) % 5
    : Number((BigInt(profile.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function register(app) {
  app.get('/api/config', (req, res) => {
    res.json({ discord: discordConfigured() });
  });

  app.get('/api/me', (req, res) => {
    res.json({ user: userFromCookies(req.cookies) });
  });

  app.get('/auth/discord', (req, res) => {
    if (!discordConfigured()) {
      return res.redirect('/?error=discord_non_configure');
    }
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('pz_oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000 });
    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', process.env.DISCORD_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'none');
    res.redirect(url.toString());
  });

  app.get('/auth/discord/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code) return res.redirect('/?error=auth_annulee');
    if (!state || state !== req.cookies.pz_oauth_state) return res.redirect('/?error=state_invalide');
    res.clearCookie('pz_oauth_state');

    try {
      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: String(code),
          redirect_uri: redirectUri(),
        }),
      });
      if (!tokenRes.ok) throw new Error('token ' + tokenRes.status);
      const token = await tokenRes.json();

      const userRes = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!userRes.ok) throw new Error('profil ' + userRes.status);
      const profile = await userRes.json();

      setSession(res, {
        id: 'discord:' + profile.id,
        name: profile.global_name || profile.username,
        avatar: avatarUrl(profile),
        provider: 'discord',
      });
      res.redirect('/');
    } catch (err) {
      console.error('[discord] échec OAuth :', err.message);
      res.redirect('/?error=discord_echec');
    }
  });

  app.post('/auth/guest', (req, res) => {
    const raw = String((req.body && req.body.name) || '').trim().slice(0, 18);
    const name = raw || 'Invité';
    const id = 'guest:' + crypto.randomBytes(8).toString('hex');
    setSession(res, {
      id,
      name,
      avatar: null, // avatar généré côté client à partir du pseudo
      provider: 'guest',
    });
    res.json({ ok: true, user: userFromCookies({ [COOKIE]: null }) || { id, name, provider: 'guest' } });
  });

  app.post('/auth/logout', (req, res) => {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });
}

module.exports = {
  register, userFromCookieHeader, discordConfigured,
  // La porte a besoin de signer son propre laissez-passer. Elle réutilise
  // le même secret et le même format que les sessions plutôt que d'en
  // inventer un deuxième : un seul secret à protéger, un seul à faire
  // tourner le jour où il fuit.
  signToken: sign, verifyToken: verify,
};
