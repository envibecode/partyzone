'use strict';
/**
 * BANC D'ESSAI : LES PARTIES SURVIVENT À UN REDÉMARRAGE.
 *
 * On lance un vrai serveur, on ouvre une partie de Monopoly à trois, on
 * joue quelques tours, on TUE le serveur comme le fait un redéploiement
 * (SIGTERM), on le relance, et on vérifie que tout est là : le code du
 * salon, les positions des pions, l'argent, les propriétés, le tour en
 * cours, et surtout que la partie repart.
 *
 * C'est le seul test du dépôt qui redémarre un serveur en cours de route,
 * parce que c'est exactement ce qu'on veut prouver : le `git push` du
 * samedi soir ne doit plus tuer la partie de tout le monde.
 */
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');
const { gatePass, withPass } = require('./pass');

const PORT = Number(process.env.PERSIST_PORT || 3210);
const BASE = `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

function waitFor(fn, ms = 8000, what = 'condition') {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const step = () => {
      let v; try { v = fn(); } catch { v = null; }
      if (v) return resolve(v);
      if (Date.now() - started > ms) return reject(new Error(`délai dépassé : ${what}`));
      setTimeout(step, 80);
    };
    step();
  });
}

/* ─── Le serveur, qu'on allume et qu'on éteint ─── */

let child = null;

function startServer() {
  child = spawn('node', ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ADMIN_KEY: 'test-admin-key', PARTY_PERSIST_TEST: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });
  child.__log = () => log;
  return ready();
}

/**
 * Attendre que le serveur réponde.
 *
 * Écrit à la main plutôt qu'avec `waitFor` : une fonction asynchrone rend
 * une promesse, et une promesse est toujours vraie — le test croyait le
 * serveur prêt à la première boucle et repartait dans le vide.
 */
async function ready(ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return child;
    } catch { /* pas encore là */ }
    await wait(200);
  }
  throw new Error('le serveur ne répond pas');
}

/**
 * Un arrêt propre, exactement comme un redéploiement chez l'hébergeur.
 *
 * On ne se contente pas d'envoyer le signal : on attend que le port cesse
 * de répondre. Sinon un serveur qui refuse de mourir laisserait le test
 * croire qu'il a redémarré, et on vérifierait la persistance sur une
 * partie qui n'a jamais quitté la mémoire — le pire des faux positifs.
 */
async function stopServer() {
  if (!child) return;
  const dead = new Promise((r) => child.once('exit', r));
  child.kill('SIGTERM');
  await Promise.race([dead, wait(9000)]);
  child = null;

  const until = Date.now() + 8000;
  while (Date.now() < until) {
    try {
      await fetch(`${BASE}/healthz`);
    } catch {
      await wait(300);
      return;   // le port ne répond plus : le serveur est bien mort
    }
    await wait(200);
  }
  throw new Error('le serveur répond encore après SIGTERM');
}

/* ─── Un joueur ─── */

async function guest(pass, name) {
  const res = await fetch(`${BASE}/auth/guest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: pass },
    body: JSON.stringify({ name }),
  });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  return withPass(pass, raw.map((c) => c.split(';')[0]).join('; '));
}

function connect(cookie, name) {
  const socket = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
  const p = { name, socket, cookie, mono: null, joined: null, toasts: [] };
  socket.on('me', ({ user, profile }) => { p.user = user; p.profile = profile; });
  socket.on('mono:state', (s) => { p.mono = s; });
  socket.on('party:joined', (j) => { p.joined = j; });
  socket.on('toast', (t) => p.toasts.push(t));
  return new Promise((res, rej) => {
    socket.on('connect', () => res(p));
    socket.on('connect_error', rej);
    setTimeout(() => rej(new Error(`connexion trop lente (${name})`)), 8000);
  });
}

/* ─── Le scénario ─── */

(async () => {
  console.log(`Banc d'essai : survie des parties Party — ${BASE}\n`);

  await startServer();
  let pass = await gatePass(BASE);

  section('Une partie de Monopoly en cours');
  const cookies = [];
  for (const name of ['Alpha', 'Bravo', 'Charlie']) cookies.push(await guest(pass, name));
  let players = [];
  for (let i = 0; i < 3; i++) players.push(await connect(cookies[i], ['Alpha', 'Bravo', 'Charlie'][i]));
  for (const p of players) await waitFor(() => p.profile, 6000, `profil ${p.name}`);

  players[0].socket.emit('party:create', { game: 'monopoly' });
  const room = await waitFor(() => players[0].joined, 6000, 'salon créé');
  const code = room.code;
  check('salon ouvert', /^[A-Z]{4}$/.test(code), code);

  for (const p of players.slice(1)) {
    p.socket.emit('party:join', { code });
    await waitFor(() => p.joined, 6000, `${p.name} rejoint`);
  }
  players[0].socket.emit('mono:configure', { laps: 60 });
  await wait(300);
  players[0].socket.emit('party:start');
  await waitFor(() => players[0].mono && players[0].mono.phase === 'play', 6000, 'partie lancée');

  // On joue une trentaine d'actions pour créer un vrai état : des pions
  // ailleurs qu'au départ, des propriétés achetées, de l'argent dépensé.
  for (let n = 0; n < 60; n++) {
    const s = players[0].mono;
    if (!s || s.phase !== 'play') break;
    const me = players.find((p) => p.mono && p.mono.you && p.mono.you.yourTurn);
    if (!me) { await wait(120); continue; }
    const step = me.mono.step;
    if (step === 'roll') me.socket.emit('mono:roll');
    else if (step === 'decide') me.socket.emit('mono:buy');
    else if (step === 'end') me.socket.emit('mono:end');
    else break;
    await wait(140);
  }
  await wait(600);

  const before = players[0].mono;
  const owned = before.cells.filter((c) => c.ownerId).length;
  const snapshot = {
    code: before.code,
    laps: before.laps,
    turn: before.currentId,
    positions: before.players.map((p) => `${p.name}:${p.pos}`).join(','),
    money: before.players.map((p) => `${p.name}:${p.money}`).join(','),
    owners: before.cells.map((c) => c.ownerId || '-').join(','),
  };
  check('des cases ont été achetées', owned > 0, `${owned} case(s)`);
  check('les pions ont bougé',
    before.players.some((p) => p.pos !== 0),
    snapshot.positions);

  // On laisse le battement de sauvegarde passer une fois, pour vérifier
  // que la sauvegarde périodique fonctionne aussi (pas seulement l'arrêt).
  await wait(600);

  /* ── LE REDÉMARRAGE ── */
  section('On tue le serveur, comme un redéploiement');
  for (const p of players) p.socket.close();
  await stopServer();
  check('le serveur est arrêté', child === null);

  await startServer();
  check('le serveur est reparti', true);

  /* ── APRÈS ── */
  section('La partie est toujours là');
  pass = await gatePass(BASE);
  players = [];
  for (let i = 0; i < 3; i++) {
    // Le laissez-passer de la porte a changé : on recolle l'ancien cookie
    // de session avec le nouveau, comme le ferait un navigateur.
    const session = cookies[i].split('; ').filter((c) => !c.startsWith('pz_gate=')).join('; ');
    players.push(await connect(withPass(pass, session), ['Alpha', 'Bravo', 'Charlie'][i]));
  }
  for (const p of players) await waitFor(() => p.profile, 6000, `profil ${p.name}`);

  // On revient sur le hall Party : c'est le chemin normal de reconnexion.
  for (const p of players) p.socket.emit('party:open');
  const after = await waitFor(() => players[0].mono, 8000, 'état du salon retrouvé');

  check('le salon a le même code', after.code === snapshot.code, `${after.code} (avant : ${snapshot.code})`);
  check('la partie est toujours en cours', after.phase === 'play', after.phase);
  check('les pions sont où on les avait laissés',
    after.players.map((p) => `${p.name}:${p.pos}`).join(',') === snapshot.positions,
    after.players.map((p) => `${p.name}:${p.pos}`).join(','));
  check('l’argent de chacun est intact',
    after.players.map((p) => `${p.name}:${p.money}`).join(',') === snapshot.money,
    after.players.map((p) => `${p.name}:${p.money}`).join(','));
  check('les propriétés ont gardé leur propriétaire',
    after.cells.map((c) => c.ownerId || '-').join(',') === snapshot.owners);
  check('le nombre de tours joués est conservé', after.laps === snapshot.laps, `${after.laps}`);
  check('c’est au tour de la même personne', after.currentId === snapshot.turn);
  check('les trois joueurs sont reconnectés',
    after.players.filter((p) => p.connected).length === 3,
    `${after.players.filter((p) => p.connected).length}/3 connectés`);
  check('le salon dit qu’il a redémarré',
    (after.log || []).some((l) => /redémarr/i.test(l.text)),
    (after.log[0] || {}).text || '—');

  /* ── ET ELLE REPART ── */
  section('Et on peut continuer à jouer');
  const turn = players.find((p) => p.mono && p.mono.you.yourTurn);
  check('celui dont c’est le tour a la main', Boolean(turn));
  if (turn) {
    const posBefore = turn.mono.players.find((p) => p.you).pos;
    // Les dés du coup PRÉCÉDENT ont été sauvegardés avec la partie : on
    // attend qu'ils changent, pas qu'ils existent — sinon on lit l'état
    // d'avant le redémarrage et on croit que rien n'a bougé.
    const diceBefore = (turn.mono.dice || []).join('-');
    turn.socket.emit('mono:roll');
    await waitFor(() => (turn.mono.dice || []).join('-') !== diceBefore, 9000, 'nouveaux dés');
    check('les dés répondent', Array.isArray(turn.mono.dice), (turn.mono.dice || []).join('+'));
    const posAfter = turn.mono.players.find((p) => p.you).pos;
    check('le pion avance', posAfter !== posBefore || turn.mono.you.jail,
      `${posBefore} → ${posAfter}`);
  }

  for (const p of players) p.socket.close();
  await stopServer();

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('\nLe banc d’essai a échoué :', err.message);
  if (child && child.__log) console.error(child.__log().slice(-1500));
  await stopServer();
  process.exit(1);
});
