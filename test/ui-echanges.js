'use strict';
/**
 * LES ÉCHANGES, DANS LE NAVIGATEUR.
 *
 * Trois panneaux de plus sur la page du Marché, et un bandeau sur celle des
 * caisses. Ce qu'on vérifie ici, aucun banc d'essai serveur ne peut le
 * voir : que les panneaux apparaissent, que les fenêtres se remplissent
 * avec de vraies données, et qu'une cagnotte ouverte à l'écran arrive
 * vraiment au serveur.
 *
 * On vérifie aussi la chose la plus bête et la plus fréquente : que rien
 * ne jette une erreur JavaScript. Un module qui plante au chargement fait
 * disparaître tous ceux qui le suivent dans la page.
 */

const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const { gatePass, withPass, browserPass } = require('./pass');

const BASE = process.env.BASE || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const errs = [];
let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

/** Un copain en ligne, sans navigateur. */
async function copain(pass, name) {
  const res = await fetch(`${BASE}/auth/guest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: pass },
    body: JSON.stringify({ name }),
  });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  const cookie = withPass(pass, raw.map((c) => c.split(';')[0]).join('; '));
  const socket = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
  const p = { name, socket, cookie, trocs: null, cagnottes: null, profile: null };
  socket.on('me', ({ user, profile }) => { p.user = user; p.profile = profile; });
  socket.on('troc:state', (s) => { p.trocs = s; });
  socket.on('cagnotte:list', (s) => { p.cagnottes = s; });
  await new Promise((ok, ko) => {
    socket.on('connect', ok);
    setTimeout(() => ko(new Error('connexion trop lente')), 6000);
  });
  await wait(500);
  return p;
}

(async () => {
  const pass = await gatePass(BASE);
  const tag = Date.now().toString(36).slice(-3);
  const ami = await copain(pass, 'Troqueur' + tag);

  const b = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, locale: 'fr-FR' });
  const p = await ctx.newPage();
  await browserPass(ctx);
  p.on('pageerror', (e) => errs.push('ERR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('CON ' + m.text()); });

  await p.goto(BASE, { waitUntil: 'networkidle' });
  const intro = await p.$('#intro-skip');
  if (intro) { await intro.click(); await wait(900); }
  await p.fill('#guest-name', 'Marchand' + tag);
  await p.click('#form-guest button');
  await p.waitForSelector('#app.active');
  await p.waitForFunction(() => window.PZ && window.PZ.profile);
  await wait(1500);

  console.log(`Les échanges dans le navigateur — ${BASE}\n`);

  /* ── LA PAGE DU MARCHÉ ── */
  section('Les trois panneaux du marché');
  await p.evaluate(() => window.PZ.go('market'));
  await wait(1500);

  check('le panneau des enchères est là', Boolean(await p.$('#enchere-panel')));
  check('celui des cagnottes aussi', Boolean(await p.$('#cagnotte-panel')));
  check('et celui des trocs', Boolean(await p.$('#troc-panel')));

  /* ── L'ENCHÈRE ── */
  section('L’enchère de la semaine');
  await p.waitForSelector('.ench-lot', { timeout: 6000 });
  const lot = await p.$eval('.ench-lot', (n) => n.textContent);
  check('un lot est annoncé', lot.trim().length > 3, lot.replace(/\s+/g, ' ').trim());
  const quand = await p.$eval('#enchere-when', (n) => n.textContent);
  check('et on sait quand ça se passe', quand !== '—', quand);
  const texte = await p.$eval('#enchere-body', (n) => n.textContent);
  check('la destruction des pièces est annoncée, ou l’enchère est en cours',
    /détruites/.test(texte) || Boolean(await p.$('.ench-bid')), texte.slice(0, 60));

  /* ── LA CAGNOTTE ── */
  section('Ouvrir une cagnotte');
  /*
   * Trois cagnottes ouvertes au maximum, et elles vivent quinze jours : au
   * quatrième passage du banc d'essai, le site refuse — à raison. On regarde
   * donc d'abord s'il reste de la place, et on se rabat sur une cagnotte
   * existante pour la suite. Un test qui échoue parce qu'il a trop bien
   * marché les fois d'avant ne prouve rien.
   */
  const placeLibre = await p.$$eval('#cagnotte-body .cag:not(.done)', (n) => n.length);

  await p.click('#cagnotte-new');
  await wait(500);
  const titreFen = await p.$eval('#modal h2', (n) => n.textContent).catch(() => '');
  check('la fenêtre s’ouvre', /cagnotte/i.test(titreFen), titreFen);

  const choix = await p.$$eval('.defi-jeu', (n) => n.map((x) => x.textContent));
  check('les deux formes sont proposées',
    choix.some((c) => /quelqu/.test(c)) && choix.some((c) => /mois/.test(c)), choix.join(' / '));

  // On la fait « pour le vainqueur du mois » : pas besoin de choisir un nom.
  const boutons = await p.$$('.defi-jeu');
  await boutons[1].click();
  const champs = await p.$$('.defi-mise input');
  await champs[0].fill(`Le pot de ${tag}`);
  await champs[1].fill('5000');
  await p.click('.lb-pop-foot .btn-primary');
  await wait(1400);

  await p.waitForSelector('.cag', { timeout: 6000 });
  const cag = await p.$eval('#cagnotte-body', (n) => n.textContent);
  if (placeLibre < 3) {
    check('la cagnotte ouverte apparaît dans la liste', cag.includes(tag),
      cag.replace(/\s+/g, ' ').slice(0, 60));
  } else {
    check('le site refuse une quatrième cagnotte ouverte', !cag.includes(tag),
      'trois à la fois, sinon plus personne ne suit');
  }
  check('avec sa barre de progression', Boolean(await p.$('.cag-bar i')));

  /*
   * On passe par « Autre montant » : un invité démarre avec 400 pièces, et
   * le premier raccourci en demande 500. Un banc d'essai qui échoue parce
   * que le personnage est fauché ne teste rien du tout.
   */
  const avant = await p.evaluate(() => window.PZ.profile.coins);
  const potAvant = await p.$eval('#cagnotte-body .cag .cag-nums b', (n) => n.textContent);
  await p.click('#cagnotte-body .cag .cag-acts .btn-primary');
  await p.waitForSelector('#modal .defi-mise input', { timeout: 5000 });
  await p.fill('#modal .defi-mise input', '200');
  await p.click('.lb-pop-foot .btn-primary');
  await wait(1500);
  const apres = await p.evaluate(() => window.PZ.profile.coins);
  check('mettre au pot retire les pièces tout de suite', avant - apres === 200,
    `${avant - apres} pièces`);
  const potApres = await p.$eval('#cagnotte-body .cag .cag-nums b', (n) => n.textContent);
  const chiffre = (t) => Number(t.replace(/[^\d]/g, '').slice(0, -4) || t.replace(/[^\d]/g, ''));
  check('et le pot monte', potApres !== potAvant, `${potAvant} → ${potApres}`);
  void chiffre;

  /* ── LE TROC ── */
  section('Proposer un troc');
  await p.evaluate(() => {
    const rail = document.getElementById('rail');
    if (rail && rail.hidden) document.getElementById('btn-rail').click();
  });
  await wait(800);
  const actes = await p.$$('#rail-list .rail-item .rail-act');
  check('le geste « troquer » est dans la liste des connectés', actes.length >= 3,
    `${actes.length} actions par ligne`);

  if (actes.length >= 3) {
    await actes[2].click();
    await p.waitForSelector('.troc-pick', { timeout: 6000 });
    const titres = await p.$$eval('.troc-pick h4', (n) => n.map((x) => x.textContent));
    check('la fenêtre montre les deux côtés', titres.length === 2, titres.join(' / '));
    const explication = await p.$eval('.defi-form .fine', (n) => n.textContent);
    check('elle rappelle la règle des doublons', /doublon/.test(explication),
      explication.slice(0, 60));
    await p.evaluate(() => window.PZ.closeModal());
  }

  /* ── L'OBJET DU JOUR ── */
  section('L’objet du jour');
  await p.evaluate(() => window.PZ.go('vault'));
  await wait(1200);
  const objet = await p.$('#objet-jour');
  check('il s’affiche sur la page des caisses', Boolean(objet));
  if (objet) {
    const t = await p.$eval('#objet-jour', (n) => n.textContent);
    check('avec un nom et une prime', /Objet du jour/.test(t) && /\d/.test(t),
      t.replace(/\s+/g, ' ').slice(0, 70));
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
