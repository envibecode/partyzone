'use strict';
/**
 * LE CHAT COLLE-T-IL EN BAS ?
 *
 * C'est une de ces choses qu'aucun test serveur ne peut voir : les messages
 * arrivaient bien, mais on ouvrait l'accueil sur le premier message au lieu
 * du dernier, et il fallait faire défiler à la main. Trois causes se
 * cumulaient — le chat est monté alors que la page n'est pas encore
 * affichée (hauteur nulle), les avatars rallongent la liste après coup, et
 * on mesurait « étais-je en bas ? » sur une liste invisible.
 *
 * On vérifie donc les trois : à l'arrivée sur la page, à la réception d'un
 * message, et le fait qu'on ne se fasse PAS renvoyer en bas quand on est en
 * train de relire l'historique.
 *
 * On en profite pour vérifier la page des médailles : plus aucun nom
 * d'autre joueur sur les paliers.
 */
const { chromium } = require('playwright');
const { browserPass } = require('./pass');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE = process.env.BASE || 'http://localhost:3000';
const errs = [];
let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

/** À quelle distance du bas se trouve la liste, en pixels. */
const distance = (page, sel) => page.evaluate((s) => {
  const log = document.querySelector(s);
  return Math.round(log.scrollHeight - log.scrollTop - log.clientHeight);
}, sel);

(async () => {
  const b = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
  const p = await ctx.newPage();
  await browserPass(ctx);
  p.on('pageerror', (e) => errs.push('ERR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('CON ' + m.text()); });

  await p.goto(BASE, { waitUntil: 'networkidle' });
  const intro = await p.$('#intro-skip');
  if (intro) { await intro.click(); await wait(900); }
  await p.fill('#guest-name', 'Bavard' + Date.now().toString(36).slice(-3));
  await p.click('#form-guest button');
  await p.waitForSelector('#app.active');
  await p.waitForFunction(() => window.PZ && window.PZ.profile);

  console.log(`Le chat colle-t-il en bas ? — ${BASE}\n`);

  /* ── DE QUOI REMPLIR ── */
  section('On remplit le chat');
  /*
   * Le serveur limite la cadence du chat — c'est voulu, et c'est même
   * testé ailleurs. On espace donc les envois, et on ne compte pas sur un
   * nombre exact : ce qui compte ici, c'est que la liste dépasse la boîte,
   * pas combien de messages elle contient.
   */
  for (let i = 1; i <= 20; i++) {
    await p.evaluate((n) => window.PZ.socket.emit('chat:say', { text: `message numéro ${n}` }), i);
    await wait(700);
  }
  await wait(1200);

  const count = await p.evaluate(() => document.querySelectorAll('#chat-log .msg').length);
  check('les messages sont bien arrivés', count >= 10, `${count} messages affichés`);
  const scrollable = await p.evaluate(() => {
    const log = document.querySelector('#chat-log');
    return log.scrollHeight > log.clientHeight + 40;
  });
  check('la liste dépasse la boîte', scrollable);

  /* ── LE CŒUR DU SUJET ── */
  section('Le dernier message est visible sans rien faire');
  check('la liste est collée en bas', (await distance(p, '#chat-log')) < 8,
    `${await distance(p, '#chat-log')} px du bas`);

  const lastVisible = await p.evaluate(() => {
    const log = document.querySelector('#chat-log');
    const last = log.lastElementChild;
    if (!last) return false;
    const l = log.getBoundingClientRect();
    const r = last.getBoundingClientRect();
    return r.bottom <= l.bottom + 4 && r.top >= l.top - 4;
  });
  check('le dernier message est dans le cadre, pas dessous', lastVisible);

  /* ── ON CHANGE DE PAGE ET ON REVIENT ── */
  section('On part ailleurs, et on revient');
  await p.evaluate(() => { location.hash = '#mine'; });
  await wait(600);
  await p.evaluate(() => { location.hash = '#home'; });
  await wait(800);
  check('toujours collé en bas au retour', (await distance(p, '#chat-log')) < 8,
    `${await distance(p, '#chat-log')} px du bas`);

  /* ── UN NOUVEAU MESSAGE ── */
  section('Un message arrive');
  await p.evaluate(() => window.PZ.socket.emit('chat:say', { text: 'le tout dernier' }));
  await wait(900);
  check('on suit le nouveau message', (await distance(p, '#chat-log')) < 8,
    `${await distance(p, '#chat-log')} px du bas`);
  const lastText = await p.evaluate(() => {
    const log = document.querySelector('#chat-log');
    return (log.lastElementChild.textContent || '').includes('le tout dernier');
  });
  check('et c’est bien lui qui est en bas', lastText);

  /* ── ON RELIT L'HISTORIQUE ── */
  section('Mais on ne se fait pas renvoyer en bas de force');
  await p.evaluate(() => { document.querySelector('#chat-log').scrollTop = 0; });
  await wait(300);
  await p.evaluate(() => window.PZ.socket.emit('chat:say', { text: 'pendant que je relis' }));
  await wait(900);
  const stayed = await p.evaluate(() => document.querySelector('#chat-log').scrollTop < 40);
  check('on reste où on lisait', stayed);

  // Et si on redescend, on se recolle.
  await p.evaluate(() => {
    const log = document.querySelector('#chat-log');
    log.scrollTop = log.scrollHeight;
    log.dispatchEvent(new Event('scroll'));
  });
  await wait(300);
  await p.evaluate(() => window.PZ.socket.emit('chat:say', { text: 'et je redescends' }));
  await wait(900);
  check('redescendre remet le suivi', (await distance(p, '#chat-log')) < 8,
    `${await distance(p, '#chat-log')} px du bas`);

  /* ── LES MÉDAILLES ── */
  section('Les paliers n’appartiennent à personne');
  await p.evaluate(() => { location.hash = '#medals'; });
  await wait(1200);
  const tiers = await p.evaluate(() =>
    [...document.querySelectorAll('#tiers .tier-race')].map((n) => n.textContent.trim()));
  check('des paliers sont affichés', tiers.length >= 10, `${tiers.length} paliers`);
  check('aucun « tu l’as eu en premier »',
    !tiers.some((t) => /premier/i.test(t)), tiers.slice(0, 3).join(' | '));
  check('aucun « encore libre »', !tiers.some((t) => /libre/i.test(t)));
  check('chaque palier dit soit décroché, soit ce qu’il reste',
    tiers.every((t) => /décroché/i.test(t) || /encore \d+ objets/.test(t)),
    tiers.slice(0, 2).join(' | '));
  const gold = await p.evaluate(() => document.querySelectorAll('#tiers .tier.first').length);
  check('plus de médaille dorée réservée', gold === 0, `${gold} carte(s) dorée(s)`);

  /* ── LE CLASSEMENT DU MOIS ── */
  section('Le classement du mois se joue à l’XP');
  const seasonText = await p.evaluate(() => document.querySelector('#season-body').textContent);
  check('le texte dit que c’est l’XP', /se joue à l’XP/.test(seasonText));
  check('il dit que la Party ne compte pas', /Party ne compte pas/.test(seasonText));
  check('le compteur personnel est en XP', /Ton XP du mois/.test(seasonText));

  await b.close();
  console.log('\n──────────────────────────────');
  if (errs.length) {
    console.log('erreurs JavaScript :');
    [...new Set(errs)].slice(0, 6).forEach((e) => console.log('  ' + e));
    failures += 1;
  } else console.log('Aucune erreur JavaScript.');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error('Échec :', err.message); process.exit(1); });
