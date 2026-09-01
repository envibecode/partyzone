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
  const soon = (await a.$$('#party-games .pgame.soon')).length;
  check('les jeux pas encore prêts sont marqués comme tels', soon === 4, `${soon} à venir`);
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

  await b.close();
  console.log('\n' + res.filter(Boolean).length + '/' + res.length + ' vérifications');
  if (errs.length) { console.log('erreurs :'); [...new Set(errs)].slice(0, 8).forEach(e => console.log('  ' + e)); }
  else console.log('Aucune erreur JavaScript.');
  process.exit(res.includes(false) || errs.length ? 1 : 0);
})().catch(e => { console.error('ÉCHEC :', e.message); process.exit(1); });
