'use strict';
/**
 * BANC D'ESSAI DE L'ÉCONOMIE.
 *
 * Le marché, le rakeback, les récompenses du rang Party et les cadeaux de
 * plus de dix caisses. Une question revient à chaque section : COMBIEN DE
 * PIÈCES ONT ÉTÉ CRÉÉES ? Un site où l'on ne peut rien acheter n'a qu'une
 * seule protection contre l'absurde, et c'est celle-là.
 */
const { io } = require('socket.io-client');
const { gatePass, withPass } = require('./pass');

const BASE = process.env.BASE || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Le site a une porte : les bancs d'essai entrent avec la clé, comme nous.
let pass = '';

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

function waitFor(fn, ms = 5000, what = 'condition') {
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

  const p = { name, socket, toasts: [], market: null, rake: null, vault: null, gifts: null, lastVault: null };
  socket.on('me', ({ user, profile }) => { p.user = user; p.profile = profile; });
  socket.on('profile:update', (pr) => { p.profile = pr; });
  socket.on('toast', (t) => p.toasts.push(t));
  socket.on('market:state', (m) => { p.market = m; });
  socket.on('rake:state', (r) => { p.rake = r; });
  socket.on('vault:state', ({ vault, result }) => { p.vault = vault; p.lastVault = result; });
  socket.on('gift:list', (g) => { p.gifts = g; });

  await new Promise((res2, rej) => {
    socket.on('connect', res2);
    socket.on('connect_error', rej);
    setTimeout(() => rej(new Error('connexion trop lente')), 6000);
  });
  await waitFor(() => p.profile, 4000, `profil de ${name}`);
  return p;
}

async function topUp(player, target) {
  if (player.profile.coins >= target) return;
  if (!player.isAdmin) {
    player.socket.emit('admin:claim', { key: process.env.ADMIN_KEY || 'test-admin-key' });
    await waitFor(() => player.profile.admin, 4000, 'droits admin');
    player.isAdmin = true;
  }
  player.socket.emit('admin:action', {
    action: 'grant-coins',
    payload: { id: player.user.id, amount: target - player.profile.coins + 1000 },
  });
  await waitFor(() => player.profile.coins >= target, 4000, 'crédit');
}

(async () => {
  // La porte d'abord : sans laissez-passer, tout renvoie le compte à rebours.
  pass = await gatePass(BASE);

  console.log(`Banc d'essai économie — ${BASE}\n`);
  const tag = Date.now().toString(36).slice(-4);

  section('Connexion');
  const alice = await guest('Alice' + tag);
  const bob = await guest('Bob' + tag);
  check('deux joueurs connectés', Boolean(alice.user && bob.user));
  check('le solde de départ est modeste', alice.profile.coins === 400, `${alice.profile.coins} pièces`);

  /* ── LA MINE, DURCIE ── */
  section('La mine');
  alice.socket.emit('mine:open');
  await wait(400);
  const before = alice.profile.coins;
  for (let i = 0; i < 20; i++) { alice.socket.emit('mine:click', { count: 5 }); await wait(90); }
  await wait(500);
  const mined = alice.profile.coins - before;
  check('une barre pleine rapporte de quoi jouer, pas de quoi s’enrichir',
    mined > 30 && mined < 200, `${mined} pièces pour 100 coups`);

  /* ── RAKEBACK ── */
  section('Rakeback');
  alice.socket.emit('rake:open');
  const rake0 = await waitFor(() => alice.rake, 4000, 'état du rakeback');
  check('le rakeback démarre à zéro', rake0.pending === 0);
  check('un taux est annoncé', rake0.rate > 0 && rake0.rate < 5, `${rake0.rate} %`);

  await topUp(alice, 300000);
  let wagered = 0;
  for (let i = 0; i < 12; i++) {
    alice.socket.emit('plinko:play', { bet: 5000, rows: 16, risk: 'medium', balls: 1 });
    wagered += 5000;
    await wait(160);
  }
  await wait(500);
  alice.socket.emit('rake:open');
  await wait(400);
  const expected = wagered * (rake0.rate / 100);
  check('chaque mise alimente le rakeback', alice.rake.pending > 0,
    `${alice.rake.pending} accumulés sur ${wagered} misés (attendu ≈ ${Math.round(expected)})`);
  check('le montant correspond au taux annoncé',
    Math.abs(alice.rake.pending - expected) < expected * 0.15 + 2);

  const coinsBefore = alice.profile.coins;
  alice.socket.emit('rake:claim');
  await wait(600);
  check('la récolte crédite bien le solde', alice.profile.coins > coinsBefore,
    `+${alice.profile.coins - coinsBefore} pièces`);
  alice.socket.emit('rake:open');
  await wait(300);
  check('le compteur repart à zéro après la récolte', alice.rake.pending < 5);

  alice.toasts = [];
  alice.socket.emit('rake:claim');
  await wait(400);
  check('impossible de récolter deux fois de suite', alice.toasts.some((t) => t.kind === 'warn'));

  /* ── LE MARCHÉ ── */
  section('Le marché');
  await topUp(alice, 200000);
  // On ouvre des caisses jusqu'à avoir des doublons à vendre.
  for (let i = 0; i < 12; i++) {
    alice.socket.emit('vault:pull', { caseId: 'starter', count: 10 });
    await wait(280);
  }
  alice.socket.emit('market:open', {});
  const m0 = await waitFor(() => alice.market, 5000, 'état du marché');
  check('les doublons sont proposés à la vente', m0.owned.length > 0, `${m0.owned.length} objets en double`);
  check('la commission est annoncée', m0.fee > 0, `${m0.fee} %`);

  const item = m0.owned[0];
  alice.toasts = [];
  alice.socket.emit('market:list', { itemId: item.id, price: item.min - 1, count: 1 });
  await wait(400);
  check('un prix sous le plancher est refusé', alice.toasts.some((t) => t.kind === 'error'));

  alice.toasts = [];
  alice.socket.emit('market:list', { itemId: item.id, price: item.max + 1, count: 1 });
  await wait(400);
  check('un prix au-dessus du plafond est refusé', alice.toasts.some((t) => t.kind === 'error'));

  const price = Math.round(item.base * 3);
  alice.socket.emit('market:list', { itemId: item.id, price, count: 1 });
  await waitFor(() => alice.market && alice.market.mine > 0, 4000, 'offre déposée');
  check('l’offre apparaît sur le marché', alice.market.mine === 1);

  const listing = alice.market.listings.find((l) => l.mine && l.itemId === item.id);
  check('l’offre montre son rapport au prix de revente', listing && listing.ratio > 0, `×${listing && listing.ratio}`);

  alice.toasts = [];
  alice.socket.emit('market:buy', { id: listing.id });
  await wait(500);
  check('on ne peut pas acheter sa propre offre', alice.toasts.some((t) => t.kind === 'error'));

  // Bob achète.
  await topUp(bob, 50000);
  bob.socket.emit('market:open', {});
  await waitFor(() => bob.market, 4000, 'marché côté Bob');
  const offer = bob.market.listings.find((l) => l.id === listing.id);
  check('Bob voit l’offre d’Alice', Boolean(offer));

  const aliceBefore = alice.profile.coins;
  const bobBefore = bob.profile.coins;
  bob.socket.emit('market:buy', { id: listing.id });
  await wait(900);

  const paid = bobBefore - bob.profile.coins;
  const received = alice.profile.coins - aliceBefore;
  const burned = paid - received;
  check('l’acheteur paie le prix affiché', paid === price, `${paid} pièces`);
  check('le vendeur touche le prix moins la commission', received === price - Math.ceil(price * m0.fee / 100),
    `${received} reçus sur ${price}`);
  check('la commission est bien DÉTRUITE, pas redistribuée', burned > 0 && burned === Math.ceil(price * m0.fee / 100),
    `${burned} pièces disparues`);
  check('l’objet a changé de main', (bob.vault && bob.vault.items.find((x) => x.id === item.id).count) > 0);

  /* ── CADEAU DE 50 CAISSES ── */
  section('Cadeaux volumineux');
  alice.socket.emit('admin:action', {
    action: 'grant-case',
    payload: { id: bob.user.id, caseId: 'starter', count: 50 },
  });
  await wait(700);
  bob.socket.emit('gift:list');
  const gifts = await waitFor(() => bob.gifts && bob.gifts.gifts.length, 4000, 'cadeau reçu');
  const gift = bob.gifts.gifts[0];
  check('un cadeau de 50 caisses est reçu entier', gift.count === 50, `${gift.count} caisses`);

  bob.lastVault = null;
  bob.socket.emit('gift:claim', { id: gift.id });
  const claimed = await waitFor(() => bob.lastVault, 5000, 'première fournée');
  check('on en ouvre dix d’un coup', claimed.pulls.length === 10, `${claimed.pulls.length} caisses`);

  bob.socket.emit('gift:list');
  await wait(400);
  const left = bob.gifts.gifts[0];
  check('les quarante autres ne sont PAS perdues', left && left.count === 40,
    left ? `${left.count} restantes` : 'cadeau disparu');

  // On vide le reste.
  for (let i = 0; i < 4; i++) {
    const g = bob.gifts.gifts[0];
    if (!g) break;
    bob.socket.emit('gift:claim', { id: g.id });
    await wait(700);
    bob.socket.emit('gift:list');
    await wait(300);
  }
  check('le cadeau finit par se vider entièrement', !bob.gifts.gifts.length,
    `${bob.gifts.gifts.length} bon(s) restant(s)`);

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'Tout est passé.' : `${failures} vérification(s) en échec.`);
  alice.socket.close(); bob.socket.close();
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('\nLe banc d’essai a échoué :', err.message);
  process.exit(1);
});
