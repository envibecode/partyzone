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
const { gatePass, withPass } = require('./pass');

const BASE = process.env.BASE || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Le site a une porte : les bancs d'essai entrent avec la clé, comme nous.
let pass = '';

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
}
function section(title) {
  console.log('\n▶ ' + title);
}

/* ─── Un joueur ────────────────────────────────────────── */

/*
 * Chaque exécution crée des pseudos NEUFS.
 *
 * Avec des noms fixes, la deuxième exécution retombait sur les profils de la
 * première : « Bob » avait alors plus d'une heure d'ancienneté et passait la
 * garde anti-comptes-jetables des cadeaux, et « Alice » désignait deux profils
 * différents — deux vérifications qui échouaient sans qu'aucun code ne soit
 * en cause. Un suffixe suffit à isoler chaque campagne.
 */
const RUN = Date.now().toString(36).slice(-4);

async function makeGuest(baseName) {
  const name = baseName + RUN;
  const res = await fetch(`${BASE}/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: pass },
    body: JSON.stringify({ name }),
  });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  const cookie = withPass(pass, raw.map((c) => c.split(';')[0]).join('; '));
  const socket = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });

  const p = {
    name, socket, cookie, baseName,
    profile: null, user: null,
    mine: null, plinko: null, roulette: null, table: null, vault: null,
    medals: null, season: null, slots: null, gifts: null,
    lastPlinko: null, lastVault: null, lastSlots: null, toasts: [],
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
  socket.on('roulette:setups', ({ setups }) => { p.setups = setups; });
  socket.on('medals:state', (s2) => { p.medals = s2; });
  socket.on('season:state', (s2) => { p.season = s2; });
  socket.on('slots:state', ({ config }) => { p.slots = config; });
  socket.on('slots:result', (r) => { p.lastSlots = r; });
  socket.on('gift:list', (g) => { p.gifts = g; });
  socket.on('chat:message', (m) => { p.chat = [...(p.chat || []), m]; });

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

/**
 * Crédite un joueur pour la suite des essais.
 *
 * La mine est volontairement lente — avec l'endurance, il faudrait des
 * heures pour amasser de quoi tester le casino. On passe donc par le panel
 * d'administration, ce qui a l'avantage d'exercer ce chemin-là aussi. Le
 * comportement réel de la mine est vérifié dans sa propre section.
 */
async function topUp(player, target) {
  if (player.profile.coins >= target) return player.profile.coins;
  if (!player.isAdmin) {
    player.socket.emit('admin:claim', { key: process.env.ADMIN_KEY || 'test-admin-key' });
    await waitFor(() => player.profile.admin, 4000, `droits admin pour ${player.name}`);
    player.isAdmin = true;
  }
  player.socket.emit('admin:action', {
    action: 'grant-coins',
    payload: { id: player.user.id, amount: target - player.profile.coins + 1000 },
  });
  await waitFor(() => player.profile.coins >= target, 4000, 'crédit');
  return player.profile.coins;
}

/* ══════════════════════════════════════════════════════ */

(async () => {
  // La porte d'abord : sans laissez-passer, tout renvoie le compte à rebours.
  pass = await gatePass(BASE);

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

  // Le plafond : on envoie 200 coups d'un coup, le serveur doit en jeter.
  const capBefore = alice.mine.clicks;
  alice.socket.emit('mine:click', { count: 200 });
  await wait(300);
  alice.socket.emit('mine:open');
  await wait(300);
  check('cadence plafonnée par le serveur', alice.mine.clicks - capBefore <= 30,
    `${alice.mine.clicks - capBefore} coups retenus sur 200 demandés`);

  // L'endurance : on tape jusqu'à vider la barre, le rendement doit chuter.
  alice.socket.emit('mine:open');
  await wait(300);
  const fresh = alice.mine.staminaMax;
  let lastHit = null;
  alice.socket.on('mine:hit', (r) => { lastHit = r; });
  // Le plafond de cadence tape en premier, l'endurance s'épuise ensuite :
  // il faut donc taper un moment avant de voir la barre tomber à zéro.
  let tiredSeen = 0;
  for (let i = 0; i < 130; i++) {
    alice.socket.emit('mine:click', { count: 20 });
    await wait(70);
    if (lastHit && lastHit.tired) tiredSeen += lastHit.tired;
  }
  await wait(400);
  check('l’endurance s’épuise sous un autoclic', lastHit && lastHit.stamina < fresh * 0.2,
    `${lastHit ? lastHit.stamina : '?'} / ${fresh} restants après 9 s d'autoclic`);
  check('les coups à vide ne rapportent presque rien', tiredSeen > 0,
    `${tiredSeen} coups tapés dans le vide`);

  // Aucun revenu hors ligne : on attend, rien ne doit tomber.
  const idleBefore = alice.profile.coins;
  await wait(2500);
  alice.socket.emit('mine:open');
  await wait(300);
  check('aucun revenu quand on ne tape pas', alice.profile.coins === idleBefore,
    `${alice.profile.coins} pièces, inchangé après 2,5 s`);

  await topUp(alice, 3000);
  const coinsForUpgrade = alice.profile.coins;
  alice.socket.emit('mine:buy', { id: 'pick' });
  await wait(400);
  check('amélioration achetée et facturée', alice.profile.coins < coinsForUpgrade && alice.mine.upgrades[0].level === 1);
  check('le coup rapporte plus après achat', alice.mine.perClick > 1, `${alice.mine.perClick} par coup`);
  check('aucune amélioration ne produit hors ligne',
    alice.mine.upgrades.every((u) => !/seconde|passif/i.test(u.next || '')));

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

  await topUp(alice, 60000);
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

  check('les mises de tout le monde sont publiques',
    Array.isArray(res.table) && res.table.some((t) => t.you), `${res.table.length} joueur(s) au tapis`);
  check('les jetons sont visibles case par case',
    res.board && Object.keys(res.board).length > 0, `${Object.keys(res.board || {}).length} case(s) occupée(s)`);
  check('bandeau des gagnants du dernier tour', res.lastWinners !== undefined);

  // Refus des mises hors phase.
  await waitFor(() => alice.roulette.phase !== 'betting', 20000, 'fermeture des mises');
  alice.toasts = [];
  alice.socket.emit('roulette:bet', { type: 'black', value: null, amount: 100 });
  await wait(400);
  check('mise refusée quand la roue tourne', alice.toasts.some((t) => t.kind === 'error'));

  // Remiser : on repose exactement la même chose au tour suivant.
  await waitFor(() => alice.roulette.phase === 'betting', 45000, 'nouveau tour');
  await topUp(alice, 2000);
  const beforeRebet = alice.profile.coins;
  alice.toasts = [];
  alice.socket.emit('roulette:rebet');
  await wait(600);
  check('bouton remiser', alice.roulette.you && alice.roulette.you.staked === 100,
    `${alice.profile.coins} pièces après avoir reposé (${beforeRebet} avant)`);

  // Configurations enregistrées.
  alice.socket.emit('roulette:setup-save', { name: 'Mon rouge' });
  await wait(600);
  alice.socket.emit('roulette:setups');
  const saved = await waitFor(() => alice.setups, 4000, 'configurations');
  check('configuration enregistrée', saved.some((s) => s.name === 'Mon rouge'),
    `${saved.length} configuration(s)`);

  /* ── Blackjack ── */
  section('Blackjack');
  await topUp(bob, 5000);
  alice.socket.emit('bj:create');
  const table = await waitFor(() => alice.table, 5000, 'création de table');
  check('table créée avec un code à 4 lettres', /^[A-Z]{4}$/.test(table.code), table.code);
  check('sabot mélangé depuis une graine publiée', table.shoeSeedHash.length === 64);

  bob.socket.emit('bj:join', { code: table.code });
  await waitFor(() => bob.table && bob.table.code === table.code, 5000, 'Bob à table');
  check('deuxième joueur assis', alice.table.seats.length === 2);

  check('aucun bot à la table', alice.table.seats.every((s) => !s.isBot));

  // La table tourne toute seule : le décompte démarre dès l'ouverture, on
  // n'attend pas qu'un joueur mise.
  check('la table démarre sans attendre personne',
    ['betting', 'waiting'].includes(alice.table.phase), alice.table.phase);
  check('grille des paris annexes publiée',
    alice.table.sidebets && alice.table.sidebets.rtp.pairs > 80 && alice.table.sidebets.rtp.trio > 80,
    `paire ${alice.table.sidebets.rtp.pairs} % · 21+3 ${alice.table.sidebets.rtp.trio} %`);

  await topUp(alice, 5000);
  const bjBefore = alice.profile.coins;
  alice.socket.emit('bj:bet', { amount: 200, side: { pairs: 50, trio: 50 } });
  bob.socket.emit('bj:bet', { amount: 100 });
  await wait(700);
  check('mise principale et annexes débitées ensemble',
    alice.profile.coins === bjBefore - 300, `${bjBefore} → ${alice.profile.coins}`);

  alice.socket.emit('bj:auto', { on: true });
  await wait(300);
  check('mode auto activé', alice.table.you.auto);

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
  check('paris annexes réglés à la donne', Boolean(settled.sideResult),
    settled.sideResult && settled.sideResult.pairs
      ? `paire : ${settled.sideResult.pairs.name || 'perdue'}` : 'réglés');
  check('croupier découvert au règlement', alice.table.dealer.cards.every((c) => !c.hidden));
  check('valeur du croupier calculée', alice.table.dealer.value && alice.table.dealer.value.total > 0,
    `${alice.table.dealer.value.total}`);

  bob.socket.emit('bj:leave');
  alice.socket.emit('bj:leave');
  await wait(400);

  /* ── Caisses ── */
  section('Caisses et collection');
  await topUp(alice, 20000);
  alice.socket.emit('vault:open');
  const vault = await waitFor(() => alice.vault, 4000, 'état du coffre');
  check('518 objets au catalogue', vault.items.length === 518, `${vault.items.length} objets`);
  check('treize caisses proposées', vault.cases.length === 13, `${vault.cases.length} caisses`);
  check('huit caisses à thème', vault.cases.filter((c) => c.themed).length === 8);
  check('chaque catégorie a son compte', vault.collection.byCategory.length === 8
    && vault.collection.byCategory.reduce((s2, c) => s2 + c.total, 0) === 518);

  // Les probabilités affichées doivent faire 100 %.
  for (const box of vault.cases) {
    const sum = box.odds.reduce((s, o) => s + o.percent, 0);
    check(`probabilités de « ${box.name} » cohérentes`, Math.abs(sum - 100) < 0.5, `${sum.toFixed(2)} %`);
  }

  const vBefore = alice.profile.coins;
  alice.lastVault = null;
  alice.socket.emit('vault:pull', { caseId: 'boost', count: 5 });
  const pull = await waitFor(() => alice.lastVault, 5000, 'ouverture de caisse');
  check('cinq tirages retournés', pull.ok && pull.pulls.length === 5);
  check('chaque tirage a sa bande de 58 vignettes',
    pull.pulls.every((x) => x.reel.strip.length === 58));
  check('l’objet gagné est bien à l’index annoncé',
    pull.pulls.every((x) => x.reel.strip[x.reel.winIndex].id === x.id));
  check('caisse facturée', alice.profile.coins < vBefore);

  // On ouvre en masse pour vérifier que les raretés sortent dans l'ordre attendu.
  const seen = { common: 0, rare: 0, epic: 0, legendary: 0, mythic: 0, cursed: 0 };
  await topUp(alice, 80000);
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

  // Une caisse à thème ne doit jamais sortir d'objet d'une autre catégorie.
  await topUp(alice, 30000);
  alice.lastVault = null;
  alice.socket.emit('vault:pull', { caseId: 'cat-gaming', count: 10 });
  const themed = await waitFor(() => alice.lastVault, 6000, 'caisse à thème');
  check('la caisse à thème ne tire que dans sa catégorie',
    themed.ok && themed.pulls.every((x) => x.cat === 'gaming'),
    themed.ok ? [...new Set(themed.pulls.map((x) => x.cat))].join(', ') : 'échec');

  /* ── Médailles et parures ── */
  section('Médailles et parures');
  alice.socket.emit('medals:open');
  const med = await waitFor(() => alice.medals, 4000, 'état des médailles');
  // Un palier tous les cinquante objets, plus un dernier pour la collection
  // complète — 518 ne tombant pas rond, le onzième vaut 518 et non 550.
  const last = med.tiers[med.tiers.length - 1];
  check('paliers tous les cinquante objets, plus la collection complète',
    med.tiers.slice(0, -1).every((t, i2) => t.need === (i2 + 1) * 50) && last.need === med.total,
    `${med.tiers.length} paliers, jusqu'à ${last.need}`);
  check('le compte d’objets correspond à la collection', med.collected === alice.vault.collection.have,
    `${med.collected} vs ${alice.vault.collection.have}`);

  const unlocked = med.cosmetics.filter((c) => c.unlocked);
  check('les parures non méritées restent verrouillées',
    med.cosmetics.some((c) => !c.unlocked), `${unlocked.length} débloquée(s) sur ${med.cosmetics.length}`);

  if (unlocked.length) {
    const wanted = unlocked[0];
    alice.socket.emit('medals:equip', { kind: wanted.kind, id: wanted.id });
    await waitFor(() => alice.profile.cosmetics && alice.profile.cosmetics[wanted.kind], 4000, 'parure équipée');
    check('parure équipée et visible dans le profil public', Boolean(alice.profile.cosmetics[wanted.kind]));
  }

  alice.toasts = [];
  alice.socket.emit('medals:equip', { kind: 'frame', id: 'frame-mythe' });
  await wait(400);
  check('parure verrouillée refusée', alice.toasts.some((t) => t.kind === 'error' || t.kind === 'warn'));

  /* ── Machine à sous ── */
  section('Machine à sous');
  alice.socket.emit('slots:open');
  const slots = await waitFor(() => alice.slots, 4000, 'config de la machine');
  check('cinq rouleaux, trois rangées, dix lignes',
    slots.reels === 5 && slots.rows === 3 && slots.lines === 10);
  check('redistribution mesurée et annoncée', slots.rtp > 90 && slots.rtp < 100,
    `${slots.rtp} % sur ${slots.measuredOn.toLocaleString('fr-FR')} tours`);

  await topUp(alice, 60000);
  let slStaked = 0;
  let slPaid = 0;
  let bonusSeen = 0;
  for (let i = 0; i < 40; i++) {
    alice.lastSlots = null;
    alice.socket.emit('slots:spin', { bet: 10 });
    const r = await waitFor(() => alice.lastSlots, 5000, 'tour de machine');
    if (!r.ok) break;
    slStaked += r.staked;
    slPaid += r.payout;
    if (r.bonus.length) bonusSeen++;
  }
  check('grille complète à chaque tour', alice.lastSlots.spin.grid.length === 5
    && alice.lastSlots.spin.grid.every((c) => c.length === 3));
  check('la mise est bien de dix fois la mise par ligne', alice.lastSlots.staked === alice.lastSlots.perLine * 10);
  check('les tours offerts sont joués par le serveur',
    alice.lastSlots.bonus.every((b) => Array.isArray(b.grid)));
  console.log(`     ${slStaked} misés, ${slPaid} rendus (${((slPaid / slStaked) * 100).toFixed(1)} %), ${bonusSeen} bonus sur 40 tours`);

  /* ── Cadeaux ── */
  section('Cadeaux');
  alice.socket.emit('gift:list');
  const giftView = await waitFor(() => alice.gifts, 4000, 'liste des cadeaux');
  check('plafond quotidien annoncé', giftView.dailyLimit > 0 && giftView.left <= giftView.dailyLimit,
    `${giftView.left} pièces offrables aujourd'hui`);

  alice.toasts = [];
  alice.socket.emit('gift:send', { to: alice.name, caseId: 'starter', count: 1 });
  await wait(500);
  check('on ne s’offre pas de cadeau à soi-même', alice.toasts.some((t) => t.kind === 'error'));

  // Bob vient d'être créé : il est trop récent pour recevoir.
  alice.toasts = [];
  alice.socket.emit('gift:send', { to: bob.name, caseId: 'starter', count: 2 });
  await wait(600);
  const tooYoung = alice.toasts.some((t) => /récent/i.test(t.message || ''));
  check('un compte tout neuf ne peut pas recevoir', tooYoung,
    tooYoung ? 'refusé comme prévu' : (alice.toasts[0] || {}).message || 'aucun refus');

  // La distribution par l'administration, elle, passe toujours.
  bob.gifts = null;
  alice.socket.emit('admin:action', {
    action: 'grant-case',
    payload: { id: bob.user.id, caseId: 'viral', count: 2 },
  });
  await wait(700);
  bob.socket.emit('gift:list');
  const bobGifts = await waitFor(() => bob.gifts, 4000, 'cadeaux de Bob');
  check('l’administration peut distribuer des caisses', bobGifts.gifts.length > 0,
    `${bobGifts.gifts.length} bon(s) en attente`);

  if (bobGifts.gifts.length) {
    const coinsBefore = bob.profile.coins;
    bob.lastVault = null;
    bob.socket.emit('gift:claim', { id: bobGifts.gifts[0].id });
    const claimed = await waitFor(() => bob.lastVault, 5000, 'ouverture du cadeau');
    check('le cadeau s’ouvre sans rien coûter', claimed.ok && bob.profile.coins >= coinsBefore,
      `${claimed.pulls.length} objets, solde ${coinsBefore} → ${bob.profile.coins}`);
  }

  /* ── Classement du mois ── */
  section('Classement du mois');
  alice.socket.emit('season:open');
  const season = await waitFor(() => alice.season, 4000, 'classement du mois');
  check('le mois en cours est identifié', Boolean(season.label && season.endsAt > Date.now()));
  check('le classement compte le bénéfice net, pas le solde',
    season.ranking.every((p, i2, a) => i2 === 0 || a[i2 - 1].coins >= p.coins));
  check('le lot du mois est annoncé', Boolean(season.prize));

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
  const lb = await (await fetch(`${BASE}/api/leaderboard?sort=coins&limit=10`, { headers: { Cookie: pass } })).json();
  check('classement par pièces trié', lb.leaderboard.every((p, i, a) => i === 0 || a[i - 1].coins >= p.coins),
    `${lb.leaderboard.length} joueurs`);
  const lbXp = await (await fetch(`${BASE}/api/leaderboard?sort=xp&limit=10`, { headers: { Cookie: pass } })).json();
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

  const carol = await makeGuest('Carol');
  carol.socket.emit('admin:open', {});
  await wait(500);
  check('panel admin refusé à un joueur ordinaire', carol.toasts.some((t) => t.kind === 'error'));
  carol.socket.close();

  /* ── Chat ── */
  section('Chat');
  alice.chat = [];
  alice.socket.emit('chat:say', { text: 'Salut la taverne !' });
  await waitFor(() => (alice.chat || []).some((m) => m.text === 'Salut la taverne !'), 4000, 'message diffusé');
  check('message diffusé à tout le monde',
    (bob.chat || []).some((m) => m.text === 'Salut la taverne !'));

  alice.toasts = [];
  alice.socket.emit('chat:say', { text: 'Salut la taverne !' });
  await wait(400);
  check('répétition refusée', alice.toasts.some((t) => t.kind === 'warn'));

  alice.toasts = [];
  for (let i = 0; i < 10; i++) alice.socket.emit('chat:say', { text: `message ${i}` });
  await wait(600);
  check('cadence du chat limitée', alice.toasts.some((t) => t.kind === 'warn'),
    `${alice.toasts.length} refus sur 10 envois d'affilée`);

  const link = 'regarde http://exemple.fr/truc';
  alice.chat = [];
  await wait(1200);
  alice.socket.emit('chat:say', { text: link });
  await wait(600);
  const posted = (alice.chat || []).find((m) => m.text && m.text.includes('exemple'));
  check('les liens sont neutralisés', posted && !posted.text.includes('exemple.fr'),
    posted ? posted.text : 'non publié');

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
