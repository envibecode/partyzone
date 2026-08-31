'use strict';
/**
 * Test d'interface : pilote deux navigateurs (l'hôte et un invité), joue un
 * blind test puis une partie d'Undercover, et enregistre des captures d'écran.
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

async function newPlayer(browser, name, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|youtube|ERR_/i.test(m.text())) errors.push(`${name}: ${m.text()}`);
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#guest-name', name);
  await page.click('#form-guest button');
  await page.waitForSelector('#screen-home.active', { timeout: 15000 });
  return page;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });

  console.log('\n▶ Interface');
  const host = await newPlayer(browser, 'Mattis');
  await host.screenshot({ path: path.join(SHOTS, '1-accueil.png') });
  check('écran d’accueil affiché', await host.isVisible('#btn-create'));

  await host.click('#btn-create');
  await host.waitForSelector('#screen-room.active');
  const code = (await host.textContent('#room-code')).trim();
  check('salon créé', /^[A-Z]{4}$/.test(code), code);

  const guest = await newPlayer(browser, 'Léa');
  await guest.fill('#join-code', code);
  await guest.click('#form-join button');
  await guest.waitForSelector('#screen-room.active');
  await host.waitForFunction(() => document.querySelectorAll('#players .player').length === 2);
  check('le second joueur rejoint', (await host.$$('#players .player')).length === 2);
  await host.screenshot({ path: path.join(SHOTS, '2-salon.png') });

  /* ── Chat ── */
  await guest.fill('#chat-input', 'salut !');
  await guest.press('#chat-input', 'Enter');
  await host.waitForSelector('#chat .msg .bubble:has-text("salut !")', { timeout: 5000 });
  check('le chat fonctionne dans les deux sens', true);

  /* ── Blind test ── */
  await host.fill('#pl-url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await host.click('#btn-import');
  await host.waitForSelector('.playlist-preview', { timeout: 15000 });
  check('playlist importée et affichée', await host.isVisible('.playlist-preview'));
  await host.screenshot({ path: path.join(SHOTS, '3-playlist.png') });

  await host.evaluate(() => {
    document.querySelector('[data-set="blindtest.rounds"]').value = 3;
    document.querySelector('[data-set="blindtest.rounds"]').dispatchEvent(new Event('change'));
    document.querySelector('[data-set="blindtest.roundSeconds"]').value = 15;
    document.querySelector('[data-set="blindtest.roundSeconds"]').dispatchEvent(new Event('change'));
  });
  await host.waitForTimeout(400);
  await host.click('#btn-start');

  await host.waitForSelector('.countdown', { timeout: 8000 });
  check('compte à rebours affiché', true);
  await host.screenshot({ path: path.join(SHOTS, '4-blindtest-countdown.png') });

  await host.waitForSelector('#bt-guess', { timeout: 15000 });
  check('manche de blind test en cours', await host.isVisible('.answer-slot'));
  const mask = await host.textContent('.answer-slot .val');
  check('le titre est masqué', mask.includes('·'), mask.trim());
  await host.screenshot({ path: path.join(SHOTS, '5-blindtest.png') });

  // On ne sait pas quelle piste est tirée : on propose les titres du jeu de test,
  // ce qui vérifie à la fois la reconnaissance ET le rejet des mauvaises réponses.
  const { TITLES, ARTISTS } = require('./stub-youtube');
  for (const t of TITLES) {
    await host.fill('#bt-guess', t);
    await host.press('#bt-guess', 'Enter');
    await host.waitForTimeout(350);
    if (await host.evaluate(() => Boolean(document.querySelector('.answer-slot.found')))) break;
  }
  const found = await host.evaluate(() => Boolean(document.querySelector('.answer-slot.found')));
  check('bonne réponse reconnue, mauvaises rejetées', found);

  // réponse tapée depuis le chat par l'autre joueur
  for (const a of ARTISTS) {
    await guest.fill('#chat-input', a);
    await guest.press('#chat-input', 'Enter');
    await guest.waitForTimeout(350);
    if (await guest.evaluate(() => Boolean(document.querySelector('.answer-slot.found')))) break;
  }
  const guestFound = await guest.evaluate(() => Boolean(document.querySelector('.answer-slot.found')));
  check('le chat sert aussi de zone de réponse', guestFound);
  await host.screenshot({ path: path.join(SHOTS, '6-blindtest-trouve.png') });

  await host.click('#btn-abort');
  await host.waitForSelector('#lobby:not(.hidden)', { timeout: 8000 });
  check('retour au salon', true);

  /* ── Quiz ── */
  await host.click('[data-game="quiz"]');
  await host.waitForSelector('[data-set="quiz.rounds"]');
  check('réglages du quiz affichés', await host.isVisible('.chips .chip'));
  await host.click('#btn-start');
  await host.waitForSelector('.question-text', { timeout: 12000 });
  check('question affichée', (await host.textContent('.question-text')).length > 5);
  await host.screenshot({ path: path.join(SHOTS, '7-quiz.png') });
  await host.click('#btn-abort');
  await host.waitForSelector('#lobby:not(.hidden)');

  /* ── Undercover (3 joueurs) ── */
  const third = await newPlayer(browser, 'Sam');
  await third.fill('#join-code', code);
  await third.click('#form-join button');
  await third.waitForSelector('#screen-room.active');
  await host.waitForFunction(() => document.querySelectorAll('#players .player').length === 3);

  await host.click('[data-game="undercover"]');
  await host.waitForSelector('[data-set="undercover.undercoverCount"]');
  await host.evaluate(() => {
    const s = document.querySelector('[data-set="undercover.mrWhite"]');
    s.value = 0;
    s.dispatchEvent(new Event('change'));
  });
  await host.waitForTimeout(400);
  await host.click('#btn-start');

  await host.waitForSelector('.role-card', { timeout: 10000 });
  const word = await host.textContent('.role-word');
  check('carte de rôle distribuée', word.trim().length > 0, word.trim());
  await host.screenshot({ path: path.join(SHOTS, '8-undercover-role.png') });

  await host.waitForSelector('.uc-grid', { timeout: 20000 });
  check('plateau Undercover affiché', (await host.$$('.uc-card')).length === 3);
  await host.screenshot({ path: path.join(SHOTS, '9-undercover.png') });

  /* ── Mobile ── */
  const mobile = await newPlayer(browser, 'Mobile', { width: 390, height: 844 });
  await mobile.fill('#join-code', code);
  await mobile.click('#form-join button');
  await mobile.waitForSelector('#screen-room.active');
  await mobile.waitForTimeout(1500);
  await mobile.screenshot({ path: path.join(SHOTS, '10-mobile.png') });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  check('pas de débordement horizontal sur mobile', !overflow);

  check('aucune erreur JavaScript', errors.length === 0, errors.slice(0, 4).join(' | '));

  await browser.close();
  console.log(failures === 0 ? '\n🎉 Interface OK — captures dans test/shots/\n' : `\n⚠️  ${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('💥', err);
  process.exit(1);
});
