'use strict';
/**
 * Banc d'essai côté serveur.
 *
 * On branche de vrais clients Socket.IO et on joue : la mine, le Plinko, la
 * roulette, une table de blackjack à plusieurs, les caisses. On vérifie que
 * l'économie tient debout (aucune pièce créée ni perdue en route) et que les
 * taux de redistribution annoncés sont bien ceux qu'on observe.
 *
 *   node server/index.js     (dans un terminal)
 *   node test/harness.js     (dans un autre)
 */
const { io } = require('socket.io-client');

const BASE = process.env.BASE || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
}
function section(title) {
  console.log('\n▶ ' + title);
}

/* ─── Un joueur ────────────────────────────────────────── */

async function makeGuest(name) {
  const res = await fetch(`${BASE}/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  const cookie = raw.map((c) => c.split(';')[0]).join('; ');
  const socket = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });

  const p = {
    name, socket, cookie,
    profile: null, user: null,
    mine: null, plinko: null, roulette: null, table: null, vault: null,
    lastPlinko: null, lastVault: null, toasts: [],
  };

  socket.on('me', ({ user, profile }) => { p.user = user; p.profile = profile; });
  socket.on('profile:update', (profile) => { p.profile = profile; });
  socket.on('toast', (t) => p.toasts.push(t));
  socket.on('mine:state', ({ mine }) => { p.mine = mine; });
  socket.on('plinko:state', ({ config }) => { p.plinko = config; });
  socket.on('plinko:result', (r) => { p.lastPlinko = r; });
  socket.on('roulette:state', (s) => { p.roulette = s; });
  socket.on('bj:state', (s) => { p.table = s; });
  socket.on('vault:state', ({ vault, result }) => { p.vault = vault; p.lastVault = result; });

  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('connexion trop lente')), 6000);
  });
  await waitFor(() => p.profile, 4000, `profil de ${name}`);
  return p;
}

function waitFor(fn, ms = 5000, what = 'condition') {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const step = () => {
      let value;
      try { value = fn(); } catch { value = null; }
      if (value) return resolve(value);
      if (Date.now() - started > ms) return reject(new Error(`délai dépassé : ${what}`));
      setTimeout(step, 60);
    };
    step();
  });
}

/** Fait tourner la mine jusqu'à atteindre le solde voulu. */
async function farm(player, target) {
  player.socket.emit('mine:open');
  await waitFor(() => player.mine, 4000, 'état de la mine');
  let guard = 0;
  while (player.profile.coins < target && guard++ < 400) {
    player.socket.emit('mine:click', { count: 20 });
    await wait(30);
  }
  return player.profile.coins;
}

/* ══════════════════════════════════════════════════════ */

(async () => {
  console.log(`Banc d'essai PartyZone — ${BASE}\n`);

  /* ── Connexion ── */
  section('Connexion');
  const alice = await makeGuest('Alice');
  const bob = await makeGuest('Bob');
  check('deux invités connectés', Boolean(alice.user && bob.user));
  check('profil neuf crédité', alice.profile.coins > 0, `${alice.profile.coins} pièces`);
  check('graine serveur publiée sans être révélée',
    alice.profile.fair.serverSeedHash.length === 64 && !alice.profile.fair.serverSeed);

  /* ── La mine ── */
  section('La Mine');
  const before = alice.profile.coins;
  alice.socket.emit('mine:open');
  await waitFor(() => alice.mine, 4000, 'état de la mine');
  check('cinq améliorations proposées', alice.mine.upgrades.length === 5);

  for (let i = 0; i < 10; i++) { alice.socket.emit('mine:click', { count: 20 }); await wait(40); }
  await wait(400);
  check('les clics rapportent', alice.profile.coins > before, `+${alice.profile.coins - before} pièces`);

  // Le plafond : on envoie 200 clics d'un coup, le serveur doit en jeter.
  const capBefore = alice.mine.clicks;
  alice.socket.emit('mine:click', { count: 200 });
  await wait(300);
  alice.socket.emit('mine:open');
  await wait(300);
  check('cadence plafonnée par le serveur', alice.mine.clicks - capBefore <= 40,
    `${alice.mine.clicks - capBefore} clics retenus sur 200 demandés`);

  await farm(alice, 3000);
  const coinsForUpgrade = alice.profile.coins;
  alice.socket.emit('mine:buy', { id: 'pick' });
  await wait(400);
  check('amélioration achetée et facturée', alice.profile.coins < coinsForUpgrade && alice.mine.upgrades[0].level === 1);
  check('le clic rapporte plus après achat', alice.mine.perClick > 1, `${alice.mine.perClick} par clic`);

  /* ── Plinko ── */
  section('Plinko');
  alice.socket.emit('plinko:open');
  await waitFor(() => alice.plinko, 4000, 'config Plinko');

  for (const rows of [8, 12, 16]) {
    for (const risk of ['low', 'medium', 'high']) {
      const t = alice.plinko.tables[rows][risk];
      check(`table ${rows}×${risk} : ${t.multipliers.length} cases, RTP ${t.rtp} %`,
        t.multipliers.length === rows + 1 && t.rtp > 95 && t.rtp < 99);
    }
  }

  await farm(alice, 60000);
  const pkStart = alice.profile.coins;
  let staked = 0;
  let returned = 0;

  for (let i = 0; i < 60; i++) {
    alice.lastPlinko = null;
    alice.socket.emit('plinko:play', { bet: 10, rows: 16, risk: 'medium', balls: 10 });
    const r = await waitFor(() => alice.lastPlinko, 4000, 'résultat Plinko');
    staked += r.staked;
    returned += r.payout;
    // Chaque bille doit finir dans la case correspondant à son chemin.
    const coherent = r.drops.every((d) => d.path.reduce((a, x) => a + x, 0) === d.bucket);
    if (!coherent) { check('chemin cohérent avec la case', false); break; }
  }
  check('chemin de chaque bille cohérent avec sa case', true, `${staked / 10} billes`);
  const pkRtp = (returned / staked) * 100;
  check('RTP Plinko observé proche de l’annoncé', Math.abs(pkRtp - 96.85) < 12,
    `${pkRtp.toFixed(1)} % observé pour 96,85 % annoncé (600 billes, ça bouge)`);
  check('solde cohérent avec les gains', alice.profile.coins === pkStart - staked + returned,
    `${alice.profile.coins} = ${pkStart} − ${staked} + ${returned}`);

  /* ── Roulette ── */
  section('Roulette');
  alice.socket.emit('roulette:join');
  const rl = await waitFor(() => alice.roulette, 4000, 'état roulette');
  check('roue européenne à 37 cases', rl.wheel.length === 37);
  check('RTP annoncé 97,3 %', rl.rtp === 97.3);
  check('empreinte du tour publiée', rl.serverSeedHash.length === 64);

  // On attend une phase de mises, on mise, on regarde le règlement.
  await waitFor(() => alice.roulette.phase === 'betting', 40000, 'phase de mises');
  const rlBefore = alice.profile.coins;
  alice.socket.emit('roulette:bet', { type: 'red', value: null, amount: 100 });
  await wait(500);
  check('mise débitée immédiatement', alice.profile.coins === rlBefore - 100);
  check('mise visible dans l’état partagé', alice.roulette.you && alice.roulette.you.staked === 100);

  await waitFor(() => alice.roulette.phase === 'result', 45000, 'résultat du tour');
  const res = alice.roulette;
  check('numéro dans les clous', res.result.number >= 0 && res.result.number <= 36, `sorti : ${res.result.number} (${res.result.color})`);
  check('graine du tour révélée après coup', Boolean(res.reveal && res.reveal.serverSeed));

  const shouldWin = res.result.color === 'red';
  const detail = res.you.detail[0];
  check('gain conforme à la couleur sortie', detail.won === shouldWin,
    shouldWin ? 'rouge : gagné' : `${res.result.color} : perdu`);

  // Refus des mises hors phase.
  await waitFor(() => alice.roulette.phase !== 'betting', 20000, 'fermeture des mises');
  alice.toasts = [];
  alice.socket.emit('roulette:bet', { type: 'black', value: null, amount: 100 });
  await wait(400);
  check('mise refusée quand la roue tourne', alice.toasts.some((t) => t.kind === 'error'));

  /* ── Blackjack ── */
  section('Blackjack');
  await farm(bob, 5000);
  alice.socket.emit('bj:create');
  const table = await waitFor(() => alice.table, 5000, 'création de table');
  check('table créée avec un code à 4 lettres', /^[A-Z]{4}$/.test(table.code), table.code);
  check('sabot mélangé depuis une graine publiée', table.shoeSeedHash.length === 64);

  bob.socket.emit('bj:join', { code: table.code });
  await waitFor(() => bob.table && bob.table.code === table.code, 5000, 'Bob à table');
  check('deuxième joueur assis', alice.table.seats.length === 2);

  alice.socket.emit('bj:bot', { action: 'add' });
  await wait(400);
  check('bot ajouté par l’hôte', alice.table.seats.some((s) => s.isBot));

  bob.toasts = [];
  bob.socket.emit('bj:bot', { action: 'add' });
  await wait(400);
  check('seul l’hôte gère les bots', bob.toasts.some((t) => t.kind === 'error'));

  // Une table neuve reste en attente jusqu'à la première mise : c'est elle
  // qui lance le compte à rebours, pas l'inverse.
  check('table en attente tant que personne n’a misé', alice.table.phase === 'waiting');
  const bjBefore = alice.profile.coins;
  alice.socket.emit('bj:bet', { amount: 200 });
  bob.socket.emit('bj:bet', { amount: 100 });
  await wait(600);
  check('mise débitée à la table', alice.profile.coins === bjBefore - 200);
  check('la première mise ouvre le tour', alice.table.phase === 'betting');

  await waitFor(() => alice.table.phase === 'playing' || alice.table.phase === 'payout', 40000, 'distribution');
  const mySeat = alice.table.seats.find((s) => s.isYou);
  check('deux cartes reçues', mySeat.hands[0].cards.length === 2);
  check('carte du croupier cachée pendant le jeu',
    alice.table.phase !== 'playing' || alice.table.dealer.cards.some((c) => c.hidden));

  // On joue « rester » dès que c'est notre tour.
  for (const player of [alice, bob]) {
    const start = Date.now();
    while (Date.now() - start < 30000) {
      if (player.table.you.canAct) { player.socket.emit('bj:move', { move: 'stand' }); break; }
      if (player.table.phase === 'payout' || player.table.phase === 'betting') break;
      await wait(300);
    }
  }

  await waitFor(() => alice.table.phase === 'payout', 60000, 'règlement');
  const settled = alice.table.seats.find((s) => s.isYou);
  check('main réglée', Boolean(settled.lastResult), `mise ${settled.lastResult.staked}, retour ${settled.lastResult.payout}`);
  check('croupier découvert au règlement', alice.table.dealer.cards.every((c) => !c.hidden));
  check('valeur du croupier calculée', alice.table.dealer.value && alice.table.dealer.value.total > 0,
    `${alice.table.dealer.value.total}`);

  bob.socket.emit('bj:leave');
  alice.socket.emit('bj:leave');
  await wait(400);

  /* ── Caisses ── */
  section('Caisses à memes');
  await farm(alice, 20000);
  alice.socket.emit('vault:open');
  const vault = await waitFor(() => alice.vault, 4000, 'état du coffre');
  check('soixante memes au catalogue', vault.items.length === 60);
  check('quatre caisses proposées', vault.cases.length === 4);

  // Les probabilités affichées doivent faire 100 %.
  for (const box of vault.cases) {
    const sum = box.odds.reduce((s, o) => s + o.percent, 0);
    check(`probabilités de « ${box.name} » cohérentes`, Math.abs(sum - 100) < 0.5, `${sum.toFixed(2)} %`);
  }

  const vBefore = alice.profile.coins;
  alice.lastVault = null;
  alice.socket.emit('vault:pull', { caseId: 'meme', count: 5 });
  const pull = await waitFor(() => alice.lastVault, 5000, 'ouverture de caisse');
  check('cinq tirages retournés', pull.ok && pull.pulls.length === 5);
  check('chaque tirage a sa bande de 58 vignettes',
    pull.pulls.every((x) => x.reel.strip.length === 58));
  check('l’objet gagné est bien à l’index annoncé',
    pull.pulls.every((x) => x.reel.strip[x.reel.winIndex].id === x.id));
  check('caisse facturée', alice.profile.coins < vBefore);

  // On ouvre en masse pour vérifier que les raretés sortent dans l'ordre attendu.
  const seen = { common: 0, rare: 0, epic: 0, legendary: 0, mythic: 0, cursed: 0 };
  await farm(alice, 80000);
  for (let i = 0; i < 40; i++) {
    alice.lastVault = null;
    alice.socket.emit('vault:pull', { caseId: 'starter', count: 5 });
    const r = await waitFor(() => alice.lastVault, 5000, 'ouverture en masse');
    if (!r.ok) break;
    r.pulls.forEach((x) => { seen[x.r] += 1; });
  }
  const totalPulls = Object.values(seen).reduce((a, b) => a + b, 0);
  check('raretés ordonnées du plus commun au plus rare',
    seen.common >= seen.rare && seen.rare >= seen.epic && seen.epic >= seen.legendary,
    `${totalPulls} tirages : ${Object.entries(seen).map(([k, v]) => `${k} ${v}`).join(', ')}`);

  alice.socket.emit('vault:open');
  await wait(400);
  check('collection remplie au fil des ouvertures', alice.vault.collection.have > 0,
    `${alice.vault.collection.have}/${alice.vault.collection.total}`);

  if (alice.vault.duplicates > 0) {
    const dupBefore = alice.profile.coins;
    alice.socket.emit('vault:sell');
    await wait(500);
    check('doublons revendus contre des pièces', alice.profile.coins > dupBefore,
      `+${alice.profile.coins - dupBefore} pièces`);
  }

  /* ── Équité vérifiable ── */
  section('Équité vérifiable');
  const oldHash = alice.profile.fair.serverSeedHash;
  alice.socket.emit('fair:rotate', { clientSeed: 'ma-graine-de-test' });
  await waitFor(() => alice.profile.fair.serverSeedHash !== oldHash, 4000, 'rotation de graine');
  const prev = alice.profile.fair.previous;
  check('ancienne graine révélée', Boolean(prev && prev.serverSeed));

  const crypto = require('crypto');
  const recomputed = crypto.createHash('sha256').update(prev.serverSeed).digest('hex');
  check('l’empreinte publiée avant correspond à la graine révélée',
    recomputed === oldHash && recomputed === prev.serverSeedHash);
  check('la graine du joueur a bien été prise en compte', prev.clientSeed !== alice.profile.fair.clientSeed
    || alice.profile.fair.clientSeed === 'ma-graine-de-test');

  /* ── Classement ── */
  section('Classement');
  const lb = await (await fetch(`${BASE}/api/leaderboard?sort=coins&limit=10`)).json();
  check('classement par pièces trié', lb.leaderboard.every((p, i, a) => i === 0 || a[i - 1].coins >= p.coins),
    `${lb.leaderboard.length} joueurs`);
  const lbXp = await (await fetch(`${BASE}/api/leaderboard?sort=xp&limit=10`)).json();
  check('classement par XP trié', lbXp.leaderboard.every((p, i, a) => i === 0 || a[i - 1].xp >= p.xp));

  /* ── Rien ne crée de pièces à partir de rien ── */
  section('Économie');
  const cheatBefore = alice.profile.coins;
  alice.toasts = [];
  alice.socket.emit('plinko:play', { bet: -100000, rows: 16, risk: 'high', balls: 10 });
  await wait(400);
  check('mise négative refusée', alice.profile.coins <= cheatBefore && alice.toasts.some((t) => t.kind === 'error'));

  alice.toasts = [];
  alice.socket.emit('plinko:play', { bet: alice.profile.coins + 1000000, rows: 16, risk: 'high', balls: 1 });
  await wait(400);
  check('mise au-dessus du solde refusée', alice.toasts.some((t) => t.kind === 'error'));

  alice.toasts = [];
  alice.socket.emit('admin:open', {});
  await wait(400);
  check('panel admin refusé à un joueur ordinaire', alice.toasts.some((t) => t.kind === 'error'));

  /* ── Bilan ── */
  alice.socket.close();
  bob.socket.close();
  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'Tout est passé.' : `${failures} vérification(s) en échec.`);
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('\nLe banc d’essai a échoué :', err.message);
  process.exit(1);
});
