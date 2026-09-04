'use strict';
/**
 * CAPTURES DE LA SOIRÉE.
 *
 * Le simulateur vérifie les points, le banc d'essai vérifie la bascule.
 * Reste ce qu'aucun des deux ne voit : est-ce que ça a l'air de quelque
 * chose ? Trois navigateurs, une soirée en trois manches, et une capture
 * à chaque étape.
 */
const { chromium } = require('playwright');
const { browserPass } = require('./pass');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = require('path').join(__dirname, '..', 'shots');
require('fs').mkdirSync(OUT, { recursive: true });

const errs = [];

async function player(b, name) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await browserPass(ctx);
  p.on('pageerror', (e) => errs.push(`ERR(${name}) ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(`CON(${name}) ${m.text()}`); });
  await p.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  const intro = await p.$('#intro-skip');
  if (intro) { await intro.click(); await wait(900); }
  await p.fill('#guest-name', name);
  await p.click('#form-guest button');
  await p.waitForSelector('#app.active');
  await p.waitForFunction(() => window.PZ && window.PZ.profile);
  return p;
}

(async () => {
  const b = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const tag = Date.now().toString(36).slice(-3);
  const a = await player(b, 'Mattis' + tag);
  const c = await player(b, 'Lea' + tag);
  const d = await player(b, 'Momo' + tag);

  for (const p of [a, c, d]) await p.evaluate(() => { location.hash = '#party'; });
  await wait(900);

  // ── LE CHOIX DES JEUX ──
  await a.evaluate(() => document.querySelector('#party-soiree').scrollIntoView());
  // Le panneau se redessine à chaque clic (les numéros d'ordre changent),
  // donc on retrouve le bouton par son nom à chaque fois plutôt que de
  // garder une poignée qui se détache du document.
  for (const name of ['Undercover', 'Uno', 'Blindtest']) {
    await a.evaluate((n) => {
      const btn = [...document.querySelectorAll('#soiree-body .spick')]
        .find((x) => x.textContent.trim().startsWith(n));
      if (btn) btn.click();
    }, name);
    await wait(200);
  }
  await wait(300);
  await a.screenshot({ path: OUT + '/soiree-choix.png' });
  console.log('  · shots/soiree-choix.png');

  // ── LA SOIRÉE LANCÉE ──
  await a.click('#soiree-body .soiree-foot .btn-green');
  await a.waitForSelector('#view-uc.active', { timeout: 6000 });
  const code = (await a.textContent('#uc-code')).trim();
  for (const p of [c, d]) {
    await p.fill('#party-code', code);
    await p.click('#party-join-form button');
    await p.waitForSelector('#view-uc.active', { timeout: 6000 });
  }
  await wait(700);
  await a.screenshot({ path: OUT + '/soiree-manche1.png' });
  console.log('  · shots/soiree-manche1.png  (bandeau de soirée en haut du salon)');

  const bar = await a.$('.soiree-bar');
  console.log(bar ? '  ✓ le bandeau de soirée est affiché' : '  ✗ pas de bandeau de soirée');

  // ── UNE MANCHE JOUÉE ──
  await a.click('#uc-start');
  await a.waitForFunction(() => window.PZ.state && window.PZ.state.uc, null, { timeout: 6000 }).catch(() => {});
  let guard = 0;
  while (guard++ < 40) {
    const phase = await a.evaluate(() => (document.querySelector('#view-uc.active') ? window.__ucPhase || '' : ''));
    // On pilote par les sockets : cliquer chaque bouton d'une partie
    // d'Undercover à trois n'apprendrait rien de plus sur la soirée.
    const done = await a.evaluate(() => Boolean(document.querySelector('#uc-result')));
    if (done || phase === 'over') break;
    for (const p of [a, c, d]) {
      await p.evaluate(() => {
        const s = window.PZ.socket;
        const input = document.querySelector('#uc-input');
        if (input) { s.emit('uc:describe', { text: 'un truc' }); }
        const vote = document.querySelector('#uc-action .rplayer button, #uc-action .btn');
        if (!input && vote) vote.click();
      });
    }
    await wait(500);
  }
  await wait(1200);
  await a.screenshot({ path: OUT + '/soiree-fin-manche.png' });
  console.log('  · shots/soiree-fin-manche.png');

  // ── LE CLASSEMENT ──
  await a.evaluate(() => { location.hash = '#party'; });
  await wait(800);
  await a.evaluate(() => document.querySelector('#party-soiree').scrollIntoView());
  await wait(300);
  await a.screenshot({ path: OUT + '/soiree-classement.png' });
  console.log('  · shots/soiree-classement.png');

  await b.close();
  if (errs.length) {
    console.log('\nerreurs :');
    [...new Set(errs)].slice(0, 8).forEach((e) => console.log('  ' + e));
  } else console.log('\nAucune erreur JavaScript.');
})().catch((err) => { console.error('Échec :', err.message); process.exit(1); });
