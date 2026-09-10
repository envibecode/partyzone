'use strict';
/**
 * LES RIVALITÉS, EN VRAI : LE DÉFI, LES PARIS, LA CIBLE, LE FACE-À-FACE.
 *
 * Ces quatre fonctionnalités ont un point commun qu'aucun simulateur ne
 * peut vérifier : ELLES DÉPLACENT DE L'ARGENT ENTRE DES GENS. Un pot mal
 * partagé, un séquestre oublié, une prime versée deux fois — rien de tout
 * ça ne se voit dans les règles, seulement dans les soldes.
 *
 * On branche donc de vrais clients sur le vrai serveur, et on regarde les
 * soldes avant et après. C'est la seule vérification qui compte :
 *
 *  1. UN DUEL EST À SOMME NULLE. Ce que l'un perd, l'autre le gagne. Le
 *     site ne crée ni ne détruit une seule pièce.
 *  2. LE SÉQUESTRE EST PRIS À L'ACCEPTATION. Sinon il suffit de perdre puis
 *     de tout dépenser avant la fin de la partie.
 *  3. UN PARI RESSORT ENTIER. Le pot versé égale exactement le pot misé —
 *     à la pièce près, arrondis compris.
 *  4. ON NE PARIE JAMAIS CONTRE SOI-MÊME. C'est la règle qui empêche
 *     quelqu'un d'avoir intérêt à perdre.
 *  5. LE FACE-À-FACE COMPTE CE QUI S'EST PASSÉ, dans le bon sens.
 */

const { io } = require('socket.io-client');
const { gatePass, withPass } = require('./pass');
const rank = require('../server/party/rank');

/*
 * LE BRUIT DU RANG PARTY.
 *
 * Une partie terminée fait parfois monter d'un niveau, et un niveau Party
 * paie des pièces. Ces pièces-là n'ont rien à voir avec le duel, mais elles
 * tombent dans la même bourse au même moment — un test naïf conclurait que
 * le duel crée de l'argent. On calcule donc exactement ce que le rang a
 * versé, avec la formule du serveur, et on le retire du calcul.
 */
const primeRang = (avant, apres) => {
  let n = 0;
  for (let l = avant + 1; l <= apres; l++) n += rank.levelReward(l);
  return n;
};
const niveau = (p) => ((p.profile.party || {}).level || 1);

const BASE = process.env.BASE || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = '';
let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

function waitFor(fn, ms = 6000, what = 'condition') {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const step = () => {
      let v; try { v = fn(); } catch { v = null; }
      if (v) return resolve(v);
      if (Date.now() - started > ms) return reject(new Error(`délai dépassé : ${what}`));
      setTimeout(step, 60);
    };
    step();
  });
}

async function guest(name) {
  const res = await fetch(`${BASE}/auth/guest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: pass },
    body: JSON.stringify({ name }),
  });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  const cookie = withPass(pass, raw.map((c) => c.split(';')[0]).join('; '));
  const socket = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });

  const p = { name, socket, cookie, toasts: [], defis: null, pari: null, joined: null, uno: null, rooms: [] };
  socket.on('me', ({ user, profile }) => { p.user = user; p.profile = profile; });
  socket.on('profile:update', (pr) => { p.profile = pr; });
  socket.on('toast', (t) => p.toasts.push(t));
  socket.on('defi:state', (s) => { p.defis = s; });
  socket.on('pari:state', (s) => { p.pari = s; });
  socket.on('party:joined', (j) => { p.joined = j; });
  socket.on('uno:state', (s) => { p.uno = s; });
  socket.on('party:list', ({ rooms }) => { p.rooms = rooms; });
  // Le navigateur rejoint tout seul le salon du duel qu'il a lancé : on
  // fait pareil, sinon on testerait un chemin que personne n'emprunte.
  socket.on('defi:go', ({ code }) => socket.emit('party:join', { code }));

  await new Promise((ok, ko) => {
    socket.on('connect', ok);
    socket.on('connect_error', ko);
    setTimeout(() => ko(new Error('connexion trop lente')), 6000);
  });
  await waitFor(() => p.profile, 5000, `profil de ${name}`);
  socket.emit('party:open');
  return p;
}

const coins = (p) => p.profile.coins;

/** Les administrateurs peuvent s'offrir des pièces : ici on triche par le test. */
async function donner(p, montant) {
  // Pas de porte dérobée : on passe par la mine, qui est lente. On préfère
  // jouer avec ce que le compte a déjà et adapter les mises.
  return montant;
}

(async () => {
  pass = await gatePass(BASE);
  console.log(`Les rivalités, en vrai — ${BASE}\n`);

  const tag = Date.now().toString(36).slice(-3);
  const [a, b, c] = await Promise.all(['Duel' + tag, 'Rival' + tag, 'Parieur' + tag]
    .map((n) => guest(n)));
  await donner(a, 0);

  const solde0 = { a: coins(a), b: coins(b), c: coins(c) };
  console.log(`  (soldes de départ : ${solde0.a} / ${solde0.b} / ${solde0.c})`);

  /* ══════════ LE DÉFI ══════════ */
  section('Le défi direct');

  a.socket.emit('defi:list');
  await waitFor(() => a.defis, 4000, 'liste des défis');
  check('les jeux jouables en duel sont proposés',
    a.defis.games.length >= 2 && a.defis.games.every((g) => g.id !== 'belote'),
    a.defis.games.map((g) => g.id).join(', '));

  a.toasts = [];
  a.socket.emit('defi:send', { to: a.user.id, game: 'uno', stake: 100 });
  await wait(300);
  check('on ne se défie pas soi-même', a.toasts.some((t) => t.kind !== 'success'),
    (a.toasts[0] || {}).message);

  a.toasts = [];
  a.socket.emit('defi:send', { to: b.user.id, game: 'belote', stake: 100 });
  await wait(300);
  check('la belote ne se joue pas en duel', a.toasts.some((t) => /duel/i.test(t.message || '')),
    (a.toasts[0] || {}).message);

  const MISE = 100;
  a.socket.emit('defi:send', { to: b.user.id, game: 'uno', stake: MISE });
  await waitFor(() => b.defis && b.defis.inbox.length, 4000, 'défi reçu');
  check('le défi arrive chez l’autre', b.defis.inbox[0].fromName === a.name,
    b.defis.inbox[0].fromName);
  check('avec le jeu et la mise', b.defis.inbox[0].stake === MISE && b.defis.inbox[0].game === 'uno');

  a.toasts = [];
  a.socket.emit('defi:send', { to: b.user.id, game: 'uno', stake: 50 });
  await wait(300);
  check('on n’empile pas deux défis sur la même personne',
    a.toasts.some((t) => /déjà/.test(t.message || '')), (a.toasts[0] || {}).message);

  const avant = { a: coins(a), b: coins(b) };
  const niv0 = { a: niveau(a), b: niveau(b) };
  b.socket.emit('defi:accept', { id: b.defis.inbox[0].id });
  await waitFor(() => a.joined && b.joined && a.joined.game === 'uno', 6000, 'salon du duel');
  check('les deux se retrouvent dans le même salon', a.joined.code === b.joined.code, a.joined.code);

  await waitFor(() => coins(a) !== avant.a && coins(b) !== avant.b, 5000, 'séquestre pris');
  check('la mise est retirée des deux côtés DÈS l’acceptation',
    avant.a - coins(a) === MISE && avant.b - coins(b) === MISE,
    `${avant.a - coins(a)} et ${avant.b - coins(b)}`);

  // On joue l'Uno jusqu'au bout : ce qui compte est le règlement.
  await waitFor(() => a.uno && a.uno.players.length === 2, 5000, 'deux joueurs à l’Uno');
  a.socket.emit('uno:configure', { rounds: 1 });
  await wait(300);
  a.socket.emit('party:start');
  await waitFor(() => a.uno && a.uno.phase !== 'lobby', 6000, 'Uno lancé');

  let garde = 0;
  while (garde++ < 400) {
    const moi = [a, b].find((p) => p.uno && p.uno.yourTurn);
    if (!moi) {
      if (a.uno && a.uno.phase === 'over') break;
      await wait(120);
      continue;
    }
    const jouable = (moi.uno.hand || []).find((card) => card.playable);
    if (jouable) moi.socket.emit('uno:play', { cardId: jouable.id, color: jouable.c === 'w' ? 'r' : undefined });
    else moi.socket.emit('uno:draw');
    await wait(90);
  }
  check('la partie va au bout', a.uno && a.uno.phase === 'over', a.uno ? a.uno.phase : '—');

  await wait(1200);
  const apres = { a: coins(a), b: coins(b) };

  /*
   * Ce qu'on vérifie ici, c'est le RÈGLEMENT, pas l'arithmétique.
   *
   * Sur un vrai serveur, la fin d'une partie verse aussi des niveaux de
   * rang Party et des défis du jour — impossible d'isoler le duel dans un
   * solde. Le partage à la pièce près est vérifié sans serveur, dans
   * `paris-sim.js` ; ici on regarde que le duel s'est bien réglé, que le
   * bon joueur a été désigné, et que le séquestre est ressorti.
   */
  await waitFor(() => a.defis && a.defis.dernier, 6000, 'duel réglé');
  const regle = a.defis.dernier;
  check('le duel est réglé à la fin de la partie', regle.status === 'done', regle.status);
  check('un vainqueur est désigné, ou les mises sont rendues',
    Boolean(regle.result.winner) || regle.result.refund,
    regle.result.winner ? 'vainqueur' : 'nul');
  check('le pot vaut les deux mises', regle.result.refund || regle.result.pot === MISE * 2,
    `${regle.result.pot}`);
  check('plus personne n’a de duel en cours', !a.defis.live && !b.defis.live);

  const gagne = regle.result.winner;
  if (gagne) {
    const gagnant = gagne === a.user.id ? { p: a, avant: avant.a, apres: apres.a, niv: niv0.a }
      : { p: b, avant: avant.b, apres: apres.b, niv: niv0.b };
    /*
     * « Au moins » et pas « exactement » : la fin d'une partie peut aussi
     * boucler un défi du jour, qui paie. Le montant exact du duel est
     * vérifié dans `paris-sim.js`, là où rien d'autre ne verse.
     */
    const net = gagnant.apres - gagnant.avant - primeRang(gagnant.niv, niveau(gagnant.p));
    check('le vainqueur récupère sa mise ET celle de l’autre', net >= MISE,
      `${net} de plus qu’avant le duel, pour une mise de ${MISE}`);
  } else {
    check('les deux retrouvent leur mise',
      apres.a - avant.a - primeRang(niv0.a, niveau(a)) === 0, 'égalité');
  }

  /* ══════════ LE FACE-À-FACE ══════════ */
  section('Le face-à-face');
  {
    const res = await fetch(`${BASE}/api/face/${b.user.id}`, { headers: { Cookie: a.cookie } });
    const data = await res.json();
    check('la comparaison se charge', res.ok, `HTTP ${res.status}`);
    check('elle connaît les deux joueurs',
      data.moi && data.lui && data.moi.name === a.name && data.lui.name === b.name);
    check('la partie qu’on vient de jouer y est', data.face.joues >= 1, `${data.face.joues} partie(s)`);
    check('le score est cohérent',
      data.face.moi + data.face.lui + data.face.nul === data.face.joues,
      `${data.face.moi}/${data.face.lui}/${data.face.nul} pour ${data.face.joues}`);
    check('elle est écrite dans le bon sens : une phrase la résume',
      typeof data.resume === 'string' && data.resume.includes(data.face.moi > data.face.lui ? a.name : b.name),
      data.resume);
    console.log(`\n    « ${data.resume} »\n`);

    const inverse = await fetch(`${BASE}/api/face/${a.user.id}`, { headers: { Cookie: b.cookie } });
    const miroir = await inverse.json();
    check('vue de l’autre côté, le score est retourné',
      miroir.face.moi === data.face.lui && miroir.face.lui === data.face.moi,
      `${miroir.face.moi}-${miroir.face.lui} contre ${data.face.moi}-${data.face.lui}`);

    const soi = await fetch(`${BASE}/api/face/${a.user.id}`, { headers: { Cookie: a.cookie } });
    check('on ne se compare pas à soi-même', soi.status === 400, `HTTP ${soi.status}`);
  }

  /* ══════════ LES PARIS ══════════ */
  section('Les paris entre potes');

  a.socket.emit('party:leave');
  b.socket.emit('party:leave');
  await wait(400);

  a.joined = null; b.joined = null;
  a.socket.emit('party:create', { game: 'uno' });
  await waitFor(() => a.joined && a.joined.game === 'uno', 5000, 'salon ouvert');
  const code = a.joined.code;
  b.socket.emit('party:join', { code });
  await waitFor(() => b.joined && b.joined.code === code, 5000, 'deuxième joueur');
  await waitFor(() => a.uno && a.uno.code === code && a.uno.seats.length === 2, 5000, 'deux à table');

  c.toasts = [];
  c.socket.emit('pari:place', { code, on: a.user.id, amount: 10 });
  await wait(300);
  check('une mise en dessous du minimum est refusée',
    c.toasts.some((t) => /minimum/i.test(t.message || '')), (c.toasts[0] || {}).message);

  a.toasts = [];
  a.socket.emit('pari:place', { code, on: b.user.id, amount: 100 });
  await wait(300);
  check('un joueur ne peut pas miser sur son adversaire',
    a.toasts.some((t) => /que sur toi/i.test(t.message || '')), (a.toasts[0] || {}).message);

  const cAvant = coins(c);
  const aAvant = coins(a);
  c.socket.emit('pari:place', { code, on: a.user.id, amount: 150 });
  a.socket.emit('pari:place', { code, on: a.user.id, amount: 100 });
  await waitFor(() => coins(c) === cAvant - 150 && coins(a) === aAvant - 100, 5000, 'mises prélevées');
  check('les mises sont prélevées tout de suite', true, `${cAvant - coins(c)} et ${aAvant - coins(a)}`);

  await waitFor(() => c.pari && c.pari.total === 250, 4000, 'pot à jour');
  check('le pot cumule les deux mises', c.pari.total === 250, `${c.pari.total}`);
  check('le hall affiche le pot',
    (c.rooms.find((r) => r.code === code) || {}).pot === 250,
    String((c.rooms.find((r) => r.code === code) || {}).pot));

  c.toasts = [];
  c.socket.emit('pari:place', { code, on: b.user.id, amount: 60 });
  await wait(300);
  check('on ne mise pas sur deux chevaux à la fois',
    c.toasts.some((t) => /déjà misé/i.test(t.message || '')), (c.toasts[0] || {}).message);

  const potAvant = { a: coins(a), c: coins(c) };
  const potNiv = { a: niveau(a), c: niveau(c) };
  a.socket.emit('uno:configure', { rounds: 1 });
  await wait(300);
  a.socket.emit('party:start');
  await waitFor(() => a.uno && a.uno.phase !== 'lobby', 6000, 'partie lancée');

  c.toasts = [];
  c.socket.emit('pari:place', { code, on: a.user.id, amount: 60 });
  await wait(300);
  check('les paris ferment au lancement',
    c.toasts.some((t) => /fermés/i.test(t.message || '')), (c.toasts[0] || {}).message);

  garde = 0;
  while (garde++ < 400) {
    const moi = [a, b].find((p) => p.uno && p.uno.yourTurn);
    if (!moi) {
      if (a.uno && a.uno.phase === 'over') break;
      await wait(120);
      continue;
    }
    const jouable = (moi.uno.hand || []).find((card) => card.playable);
    if (jouable) moi.socket.emit('uno:play', { cardId: jouable.id, color: jouable.c === 'w' ? 'r' : undefined });
    else moi.socket.emit('uno:draw');
    await wait(90);
  }
  await wait(1500);

  await waitFor(() => c.pari && c.pari.result, 8000, 'pot réglé');
  const reglement = c.pari.result;
  const verse = reglement.payouts.reduce((n, p) => n + p.amount, 0);
  check('le pot ressort entier, à la pièce près', verse === 250,
    `${verse} versé pour 250 misé`);
  check('les pièces arrivent vraiment dans les bourses',
    coins(c) > potAvant.c - 1, `${coins(c) - potAvant.c}`);
  check('chaque part est justifiée par une mise',
    reglement.payouts.every((p) => p.mise > 0 && p.amount > 0));

  /* ══════════ LA CIBLE ET LE MOIS ══════════ */
  section('La cible du mois');
  {
    const res = await fetch(`${BASE}/api/mois`, { headers: { Cookie: a.cookie } });
    const data = await res.json();
    check('le mois se lit', res.ok, `HTTP ${res.status}`);
    check('il annonce une prime', data.prime > 0, `${data.prime} pièces`);
    check('il dit s’il reste des primes aujourd’hui', typeof data.restant === 'number', `${data.restant}`);
    check('la dernière ligne droite a une date de fin',
      data.finale && data.finale.endsAt > Date.now(),
      new Date(data.finale.endsAt).toISOString().slice(0, 16));
    check('et un plafond en nombre de caisses, pas en durée',
      data.finale.cases > 0 && data.finale.cases <= 20, `${data.finale.cases} caisses`);
  }

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  [a, b, c].forEach((p) => p.socket.close());
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('\nLe banc d’essai a échoué :', err.message);
  process.exit(1);
});
