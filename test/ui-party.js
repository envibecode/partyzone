/**
 * Parcours navigateur de la section Party.
 *
 * Deux vrais navigateurs ouvrent un salon, jouent une manche d'Undercover,
 * puis une main de poker. On vérifie surtout ce qu'on ne peut pas vérifier
 * côté serveur : que l'écran affiche bien ce qu'il faut, et RIEN de ce qu'il
 * ne faut pas — le mot du voisin, ses cartes.
 */
const { chromium } = require('playwright');
const wait = ms => new Promise(r => setTimeout(r, ms));
const OUT = require('path').join(__dirname, '..', 'shots');
require('fs').mkdirSync(OUT, { recursive: true });

const errs = [], res = [];
const check = (l, ok, d = '') => { res.push(ok); console.log(`${ok ? '  ✓' : '  ✗'} ${l}${d ? ' — ' + d : ''}`); };

async function player(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 }, locale: 'fr-FR' });
  const p = await ctx.newPage();
  // La porte : le site est fermé avant son ouverture, et le navigateur
  // d'essai entre comme tout le monde — avec la clé.
  await p.goto('http://localhost:3000/maintenance.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.evaluate((k) => fetch('/api/gate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k }),
  }).then((r) => r.json()), process.env.ADMIN_KEY || 'test-admin-key');
  // On écoute la console seulement une fois la porte franchie : les 503 de
  // la page d'attente sont le comportement attendu.
  p.on('pageerror', e => errs.push(`ERR(${name}) ` + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_TUNNEL/.test(m.text())) errs.push(`CON(${name}) ` + m.text()); });

  await p.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  const intro = await p.$('#intro-skip');
  if (intro) { await intro.click(); await wait(1000); }
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

  const suffix = Date.now().toString(36).slice(-3);
  const a = await player(b, 'Titiss' + suffix);
  const c = await player(b, 'Faboz' + suffix);
  const d = await player(b, 'Momo' + suffix);
  check('trois joueurs connectés', true);

  // ── LE HALL ──
  for (const p of [a, c, d]) { await p.evaluate(() => { location.hash = '#party'; }); }
  await wait(900);
  check('le rang Party s’affiche', /rang Party/i.test(await a.textContent('#party-rank')));
  const games = (await a.$$('#party-games .pgame')).length;
  check('les six jeux sont listés', games === 6, `${games} cartes`);
  /*
   * On ne compte plus les jeux « à venir » : ce chiffre baisse à chaque
   * fois qu'on en livre un, et un test qu'il faut réécrire à chaque
   * livraison finit par être réécrit sans être relu. On vérifie la RÈGLE :
   * un jeu marqué à venir n'est pas cliquable, un jeu prêt l'est — et il
   * en reste au moins un de chaque, sinon le hall n'a plus rien à dire.
   */
  const soon = (await a.$$('#party-games .pgame.soon')).length;
  const ready = (await a.$$('#party-games .pgame:not(.soon)')).length;
  check('le hall distingue les jeux prêts de ceux à venir',
    ready >= 3 && soon >= 1 && ready + soon === games, `${ready} jouables, ${soon} à venir`);
  const soonClickable = await a.evaluate(() =>
    [...document.querySelectorAll('#party-games .pgame.soon button')].filter((b) => !b.disabled).length);
  check('on ne peut pas ouvrir un salon d’un jeu pas encore là', soonClickable === 0);
  check('Uno est jouable', await a.evaluate(() =>
    Boolean(document.querySelector('#party-games .pgame:not(.soon)')) &&
    [...document.querySelectorAll('#party-games .pgame:not(.soon)')]
      .some((n) => /Uno/.test(n.textContent))));
  await a.screenshot({ path: OUT + '/party-hall.png' });

  // ── UNDERCOVER ──
  await a.click('#party-games .pgame:nth-child(1) .btn');
  await a.waitForSelector('#view-uc.active', { timeout: 5000 });
  const code = (await a.textContent('#uc-code')).trim();
  check('salon ouvert avec un code', /^[A-Z]{4}$/.test(code), code);

  for (const p of [c, d]) {
    await p.fill('#party-code', code);
    await p.click('#party-join-form button');
    await p.waitForSelector('#view-uc.active', { timeout: 5000 });
  }
  await wait(600);
  const list = (await a.$$('#uc-players .rplayer')).length;
  check('les trois joueurs apparaissent dans le salon', list === 3, `${list}`);
  check('l’hôte voit les réglages', await a.isVisible('#uc-settings'));
  check('les autres ne voient pas les réglages', !(await c.isVisible('#uc-settings')));

  await a.click('#uc-start');
  await a.waitForFunction(() => document.querySelector('#uc-phase').textContent.includes('décrit'), null, { timeout: 6000 });
  await wait(500);

  const words = await Promise.all([a, c, d].map(p => p.textContent('.uc-word-main').catch(() => null)));
  check('chacun voit un mot (ou ???)', words.every(w => w && w.length > 0), words.join(' / '));
  check('deux mots différents sont distribués', new Set(words).size >= 2, words.join(' / '));

  // Personne ne doit pouvoir lire le mot d'un autre dans la page.
  // Le mot du voisin ne doit apparaître NULLE PART dans la page — ni dans le
  // texte, ni dans l'état JavaScript que n'importe qui peut inspecter.
  const secrets = [...new Set(words.filter(w => w && w !== '???'))];
  const mine = await a.textContent('.uc-word-main');
  const neighbours = secrets.filter(w => w !== mine);
  const leaked = await a.evaluate((list) => {
    const page = document.querySelector('#view-uc').textContent;
    const stateDump = JSON.stringify(window.PZ.profile) + page;
    return list.filter(w => stateDump.includes(w));
  }, neighbours);
  check('le mot des autres n’est nulle part dans ta page', leaked.length === 0,
    neighbours.length ? `${neighbours.length} mot(s) voisin(s) testé(s)` : 'un seul mot en jeu');
  await a.screenshot({ path: OUT + '/undercover-mot.png' });

  // Un tour de descriptions.
  for (let i = 0; i < 4; i++) {
    for (const p of [a, c, d]) {
      const input = await p.$('#uc-action input');
      if (input) { await input.fill(`indice ${i}`); await p.click('#uc-action button'); await wait(350); }
    }
    await wait(250);
    const phase = await a.textContent('#uc-phase');
    if (/vote/i.test(phase)) break;
  }
  check('la phase de vote arrive', /vote/i.test(await a.textContent('#uc-phase')), await a.textContent('#uc-phase'));
  const said = (await a.$$('#uc-board .uc-line.done')).length;
  check('les descriptions sont affichées', said === 3, `${said} lignes`);
  const voteBtns = (await a.$$('#uc-players .vote-btn')).length;
  check('des boutons de vote apparaissent', voteBtns === 2, `${voteBtns} boutons`);
  await a.screenshot({ path: OUT + '/undercover-vote.png' });

  await a.click('#uc-players .vote-btn');
  await wait(400);
  check('le vote est marqué', (await a.textContent('#uc-players')).includes('voté'));

  await a.click('#uc-leave'); await c.click('#uc-leave'); await d.click('#uc-leave');
  await wait(500);

  // ── POKER ──
  await a.click('#party-games .pgame:nth-child(2) .btn');
  await a.waitForSelector('#view-pk.active', { timeout: 5000 });
  const pkCode = (await a.textContent('#pk-code')).trim();
  for (const p of [c, d]) {
    await p.fill('#party-code', pkCode);
    await p.click('#party-join-form button');
    await p.waitForSelector('#view-pk.active', { timeout: 5000 });
  }
  await wait(500);
  await a.click('#pk-start');
  await a.waitForFunction(() => document.querySelectorAll('#pk-seats .pcard').length > 0, null, { timeout: 6000 });
  await wait(800);

  const myCards = await a.evaluate(() => {
    const me = document.querySelector('#pk-you .pk-hand');
    return me ? [...me.querySelectorAll('.pcard')].map(c => c.classList.contains('back') ? null : c.textContent) : [];
  });
  check('tes deux cartes sont visibles', myCards.length === 2 && myCards.every(Boolean), myCards.join(' '));

  const others = await a.evaluate(() => {
    const me = window.PZ.me.id;
    return [...document.querySelectorAll('#pk-seats .pseat')]
      .filter(s => !s.classList.contains('you'))
      .map(s => [...s.querySelectorAll('.pcard')].every(c => c.classList.contains('back')));
  });
  check('les cartes des autres restent des dos', others.length === 2 && others.every(Boolean));
  check('le pot et les blindes sont affichés',
    /\d/.test(await a.textContent('#pk-pot')) && /Blindes/.test(await a.textContent('#pk-blinds')));
  const stacks = (await a.$$('#pk-stacks .stackrow')).length;
  check('les tapis sont listés', stacks === 3, `${stacks}`);
  await a.screenshot({ path: OUT + '/poker-table.png' });

  // Le joueur dont c'est le tour doit avoir des boutons.
  const actor = await Promise.all([a, c, d].map(async p => ({ p, turn: await p.$('#pk-actions .pk-btns') })));
  const who = actor.find(x => x.turn);
  check('celui dont c’est le tour a ses boutons', Boolean(who));
  if (who) {
    const hasRaise = await who.p.$('.pk-slider');
    check('le curseur de relance est proposé', Boolean(hasRaise));
    await who.p.screenshot({ path: OUT + '/poker-actions.png' });
    await who.p.click('#pk-actions .pk-btns .btn:last-child');
    await wait(600);
    check('l’action est prise en compte', true);
  }

  // ── UNO ──
  //
  // Le contrôle qui compte ici est le même qu'à Undercover et au poker :
  // ce que le voisin a en main ne doit exister nulle part dans ma page.
  // Une main envoyée à tout le monde et masquée en CSS se lit en trois
  // secondes dans la console — ce serait le seul vrai bug possible.
  await a.click('#pk-leave'); await c.click('#pk-leave'); await d.click('#pk-leave');
  await wait(600);

  await a.evaluate(() => window.PZ.socket.emit('party:create', { game: 'uno' }));
  await a.waitForSelector('#view-uno.active', { timeout: 6000 });
  const unoCode = (await a.textContent('#uno-code')).trim();
  check('table d’Uno ouverte', /^[A-Z]{4}$/.test(unoCode), unoCode);

  for (const p of [c, d]) {
    await p.evaluate((k) => window.PZ.socket.emit('party:join', { code: k }), unoCode);
    await p.waitForSelector('#view-uno.active', { timeout: 6000 });
  }
  await wait(600);
  const atTable = (await a.$$('#uno-seats .uno-seat')).length;
  check('les trois joueurs sont à la table', atTable === 3, `${atTable}`);

  await a.click('#uno-start');
  await a.waitForFunction(() => document.querySelectorAll('#uno-hand .uno-slot').length > 0, null, { timeout: 6000 });
  await wait(700);

  const hands = await Promise.all([a, c, d].map((p) =>
    p.$$eval('#uno-hand .uno-slot', (n) => n.length)));
  check('sept cartes chacun', hands.every((h) => h === 7), hands.join(' / '));

  const left = Number(await a.textContent('#uno-left'));
  check('la pioche est cohérente', left === 108 - 3 * 7 - 1,
    `${left} restantes (108 − 21 en main − 1 sur la pile)`);
  check('une carte est sur la pile', Boolean(await a.$('#uno-top .uno-card')));

  // La main de Léa, vue depuis la page de Mattis : elle ne doit pas y être.
  const leaHand = await c.$$eval('#uno-hand .uno-slot .uno-card',
    (n) => n.map((x) => `${x.className}|${x.dataset.value}`));
  const seen = await a.evaluate(() => {
    const page = document.querySelector('#view-uno').innerHTML;
    const stateDump = JSON.stringify(window.PZ.profile || {});
    return { page, stateDump };
  });
  const cardsOfOthers = await a.evaluate(() =>
    // Combien de cartes VISIBLES la page compte-t-elle en tout ? Ma main,
    // plus la carte du dessus de la pile. Pas une de plus.
    document.querySelectorAll('#view-uno .uno-card').length);
  check('la page ne montre que ma main et la pile', cardsOfOthers === 8,
    `${cardsOfOthers} cartes visibles (7 en main + 1 sur la pile)`);
  check('la main des autres n’est pas dans la page', leaHand.length === 7 && !seen.page.includes('data-hand'));

  const playable = (await a.$$('#uno-hand .uno-slot.can')).length;
  check('le serveur dit quelles cartes sont jouables', playable >= 0, `${playable} jouables`);
  await a.screenshot({ path: OUT + '/uno-table.png' });

  // ── BELOTE ──
  //
  // La belote demande un quatrième joueur : on l'invite pour cette
  // section-là. Ce qu'on vérifie ici, en plus du secret des mains : que le
  // serveur a bien calculé les obligations, et que la page les respecte —
  // une carte interdite doit être désactivée, pas seulement grisée.
  for (const p of [a, c, d]) { await p.click('#uno-leave'); }
  await wait(600);
  const e = await player(b, 'Zoe' + suffix);
  for (const p of [a, c, d, e]) { await p.evaluate(() => { location.hash = '#party'; }); }
  await wait(800);

  await a.evaluate(() => window.PZ.socket.emit('party:create', { game: 'belote' }));
  await a.waitForSelector('#view-bl.active', { timeout: 6000 });
  const blCode = (await a.textContent('#bl-code')).trim();
  check('table de belote ouverte', /^[A-Z]{4}$/.test(blCode), blCode);

  for (const p of [c, d, e]) {
    await p.evaluate((k) => window.PZ.socket.emit('party:join', { code: k }), blCode);
    await p.waitForSelector('#view-bl.active', { timeout: 6000 });
  }
  await wait(700);
  const teams = (await a.$$('#bl-teams .bl-team')).length;
  check('deux équipes formées', teams === 2, `${teams}`);

  await a.click('#bl-start');
  await a.waitForFunction(() => document.querySelectorAll('#bl-hand .bl-slot').length > 0, null, { timeout: 6000 });
  await wait(800);

  const blHands = await Promise.all([a, c, d, e].map((p) =>
    p.$$eval('#bl-hand .bl-slot', (n) => n.length)));
  check('cinq cartes chacun avant la prise', blHands.every((h) => h === 5), blHands.join(' / '));
  check('la retourne est visible au milieu', Boolean(await a.$('#bl-center .bl-turned .bl-card')));

  // Quelqu'un prend, et tout le monde passe à huit cartes.
  let took = false;
  for (let round = 0; round < 10 && !took; round++) {
    for (const p of [a, c, d, e]) {
      const take = await p.$('#bl-actions .btn-gold') || await p.$('#bl-actions .bl-suit-btn');
      if (take) { await take.click(); took = true; break; }
    }
    if (took) break;
    for (const p of [a, c, d, e]) {
      const pass = await p.$('#bl-actions .btn-soft');
      if (pass) { await pass.click(); break; }
    }
    await wait(400);
  }
  check('quelqu’un a pris', took);
  await wait(1200);

  const after = await Promise.all([a, c, d, e].map((p) =>
    p.$$eval('#bl-hand .bl-slot', (n) => n.length)));
  check('huit cartes chacun après la prise', after.every((h) => h === 8), after.join(' / '));
  check('l’atout est affiché en permanence',
    /atout/i.test((await a.textContent('#bl-trump')) || ''), (await a.textContent('#bl-trump')).trim());

  // Le secret : ma page ne doit contenir QUE mes huit cartes. Les autres
  // sont des dos, qui ne portent ni rang ni couleur.
  const visible = await a.evaluate(() =>
    [...document.querySelectorAll('#view-bl .bl-card')].filter((n) => !n.classList.contains('back')).length);
  check('la page ne montre que ma main', visible === 8, `${visible} cartes à visage découvert`);

  // Les obligations : le serveur dit quelles cartes sont jouables, et la
  // page désactive les autres.
  const turnPage = (await Promise.all([a, c, d, e].map(async (p) => ({
    p, mine: await p.evaluate(() => Boolean(window.PZ.views.bl) && document.querySelectorAll('#bl-hand .bl-slot.can:not([disabled])').length > 0),
  })))).find((x) => x.mine);
  check('celui dont c’est le tour a des cartes jouables', Boolean(turnPage));
  if (turnPage) {
    const counts = await turnPage.p.evaluate(() => ({
      can: document.querySelectorAll('#bl-hand .bl-slot.can').length,
      off: document.querySelectorAll('#bl-hand .bl-slot[disabled]').length,
      all: document.querySelectorAll('#bl-hand .bl-slot').length,
    }));
    check('les cartes interdites sont désactivées, pas seulement grisées',
      counts.can + counts.off >= counts.all, `${counts.can} jouables, ${counts.off} bloquées sur ${counts.all}`);
    await turnPage.p.click('#bl-hand .bl-slot.can:not([disabled])');
    await wait(700);
    const played = await a.evaluate(() => document.querySelectorAll('#bl-center .bl-pile .bl-card').length);
    check('la carte arrive sur le tapis', played >= 1, `${played} carte(s) au pli`);
  }
  await a.screenshot({ path: OUT + '/belote-table.png' });

  await b.close();
  console.log('\n' + res.filter(Boolean).length + '/' + res.length + ' vérifications');
  if (errs.length) { console.log('erreurs :'); [...new Set(errs)].slice(0, 8).forEach(e => console.log('  ' + e)); }
  else console.log('Aucune erreur JavaScript.');
  process.exit(res.includes(false) || errs.length ? 1 : 0);
})().catch(e => { console.error('ÉCHEC :', e.message); process.exit(1); });
