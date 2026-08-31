'use strict';
/**
 * Parcours complet du site dans un vrai navigateur.
 *
 * On joue réellement : on mine, on achète une amélioration, on lâche des
 * billes au Plinko, on mise à la roulette, on ouvre une table de blackjack
 * avec des bots, on ouvre des caisses. À chaque étape on capture l'écran,
 * et on relève toute erreur JavaScript de la console.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3000';
const SHOTS = path.join(__dirname, '..', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const errors = [];
const results = [];

function check(label, ok, detail = '') {
  results.push({ label, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'fr-FR' });
  const page = await context.newPage();

  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/favicon|net::ERR/.test(msg.text())) errors.push(`[console] ${msg.text()}`);
  });

  const shot = async (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });

  /* ── Connexion ── */
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await shot('01-auth');
  check('écran de connexion visible', await page.isVisible('#screen-auth.active'));

  await page.fill('#guest-name', 'TestJoueur');
  await page.click('#form-guest button');
  await page.waitForSelector('#app.active', { timeout: 8000 });
  await page.waitForFunction(() => window.PZ && window.PZ.profile, null, { timeout: 8000 });
  check('application chargée', true);
  await wait(600);
  await shot('02-accueil');

  const coins0 = await page.textContent('#coins');
  check('solde affiché', /\d/.test(coins0), coins0);

  /* ── La mine ── */
  await page.click('.rail-btn[data-go="mine"]');
  await page.waitForSelector('#view-mine.active');
  await page.waitForFunction(() => document.querySelectorAll('#ups .up').length > 0, null, { timeout: 5000 });
  check('améliorations listées', (await page.$$('#ups .up')).length === 5);

  for (let i = 0; i < 30; i++) { await page.click('#rock'); await wait(35); }
  await wait(900);
  const mined = Number((await page.textContent('#mine-clicks')).replace(/\D/g, ''));
  check('clics comptés par le serveur', mined >= 10, `${mined} clics`);
  await shot('03-mine');

  // On se donne de quoi jouer : la mine seule serait trop lente pour un test.
  await page.evaluate(() => window.PZ.socket.emit('mine:buy', { id: 'pick' }));
  await wait(500);

  /* ── On crédite le compte pour tester le casino ── */
  await page.evaluate(async () => {
    // On simule une longue session de mine côté serveur en achetant puis en
    // cliquant : pas de triche possible, on passe par les vrais messages.
    for (let i = 0; i < 40; i++) window.PZ.socket.emit('mine:click', { count: 20 });
  });
  await wait(1200);

  /* ── Plinko ── */
  await page.click('.rail-btn[data-go="plinko"]');
  await page.waitForSelector('#view-plinko.active');
  await page.waitForFunction(() => document.querySelectorAll('#pk-buckets .pk-bucket').length > 0, null, { timeout: 5000 });
  const buckets = (await page.$$('#pk-buckets .pk-bucket')).length;
  check('cases du Plinko affichées', buckets === 17, `${buckets} cases pour 16 rangées`);
  const rtp = await page.textContent('#pk-rtp');
  check('RTP du Plinko affiché', /9\d/.test(rtp), rtp);

  await page.fill('#pk-bet', '10');
  await page.click('#pk-play');
  await wait(2500);
  await shot('04-plinko');
  const last = await page.textContent('#pk-last');
  check('résultat de bille reçu', last !== '—', last);

  /* ── Roulette ── */
  await page.click('.rail-btn[data-go="roulette"]');
  await page.waitForSelector('#view-roulette.active');
  await page.waitForFunction(() => document.querySelector('#rl-hash').textContent.length > 20, null, { timeout: 6000 });
  check('empreinte du tour publiée', true);
  const cells = (await page.$$('#rl-table .rl-cell')).length;
  check('tapis complet', cells === 37 + 3 + 6 + 3, `${cells} cases`);

  // On attend la phase de mises pour poser un jeton.
  await page.waitForFunction(() => window.PZ && document.querySelector('#rl-phase').textContent.includes('Faites vos jeux'), null, { timeout: 40000 });
  await page.fill('#rl-chip', '10');
  await page.click('#rl-table .rl-cell.red');
  await wait(700);
  const staked = await page.textContent('#rl-staked');
  check('mise enregistrée', Number(staked.replace(/\D/g, '')) >= 10, `${staked} misé`);
  await shot('05-roulette');

  /* ── Blackjack ── */
  await page.click('.rail-btn[data-go="blackjack"]');
  await page.waitForSelector('#view-blackjack.active');
  await page.click('#bj-create');
  await page.waitForSelector('#bj-room:not(.hidden)', { timeout: 6000 });
  const code = (await page.textContent('#bj-table-code')).trim();
  check('table créée', /^[A-Z]{4}$/.test(code), code);

  await page.click('#bj-add-bot');
  await page.click('#bj-add-bot');
  await wait(600);
  const seats = (await page.$$('#bj-seats .seat')).length;
  check('bots assis à la table', seats >= 3, `${seats} sièges occupés`);

  await page.fill('#bj-bet', '50');
  await page.click('#bj-place');
  await wait(800);
  await shot('06-blackjack-mises');

  // On laisse la manche se dérouler : distribution, tour de jeu, croupier.
  await page.waitForFunction(() => document.querySelectorAll('#bj-dealer-cards .card').length > 0, null, { timeout: 40000 });
  check('cartes distribuées', true);
  await shot('07-blackjack-jeu');

  const moves = (await page.$$('#bj-actions [data-move]')).length;
  if (moves) {
    await page.click('#bj-actions [data-move="stand"]');
    check('coup joué (rester)', true);
  } else {
    check('coup joué (rester)', true, 'blackjack servi, aucun coup nécessaire');
  }
  await wait(3000);
  await shot('08-blackjack-resultat');

  await page.click('#bj-leave');
  await wait(300);

  /* ── Caisses ── */
  await page.click('.rail-btn[data-go="vault"]');
  await page.waitForSelector('#view-vault.active');
  await page.waitForFunction(() => document.querySelectorAll('#collection .coll-item').length > 0, null, { timeout: 6000 });

  const total = (await page.$$('#collection .coll-item')).length;
  check('collection complète affichée', total === 60, `${total} vignettes`);

  const locked = (await page.$$('#collection .coll-item.locked')).length;
  check('objets non obtenus grisés', locked > 0, `${locked} grisés sur ${total}`);

  // Les noms doivent être lisibles en entier : aucun texte tronqué.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('#collection .coll-item .n')]
      .filter((n) => n.scrollWidth > n.clientWidth + 1)
      .map((n) => n.textContent)
  );
  check('noms affichés en entier', clipped.length === 0, clipped.length ? `tronqués : ${clipped.slice(0, 4).join(', ')}` : 'aucun débordement');

  // Aucun point d'interrogation : on montre le vrai meme, éteint.
  const placeholders = await page.evaluate(() =>
    [...document.querySelectorAll('#collection .coll-item .e')].filter((n) => n.textContent.trim() === '❔').length
  );
  check('emoji réel même pour les manquants', placeholders === 0);

  await shot('09-collection');

  /* ── Le rouleau ── */
  await page.click('#cases .case .btn-green');
  await page.waitForSelector('.reel-window', { timeout: 6000 });
  const strip = (await page.$$('.reel-strip .reel-item')).length;
  check('bande du rouleau reçue', strip === 58, `${strip} vignettes`);
  await wait(1400);
  await shot('10-rouleau');

  await page.waitForSelector('.reel-prize.show', { timeout: 12000 });
  const prizeName = (await page.textContent('.reel-prize .n')).trim();
  check('objet révélé à la fin du rouleau', prizeName.length > 0, prizeName);

  // L'objet sous l'aiguille doit être celui qu'on a gagné.
  const aligned = await page.evaluate(() => {
    const needle = document.querySelector('.reel-needle').getBoundingClientRect();
    const x = needle.left + needle.width / 2;
    const items = [...document.querySelectorAll('.reel-strip .reel-item')];
    const under = items.find((n) => {
      const r = n.getBoundingClientRect();
      return x >= r.left && x <= r.right;
    });
    return under ? under.querySelector('.n').textContent.trim() : null;
  });
  check('l’aiguille pointe l’objet gagné', aligned === prizeName, `aiguille : ${aligned} / gagné : ${prizeName}`);
  await shot('11-rouleau-resultat');

  await page.click('.modal-close');
  await wait(600);

  /* ── Équité ── */
  await page.click('.rail-btn[data-go="fair"]');
  await page.waitForSelector('#view-fair.active');
  const hash = await page.textContent('#fair-hash');
  check('empreinte de graine affichée', hash.length === 64, `${hash.length} caractères`);
  await page.fill('#fair-seed', 'ma-graine-a-moi');
  await page.click('#fair-form button');
  await wait(800);
  const revealed = await page.isVisible('#fair-prev:not(.hidden)');
  check('graine précédente révélée après rotation', revealed);
  await shot('12-equite');

  /* ── Accueil : classement ── */
  await page.click('.rail-btn[data-go="home"]');
  await page.waitForSelector('#view-home.active');
  await wait(900);
  const lbRows = (await page.$$('#leaderboard li:not(.empty)')).length;
  check('classement peuplé', lbRows > 0, `${lbRows} lignes`);
  await shot('13-accueil-final');

  /* ── Mobile ── */
  const mobile = await context.newPage();
  mobile.on('pageerror', (err) => errors.push(`[mobile] ${err.message}`));
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('#app.active', { timeout: 8000 });
  await wait(700);
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('aucun débordement horizontal sur mobile', overflow <= 1, `${overflow}px`);
  await mobile.screenshot({ path: path.join(SHOTS, '14-mobile.png'), fullPage: false });

  await mobile.click('.rail-btn[data-go="vault"]').catch(() => {});
  await wait(400);
  await mobile.evaluate(() => document.querySelector('#btn-menu').click());
  await wait(400);
  await mobile.screenshot({ path: path.join(SHOTS, '15-mobile-menu.png') });

  await browser.close();

  /* ── Bilan ── */
  console.log('\n──────────────────────────────');
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} vérifications passées`);
  if (errors.length) {
    console.log(`\n${errors.length} erreur(s) JavaScript :`);
    [...new Set(errors)].slice(0, 15).forEach((e) => console.log(`  ${e}`));
  } else {
    console.log('Aucune erreur JavaScript.');
  }
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch((err) => {
  console.error('\nLe parcours a échoué :', err.message);
  process.exit(1);
});
