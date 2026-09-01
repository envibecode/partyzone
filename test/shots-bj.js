/**
 * Captures d'écran de la table de blackjack et du classement en fenêtre.
 * Pas un test : un contrôle visuel. Deux navigateurs, deux joueurs, une
 * table à cinq places avec un spectateur.
 */
const { chromium } = require('playwright');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(__dirname, '..', 'shots');
require('fs').mkdirSync(OUT, { recursive: true });
const KEY = process.env.ADMIN_KEY || 'test-admin-key';

async function player(browser, name, coins) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 }, locale: 'fr-FR', deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('pz-intro', '1'); } catch {} });
  await p.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  const skip = await p.$('#intro-skip');
  if (skip) await skip.click().catch(() => {});
  await p.waitForFunction(() => !document.querySelector('#intro'), null, { timeout: 9000 }).catch(() => {});
  await p.fill('#guest-name', name);
  await p.click('#form-guest button');
  await p.waitForSelector('#app.active');
  await p.waitForFunction(() => window.PZ && window.PZ.profile);
  await p.evaluate((k) => window.PZ.socket.emit('admin:claim', { key: k }), KEY);
  await wait(600);
  await p.evaluate((c) => window.PZ.socket.emit('admin:action', {
    action: 'grant-coins', payload: { id: window.PZ.profile.id, amount: c },
  }), coins);
  await wait(600);
  return p;
}

(async () => {
  const b = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });

  const host = await player(b, 'Mattis', 300000);
  await host.screenshot({ path: OUT + '/accueil.png' });

  // Le classement en fenêtre, depuis l'accueil.
  await host.click('#btn-lb');
  await wait(1200);
  await host.screenshot({ path: OUT + '/leaderboard-popup.png' });
  await host.keyboard.press('Escape');
  await wait(400);

  // La table.
  await host.evaluate(() => { location.hash = '#blackjack'; });
  await wait(900);
  await host.evaluate(() => window.PZ.socket.emit('bj:create'));
  await wait(1500);
  const code = await host.evaluate(() => document.querySelector('#bj-table-code')?.textContent?.trim());
  console.log('table :', code);

  const two = await player(b, 'Lea', 300000);
  await two.evaluate(() => { location.hash = '#blackjack'; });
  await wait(700);
  await two.evaluate((c) => window.PZ.socket.emit('bj:join', { code: c }), code);
  await wait(1200);

  const eye = await player(b, 'Curieux', 5000);
  await eye.evaluate(() => { location.hash = '#blackjack'; });
  await wait(700);
  await eye.evaluate((c) => window.PZ.socket.emit('bj:join', { code: c, watch: true }), code);
  await wait(1200);
  await eye.screenshot({ path: OUT + '/bj-spectateur.png' });

  // Mises des deux joueurs assis → distribution immédiate.
  await host.evaluate(() => window.PZ.socket.emit('bj:bet', { amount: 500 }));
  await wait(500);
  await host.screenshot({ path: OUT + '/bj-mises.png' });
  await two.evaluate(() => window.PZ.socket.emit('bj:bet', { amount: 500 }));
  await wait(4500);
  await host.screenshot({ path: OUT + '/bj-table.png' });
  await eye.screenshot({ path: OUT + '/bj-vue-spectateur.png' });

  const errs = await host.evaluate(() => window.__pzErrors || []);
  console.log('captures dans shots/ —', errs.length, 'erreur(s)');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
