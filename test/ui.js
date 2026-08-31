'use strict';
/**
 * Test d'interface : pilote de vrais navigateurs, joue une manche de chaque
 * jeu, passe par la ferme, et enregistre des captures dans test/shots/.
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
    if (m.type() === 'error' && !/favicon|youtube|ERR_|font/i.test(m.text())) errors.push(`${name}: ${m.text()}`);
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#guest-name', name);
  await page.click('#form-guest button');
  await page.waitForSelector('#screen-home.active', { timeout: 15000 });
  await page.waitForSelector('#profile-card .profile-name', { timeout: 8000 });
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
  check('carte de profil affichée', await host.isVisible('#profile-card .xp-bar'));
  await host.waitForSelector('#board-body tr');
  const boardRows = await host.$$('#board-body tr');
  check('tableau des scores rempli', boardRows.length > 0, boardRows.length + ' lignes');
  await host.screenshot({ path: path.join(SHOTS, '1-accueil.png'), fullPage: true });

  /* ── Ferme ── */
  await host.click('#screen-home .nav-link[data-go="farm"]');
  await host.waitForSelector('#farm-root .farm-grid .plot', { timeout: 8000 });
  check('ferme ouverte avec ses parcelles', (await host.$$('#farm-root .plot[data-plot]')).length === 6);
  check('boutique affichée', await host.isVisible('#farm-root .shop-list .shop'));

  const coinsBefore = Number(await host.textContent('#f-coins'));
  await host.click('#farm-root .plot[data-plot="0"]');
  await host.waitForFunction(() => !document.querySelector('.plot[data-plot="0"]').classList.contains('empty'), null, { timeout: 6000 });
  check('graine plantée au clic', Number(await host.textContent('#f-coins')) < coinsBefore);

  // On arrose tant que la plante n'est pas mûre : un clic de trop la récolterait.
  let watered = 0;
  while (watered < 15) {
    const ready = await host.evaluate(() =>
      document.querySelector('.plot[data-plot="0"]').classList.contains('ready')
    );
    if (ready) break;
    await host.click('#farm-root .plot[data-plot="0"]');
    await host.waitForTimeout(180);
    watered++;
  }
  await host.waitForSelector('#farm-root .plot[data-plot="0"].ready', { timeout: 10000 });
  check('l’arrosage au clic fait mûrir la plante', true, watered + ' arrosages');
  await host.screenshot({ path: path.join(SHOTS, '2-farm.png'), fullPage: true });

  await host.click('#farm-root .plot[data-plot="0"]');
  await host.waitForFunction((c) => Number(document.querySelector('#f-coins').textContent) > c, coinsBefore, { timeout: 6000 });
  check('récolte encaissée', true);

  await host.click('#screen-farm .nav-link[data-go="home"]');
  await host.waitForSelector('#screen-home.active');

  /* ── Salon ── */
  await host.click('#btn-create');
  await host.waitForSelector('#screen-room.active');
  const code = (await host.textContent('#room-code')).trim();
  check('salon créé', /^[A-Z]{4}$/.test(code), code);

  const guest = await newPlayer(browser, 'Lea');
  await guest.fill('#join-code', code);
  await guest.click('#form-join button');
  await guest.waitForSelector('#screen-room.active');
  await host.waitForFunction(() => document.querySelectorAll('#players .player').length === 2);
  check('deuxième joueur dans le salon', true);

  /* ── Réglages : QCM + difficulté ── */
  await host.waitForSelector('#game-settings [data-diff]');
  check('sélecteur de difficulté affiché', (await host.$$('#game-settings .diff')).length === 3);
  check('sélecteur QCM / saisie affiché', await host.isVisible('[data-seg="blindtest.answerMode"]'));
  await host.screenshot({ path: path.join(SHOTS, '3-salon.png'), fullPage: true });

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
  await host.screenshot({ path: path.join(SHOTS, '4-blindtest-qcm.png'), fullPage: true });

  await host.click('#game-root .choice');
  await host.waitForTimeout(900);
  const locked = await host.evaluate(() => document.querySelectorAll('#game-root .choice[disabled]').length);
  check('un seul essai : les propositions se verrouillent', locked === 4, locked + ' verrouillées');

  // le clavier doit aussi fonctionner pour l'autre joueur
  await guest.waitForSelector('#game-root .choice:not([disabled])', { timeout: 10000 });
  await guest.keyboard.press('b');
  await guest.waitForTimeout(800);
  const guestLocked = await guest.evaluate(() => document.querySelectorAll('#game-root .choice[disabled]').length);
  check('raccourcis clavier A/B/C/D actifs', guestLocked === 4);

  await host.waitForSelector('#game-root .choice.right', { timeout: 60000 });
  check('bonne réponse mise en évidence à la révélation', true);
  await host.screenshot({ path: path.join(SHOTS, '5-blindtest-reveal.png'), fullPage: true });

  await host.click('#btn-abort');
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
  check('question lisible', (await host.textContent('#game-root .question-text')).length > 5);
  await host.screenshot({ path: path.join(SHOTS, '6-quiz-qcm.png'), fullPage: true });

  await host.click('#btn-abort');
  await host.waitForSelector('#lobby:not(.hidden)');

  /* ── Quiz en saisie libre ── */
  await host.click('[data-seg="quiz.answerMode"][data-val="type"]');
  await host.waitForTimeout(500);
  await host.click('#btn-start');
  await host.waitForSelector('#game-root .answer-mask', { timeout: 15000 });
  check('mode saisie : réponse masquée', (await host.textContent('#game-root .answer-mask')).includes('·'));
  await host.click('#btn-abort');
  await host.waitForSelector('#lobby:not(.hidden)');

  /* ── Undercover ── */
  const third = await newPlayer(browser, 'Sam');
  await third.fill('#join-code', code);
  await third.click('#form-join button');
  await third.waitForSelector('#screen-room.active');
  await host.waitForFunction(() => document.querySelectorAll('#players .player').length === 3);

  await host.click('[data-game="undercover"]');
  await host.waitForSelector('[data-set="undercover.undercoverCount"]');
  await host.click('#btn-start');
  await host.waitForSelector('#game-root .role-card', { timeout: 12000 });
  check('carte de rôle distribuée', (await host.textContent('#game-root .role-word')).trim().length > 0);
  await host.waitForSelector('#game-root .uc-grid', { timeout: 25000 });
  await host.screenshot({ path: path.join(SHOTS, '7-undercover.png'), fullPage: true });
  await host.click('#btn-abort');

  /* ── XP gagnée visible sur l'accueil ── */
  await host.waitForSelector('#lobby:not(.hidden)');
  await host.click('#btn-leave');
  await host.waitForSelector('#screen-home.active');
  const xpText = await host.textContent('#profile-card .xp-text');
  check('la carte de profil montre l’XP', /XP|NIVEAU/.test(xpText), xpText.replace(/\s+/g, ' ').trim());

  /* ── Mobile ── */
  const mobile = await newPlayer(browser, 'Mobile', { width: 390, height: 844 });
  await mobile.waitForTimeout(1200);
  await mobile.screenshot({ path: path.join(SHOTS, '8-mobile-accueil.png'), fullPage: true });
  const overflowHome = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  check('accueil sans débordement horizontal', !overflowHome);

  await mobile.click('#screen-home .nav-link[data-go="farm"]');
  await mobile.waitForSelector('#farm-root .plot', { timeout: 8000 });
  await mobile.screenshot({ path: path.join(SHOTS, '9-mobile-farm.png'), fullPage: true });
  const overflowFarm = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  check('ferme sans débordement horizontal', !overflowFarm);

  check('aucune erreur JavaScript', errors.length === 0, errors.slice(0, 4).join(' | '));

  await browser.close();
  console.log(failures === 0 ? '\n🎉 Interface OK — captures dans test/shots/\n' : `\n⚠️  ${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('💥', err);
  process.exit(1);
});
