'use strict';
/**
 * LE MODE CANAPÉ.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'IL FAUT VÉRIFIER, ET DANS QUEL ORDRE
 * ─────────────────────────────────────────────────────────────────────────
 * Le mode canapé pose une télé au milieu du salon. La question n'est donc
 * pas « est-ce joli » mais « est-ce que quelqu'un peut lire, sur cet écran,
 * quelque chose qu'il ne devrait pas savoir ? ».
 *
 *  1. LA TÉLÉ NE VOIT AUCUN SECRET. On lance un Undercover à trois, et on
 *     lit TOUT le contenu de la page de la télé : aucun mot secret ne doit
 *     s'y trouver. C'est la vérification qui compte, et elle est faite sur
 *     le texte réellement affiché, pas sur ce que l'interface prétend
 *     cacher.
 *  2. ELLE NE PREND PAS DE PLACE à la table.
 *  3. LE CODE EST LISIBLE DE LOIN — au sens propre : on mesure la taille de
 *     police calculée.
 *  4. CE QUI NE SE LIT PAS À TROIS MÈTRES DISPARAÎT : le chat, la liste des
 *     connectés, la barre du haut.
 */

const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const { gatePass, withPass, browserPass } = require('./pass');

const BASE = process.env.BASE || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const errs = [];
let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

function waitFor(fn, ms = 6000, what = 'condition') {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const step = () => {
      let v; try { v = fn(); } catch { v = null; }
      if (v) return resolve(v);
      if (Date.now() - started > ms) return reject(new Error(`délai dépassé : ${what}`));
      setTimeout(step, 60);
    };
    step();
  });
}

/** Un joueur, sans navigateur : un socket suffit. */
async function joueur(pass, name) {
  const res = await fetch(`${BASE}/auth/guest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: pass },
    body: JSON.stringify({ name }),
  });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  const cookie = withPass(pass, raw.map((c) => c.split(';')[0]).join('; '));
  const socket = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
  const p = { name, socket, joined: null, uc: null };
  socket.on('me', ({ user, profile }) => { p.user = user; p.profile = profile; });
  socket.on('party:joined', (j) => { p.joined = j; });
  socket.on('uc:state', (s) => { p.uc = s; });
  await new Promise((ok, ko) => {
    socket.on('connect', ok);
    setTimeout(() => ko(new Error('connexion trop lente')), 6000);
  });
  await waitFor(() => p.profile, 5000, `profil de ${name}`);
  socket.emit('party:open');
  return p;
}

(async () => {
  const pass = await gatePass(BASE);
  const tag = Date.now().toString(36).slice(-3);
  const [a, b, c] = await Promise.all(['Un' + tag, 'Deux' + tag, 'Trois' + tag].map((n) => joueur(pass, n)));

  // Une partie d'Undercover : c'est le jeu où il y a le plus à cacher.
  a.socket.emit('party:create', { game: 'undercover' });
  const salon = await waitFor(() => a.joined, 5000, 'salon ouvert');
  for (const p of [b, c]) {
    p.socket.emit('party:join', { code: salon.code });
    await waitFor(() => p.uc && p.uc.code === salon.code, 5000, `${p.name} entre`);
  }

  const nav = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await nav.newContext({ viewport: { width: 1600, height: 900 }, locale: 'fr-FR' });
  const tele = await ctx.newPage();
  await browserPass(ctx);
  tele.on('pageerror', (e) => errs.push('ERR ' + e.message));
  tele.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('CON ' + m.text()); });

  await tele.goto(BASE, { waitUntil: 'networkidle' });
  const intro = await tele.$('#intro-skip');
  if (intro) { await intro.click(); await wait(900); }
  await tele.fill('#guest-name', 'Tele' + tag);
  await tele.click('#form-guest button');
  await tele.waitForSelector('#app.active');
  await tele.waitForFunction(() => window.PZ && window.PZ.profile);
  await wait(1200);

  console.log(`Le mode canapé — ${BASE}\n`);

  /* ── ALLUMER LA TÉLÉ ── */
  section('Allumer la télé');
  await tele.evaluate(() => window.PZ.go('party'));
  await wait(600);
  check('le bouton est dans le hall', Boolean(await tele.$('#canape-go')));

  await tele.click('#canape-go');
  await wait(400);
  const explication = await tele.$eval('#modal .fine', (n) => n.textContent).catch(() => '');
  check('la fenêtre explique ce que la télé voit', /regarde sans jouer|serveur/.test(explication),
    explication.slice(0, 70));

  await tele.fill('#modal .input.code', salon.code);
  await tele.click('.lb-pop-foot .btn-primary');
  await wait(1500);

  check('le mode est actif', await tele.evaluate(() => document.body.classList.contains('canape')));
  const codeAffiche = await tele.$eval('.cb-code b', (n) => n.textContent).catch(() => '');
  check('le code du salon est affiché', codeAffiche === salon.code, codeAffiche);

  const taille = await tele.evaluate(() => {
    const n = document.querySelector('.cb-code b');
    return n ? parseFloat(getComputedStyle(n).fontSize) : 0;
  });
  check('il se lit du fond de la pièce', taille >= 34, `${Math.round(taille)} px`);

  /* ── ELLE NE PREND PAS DE PLACE ── */
  section('La télé regarde, elle ne joue pas');
  await wait(800);
  check('la table compte toujours trois joueurs', a.uc && a.uc.players.length === 3,
    a.uc ? `${a.uc.players.length}` : '—');

  const cache = await tele.evaluate(() => {
    const off = (sel) => {
      const n = document.querySelector(sel);
      return !n || getComputedStyle(n).display === 'none' || n.hidden;
    };
    return { chat: off('.chat'), rail: off('.rail'), topbar: off('.topbar') };
  });
  check('le chat disparaît', cache.chat, 'on n’écrit pas à quelqu’un assis à côté de soi');
  check('la liste des connectés aussi', cache.rail);
  check('et la barre du haut', cache.topbar);

  /* ── LE SECRET ── */
  section('Aucun secret ne s’affiche sur la télé');
  /*
   * On écoute la ligne elle-même : tout ce que le serveur envoie à la télé
   * est mis de côté. Un mot caché par du CSS resterait lisible avec la
   * console du navigateur — c'est donc ce qui ARRIVE qu'il faut vérifier,
   * pas ce qui s'affiche.
   */
  await tele.evaluate(() => {
    window.__recu = [];
    window.PZ.socket.on('uc:state', (s) => window.__recu.push(JSON.stringify(s)));
  });
  a.socket.emit('party:start');
  await waitFor(() => a.uc && a.uc.phase === 'describing', 8000, 'partie lancée');
  await wait(1500);

  // Les mots que les joueurs ont reçus, et que la télé ne doit PAS avoir.
  const mots = [a, b, c].map((p) => ((p.uc || {}).you || {}).word).filter(Boolean);
  check('les joueurs ont bien reçu un mot', mots.length >= 2, `${mots.length} mots distribués`);

  const ecran = await tele.evaluate(() => document.body.innerText);
  const fuite = mots.filter((m) => new RegExp(`\\b${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(ecran));
  check('aucun mot secret sur l’écran de la télé', fuite.length === 0,
    fuite.length ? `« ${fuite.join(', ')} » visible !` : `${mots.length} mots vérifiés`);

  const recu = await tele.evaluate(() => (window.__recu || []).join(' '));
  check('la télé reçoit bien l’état de la partie', recu.length > 50, `${recu.length} octets reçus`);
  const fuiteFil = mots.filter((m) => recu.toLowerCase().includes(m.toLowerCase()));
  check('ni dans ce que le serveur lui envoie', fuiteFil.length === 0,
    fuiteFil.length ? `« ${fuiteFil.join(', ')} » sur la ligne !` : 'rien de secret sur la ligne');

  check('la télé sait quand même où en est la partie',
    /manche|décri|tour|Undercover/i.test(ecran), 'sinon elle ne sert à rien');

  /* ── ÉTEINDRE ── */
  section('Éteindre la télé');
  await tele.click('.cb-out');
  await wait(900);
  check('le mode s’arrête', !(await tele.evaluate(() => document.body.classList.contains('canape'))));
  check('le bandeau disparaît', !(await tele.$('#canape-bar')));
  check('et la barre du haut revient',
    await tele.evaluate(() => getComputedStyle(document.querySelector('.topbar')).display !== 'none'));

  section('La console');
  check('aucune erreur JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  [a, b, c].forEach((p) => p.socket.close());
  await nav.close();
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('\nLe banc d’essai a échoué :', err.message);
  if (errs.length) console.error(errs.slice(0, 5).join('\n'));
  process.exit(1);
});
