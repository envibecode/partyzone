'use strict';
/**
 * Test d'interface : pilote de vrais navigateurs, ouvre des caisses, joue une
 * manche de chaque jeu, vérifie le podium, et enregistre des captures.
 *
 *   node -r ./test/stub-youtube.js server/index.js   (port 3100)
 *   node test/ui.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.UI_BASE || 'http://localhost:3100';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const errors = [];
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
}

async function newPlayer(browser, name, viewport = { width: 1440, height: 950 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|youtube|ERR_|font|AudioContext/i.test(m.text())) {
      errors.push(`${name}: ${m.text()}`);
    }
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#guest-name', name);
  await page.click('#form-guest button');
  await page.waitForSelector('#app.active', { timeout: 15000 });
  await page.waitForSelector('#progress-ring .ring', { timeout: 8000 });
  return page;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });

  console.log('\n▶ Interface');

  /* ── Accueil ── */
  const host = await newPlayer(browser, 'Mattis');
  check('anneau de progression affiché', await host.isVisible('#progress-ring .ring-fill'));
  check('rail des joueurs en ligne présent', await host.isVisible('.online'));
  await host.waitForSelector('#board-body tr');
  check('classement rempli', (await host.$$('#board-body tr')).length > 0);
  check('la carte à l’affiche change de jeu', await host.isVisible('#hero [data-play]'));
  await host.click('[data-feature="undercover"]');
  await host.waitForTimeout(300);
  check('cliquer une carte change le héros', (await host.textContent('#hero h1')).includes('Undercover'));
  await host.click('[data-feature="blindtest"]');
  await host.screenshot({ path: path.join(SHOTS, '1-accueil.png'), fullPage: true });

  /* ── MemeVault ── */
  await host.click('.rail-btn[data-go="vault"]');
  await host.waitForSelector('#vault-root .case', { timeout: 8000 });
  check('4 caisses affichées', (await host.$$('#vault-root .case')).length === 4);
  check('collection affichée', (await host.$$('#vault-root .item')).length === 60);
  check('barres de probabilité affichées', (await host.$$('#vault-root .odds i')).length >= 4);

  const coinsBefore = Number((await host.textContent('#v-coins')).replace(/\D/g, ''));
  await host.click('#vault-root .case:nth-child(1) [data-count="1"]');
  await host.waitForSelector('#vault-root .pull', { timeout: 8000 });
  check('une carte est tirée', (await host.$$('#vault-root .pull')).length === 1);
  const owned = await host.evaluate(() => document.querySelectorAll('#vault-root .item:not(.locked)').length);
  check('l’item rejoint la collection', owned === 1, owned + ' possédé(s)');
  await host.screenshot({ path: path.join(SHOTS, '2-vault.png'), fullPage: true });

  await host.click('#vault-root .case:nth-child(1) [data-count="5"]');
  await host.waitForFunction(() => document.querySelectorAll('#vault-root .pull').length === 5, null, { timeout: 12000 });
  check('ouverture par 5', true);
  const coinsAfter = Number((await host.textContent('#v-coins')).replace(/\D/g, ''));
  check('les pièces sont débitées', coinsAfter < coinsBefore, `${coinsBefore} → ${coinsAfter}`);
  const combo = await host.textContent('#vault-root .res.combo b');
  check('le combo grimpe', parseFloat(combo.replace('x', '')) > 1, combo);
  await host.screenshot({ path: path.join(SHOTS, '3-vault-pulls.png'), fullPage: true });

  /* ── Salon ── */
  await host.click('#rail-create');
  await host.waitForSelector('#view-room.active');
  const code = (await host.textContent('#room-code')).trim();
  check('salon créé', /^[A-Z]{4}$/.test(code), code);

  const guest = await newPlayer(browser, 'Lea');
  await guest.fill('#join-code', code);
  await guest.click('#form-join button');
  await guest.waitForSelector('#view-room.active');
  await host.waitForFunction(() => document.querySelectorAll('#players .player').length === 2);
  check('deuxième joueur dans le salon', true);
  check('sélecteur de difficulté affiché', (await host.$$('#game-settings .diff')).length === 3);
  await host.screenshot({ path: path.join(SHOTS, '4-salon.png'), fullPage: true });

  /* ── Blind test en QCM ── */
  await host.fill('#pl-url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await host.click('#btn-import');
  await host.waitForSelector('.playlist-preview', { timeout: 15000 });
  await host.evaluate(() => {
    const r = document.querySelector('[data-set="blindtest.rounds"]');
    r.value = 2;
    r.dispatchEvent(new Event('change'));
  });
  await host.waitForTimeout(400);
  await host.click('#btn-start');

  await host.waitForSelector('#game-root .choice', { timeout: 20000 });
  check('QCM du blind test affiché', (await host.$$('#game-root .choice')).length === 4);
  await host.screenshot({ path: path.join(SHOTS, '5-blindtest.png'), fullPage: true });

  await host.click('#game-root .choice');
  await host.waitForTimeout(700);
  check('un seul essai : les propositions se verrouillent',
    (await host.evaluate(() => document.querySelectorAll('#game-root .choice[disabled]').length)) === 4);
  check('la musique continue après la réponse',
    await host.isVisible('#game-root .disc.spin'));

  await guest.waitForSelector('#game-root .choice:not([disabled])', { timeout: 10000 });
  await guest.keyboard.press('b');
  await guest.waitForTimeout(700);
  check('raccourcis clavier A/B/C/D actifs',
    (await guest.evaluate(() => document.querySelectorAll('#game-root .choice[disabled]').length)) === 4);

  await host.waitForSelector('#game-root .choice.right', { timeout: 60000 });
  check('bonne réponse mise en évidence à la révélation', true);
  check('la musique tourne encore pendant la révélation',
    (await host.textContent('#game-root')).includes('continue jusqu’à la manche suivante'));

  /* ── Podium en fin de partie ── */
  await host.waitForSelector('#game-root .podium', { timeout: 120000 });
  check('podium affiché en fin de partie', (await host.$$('#game-root .step')).length >= 1);
  check('le podium montre les avatars', (await host.$$('#game-root .step .avatar')).length >= 1);
  check('couche à confettis créée', await host.evaluate(() => Boolean(document.querySelector('.confetti-layer'))));
  await host.screenshot({ path: path.join(SHOTS, '6-podium.png'), fullPage: true });

  await host.click('[data-act="back"]');
  await host.waitForSelector('#lobby:not(.hidden)', { timeout: 8000 });

  /* ── Quiz en QCM ── */
  await host.click('[data-game="quiz"]');
  await host.waitForSelector('[data-diff^="quiz"]');
  await host.click('[data-diff="quiz:rookie"]');
  await host.waitForTimeout(400);
  await host.click('#btn-start');
  await host.waitForSelector('#game-root .question-text', { timeout: 15000 });
  await host.waitForSelector('#game-root .choice', { timeout: 15000 });
  check('QCM du quiz affiché', (await host.$$('#game-root .choice')).length === 4);
  await host.screenshot({ path: path.join(SHOTS, '7-quiz.png'), fullPage: true });
  await host.click('#btn-abort');
  await host.waitForSelector('#lobby:not(.hidden)');

  /* ── Mobile ── */
  const mobile = await newPlayer(browser, 'Mobile', { width: 390, height: 844 });
  await mobile.waitForTimeout(1000);

  /* ── Présence : trois joueurs, deux statuts différents ── */
  await host.waitForFunction(() => document.querySelectorAll('#online-list .on-user').length >= 3, null, { timeout: 10000 });
  check('les trois joueurs sont dans le rail « en ligne »',
    (await host.$$('#online-list .on-user')).length >= 3);
  await host.waitForFunction(() => {
    const c = [...document.querySelectorAll('#online-list .status')].map((s) => s.className);
    return c.some((x) => x.includes('s-room')) && c.some((x) => x.includes('s-home'));
  }, null, { timeout: 10000 });
  const statuses = await host.evaluate(() =>
    [...document.querySelectorAll('#online-list .status')].map((s) => s.className.replace('status ', ''))
  );
  check('les statuts sont différenciés', true, statuses.join(' | '));
  await mobile.screenshot({ path: path.join(SHOTS, '8-mobile.png'), fullPage: true });
  check('accueil sans débordement horizontal',
    !(await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)));

  await mobile.click('.rail-btn[data-go="vault"]');
  await mobile.waitForSelector('#vault-root .case', { timeout: 8000 });
  await mobile.screenshot({ path: path.join(SHOTS, '9-mobile-vault.png'), fullPage: true });
  check('MemeVault sans débordement horizontal',
    !(await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)));

  check('aucune erreur JavaScript', errors.length === 0, errors.slice(0, 4).join(' | '));

  await browser.close();
  console.log(failures === 0 ? '\n🎉 Interface OK — captures dans test/shots/\n' : `\n⚠️  ${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('💥', err);
  process.exit(1);
});
