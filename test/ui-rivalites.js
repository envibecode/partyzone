'use strict';
/**
 * LES RIVALITÉS, DANS LE NAVIGATEUR.
 *
 * Le serveur peut être parfait et la fonctionnalité inexistante : si le
 * bouton n'apparaît pas, si la fenêtre plante, si le bandeau se pose au
 * mauvais endroit, personne ne défiera jamais personne.
 *
 * On vérifie donc ce qu'aucun banc d'essai serveur ne voit :
 *
 *  · les deux gestes sont là dans la liste des connectés — et PAS sur soi ;
 *  · la fenêtre de défi s'ouvre et propose de vrais jeux ;
 *  · la fenêtre de face-à-face se remplit vraiment (elle fait un appel
 *    réseau : c'est le genre d'endroit où une faute de frappe dans une URL
 *    ne se voit qu'ici) ;
 *  · le bandeau du mois se pose sous la barre du haut ;
 *  · et le tout sans une seule erreur JavaScript.
 */

const { chromium } = require('playwright');
const { browserPass } = require('./pass');
const { io } = require('socket.io-client');
const { gatePass, withPass } = require('./pass');

const BASE = process.env.BASE || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const errs = [];
let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

/** Un deuxième joueur, en ligne mais sans navigateur : il suffit d'un socket. */
async function copain(pass, name) {
  const res = await fetch(`${BASE}/auth/guest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: pass },
    body: JSON.stringify({ name }),
  });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  const cookie = withPass(pass, raw.map((c) => c.split(';')[0]).join('; '));
  const socket = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
  const p = { name, socket, defis: null };
  socket.on('defi:state', (s) => { p.defis = s; });
  await new Promise((ok, ko) => {
    socket.on('connect', ok);
    setTimeout(() => ko(new Error('connexion trop lente')), 6000);
  });
  await wait(400);
  return p;
}

(async () => {
  const pass = await gatePass(BASE);
  const tag = Date.now().toString(36).slice(-3);
  const ami = await copain(pass, 'Voisin' + tag);

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
  await p.fill('#guest-name', 'Rival' + tag);
  await p.click('#form-guest button');
  await p.waitForSelector('#app.active');
  await p.waitForFunction(() => window.PZ && window.PZ.profile);
  await wait(1200);

  console.log(`Les rivalités dans le navigateur — ${BASE}\n`);

  /* ── LA LISTE DES CONNECTÉS ── */
  section('Les deux gestes, dans la liste des connectés');
  /*
   * Le panneau est déjà ouvert sur un grand écran : cliquer sans regarder
   * le REFERMAIT, et on cherchait ensuite des boutons présents dans le DOM
   * mais invisibles. On ouvre donc seulement s'il est fermé.
   */
  const ouvert = () => p.evaluate(() => {
    const rail = document.getElementById('rail');
    return Boolean(rail) && !rail.hidden;
  });
  if (!(await ouvert())) { await p.click('#btn-rail'); await wait(700); }
  await p.waitForSelector('#rail-list .rail-item .rail-act', { state: 'visible', timeout: 8000 });

  const lignes = await p.$$eval('#rail-list .rail-item', (n) => n.length);
  check('les autres joueurs ont une ligne avec des actions', lignes >= 1, `${lignes} ligne(s)`);

  const surMoi = await p.$$eval('#rail-list .rail-row.me', (n) => n.length);
  const moiAvecActions = await p.$$eval('#rail-list .rail-item .rail-row.me', (n) => n.length);
  check('on ne peut pas se défier soi-même', surMoi >= 1 && moiAvecActions === 0,
    `${surMoi} ligne « moi », dont ${moiAvecActions} avec des boutons`);

  const boutons = await p.$$eval('#rail-list .rail-act', (n) => n.map((x) => x.textContent));
  check('le défi et le face-à-face sont proposés',
    boutons.includes('⚔️') && boutons.includes('⚖️'), boutons.join(' '));

  /* ── LA FENÊTRE DE DÉFI ── */
  section('La fenêtre de défi');
  await p.click('#rail-list .rail-item .rail-act');
  await wait(500);
  const titre = await p.$eval('#modal h2', (n) => n.textContent).catch(() => '');
  check('elle s’ouvre sur le bon nom', /Défier/.test(titre) && titre.includes('Voisin'), titre);

  const jeux = await p.$$eval('.defi-jeu', (n) => n.map((x) => x.textContent));
  check('elle propose des jeux jouables à deux', jeux.length >= 2, jeux.join(', '));
  check('et pas la belote', !jeux.includes('Belote'));

  const mise = await p.$eval('.defi-mise input', (n) => n.value);
  check('la mise part de zéro : un défi pour l’honneur est le défaut', mise === '0', mise);

  await p.click('.lb-pop-foot .btn-primary');
  await wait(800);
  check('le défi arrive vraiment chez l’autre',
    ami.defis && ami.defis.inbox.length === 1,
    ami.defis ? `${ami.defis.inbox.length} reçu(s)` : 'aucun état');

  /* ── LE FACE-À-FACE ── */
  section('La fenêtre de face-à-face');
  await p.evaluate(() => window.PZ.closeModal());
  await wait(200);
  const actes = await p.$$('#rail-list .rail-item .rail-act');
  await actes[1].click();
  await p.waitForSelector('.ff-score', { timeout: 6000 });
  const score = await p.$eval('.ff-score', (n) => n.textContent);
  check('le score s’affiche', /\d+ — \d+/.test(score), score);
  const resume = await p.$eval('.ff-resume', (n) => n.textContent);
  check('la phrase de résumé est là', resume.length > 10, resume);
  const lignesTab = await p.$$eval('.ff-table .ff-line', (n) => n.length);
  check('les chiffres se comparent ligne à ligne', lignesTab >= 5, `${lignesTab} lignes`);
  await p.evaluate(() => window.PZ.closeModal());

  /* ── LE BANDEAU DU MOIS ── */
  section('Le bandeau du mois');
  const bandeau = await p.$('#mois-bar');
  if (bandeau) {
    const place = await p.evaluate(() => {
      const bar = document.getElementById('mois-bar');
      const main = document.getElementById('main');
      return bar.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING ? 'avant' : 'après';
    });
    check('il se pose au-dessus du contenu', place === 'avant', place);
    const texte = await p.$eval('#mois-bar', (n) => n.textContent);
    check('il dit quelque chose d’utile', /Cible|ligne droite/.test(texte), texte.slice(0, 80));
  } else {
    // Pas de cible désignée sur une base fraîche : c'est le comportement
    // voulu, un bandeau vide ne s'affiche pas.
    check('pas de cible désignée : pas de bandeau vide', true, 'rien à annoncer');
  }

  /* ── LES PARIS DEPUIS LE HALL ── */
  section('Le bouton parier dans le hall');
  /*
   * C'est le COPAIN qui ouvre le salon, pas le navigateur : s'il l'ouvrait
   * lui-même, il serait envoyé dans la vue du jeu et le hall — donc le
   * bouton qu'on veut voir — ne serait plus affiché du tout.
   */
  ami.socket.emit('party:create', { game: 'uno' });
  await wait(800);
  await p.evaluate(() => window.PZ.go('party'));
  await p.waitForSelector('.proom-bet', { state: 'visible', timeout: 8000 }).catch(() => {});
  const bet = await p.$('.proom-bet');
  check('un salon en attente peut recevoir des paris', Boolean(bet));
  if (bet) {
    await bet.click();
    await wait(500);
    const t = await p.$eval('#modal h2', (n) => n.textContent).catch(() => '');
    check('la fenêtre de pari s’ouvre', /Parier/.test(t), t);
    const avert = await p.$eval('.pari .fine', (n) => n.textContent).catch(() => '');
    // On ne joue pas cette partie : c'est donc la règle du partage qui
    // s'affiche. (La phrase « tu ne peux miser que sur toi » est réservée à
    // ceux qui sont à la table — le serveur l'applique de toute façon, et
    // `paris-sim.js` le vérifie.)
    check('elle explique comment le pot se partage',
      /prorata|ne prend rien/.test(avert), avert.slice(0, 70));

    const chevaux = await p.$$eval('.pari-qui', (n) => n.map((x) => x.textContent.trim()));
    check('on peut miser sur qui est à la table', chevaux.length >= 1, chevaux.join(', '));
    await p.evaluate(() => window.PZ.closeModal());
  }

  /* ── AUCUNE ERREUR ── */
  section('La console');
  check('aucune erreur JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  ami.socket.close();
  await b.close();
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('\nLe banc d’essai a échoué :', err.message);
  if (errs.length) console.error(errs.slice(0, 5).join('\n'));
  process.exit(1);
});
