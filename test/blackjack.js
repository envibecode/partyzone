'use strict';
/**
 * BANC D'ESSAI DE LA TABLE DE BLACKJACK.
 *
 * Quatre comportements qu'on ne peut vérifier qu'à plusieurs : regarder sans
 * jouer, les cinq places, l'exclusion d'un joueur inactif, et le départ
 * immédiat dès que tout le monde a misé.
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

  const p = { name, socket, table: null, toasts: [], joined: null };
  socket.on('me', ({ user, profile }) => { p.user = user; p.profile = profile; });
  socket.on('profile:update', (pr) => { p.profile = pr; });
  socket.on('toast', (t) => p.toasts.push(t));
  socket.on('bj:state', (s) => { p.table = s; });
  socket.on('bj:joined', (j) => { p.joined = j; });

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
  player.socket.emit('admin:claim', { key: process.env.ADMIN_KEY || 'test-admin-key' });
  await waitFor(() => player.profile.admin, 4000, 'droits admin');
  player.socket.emit('admin:action', {
    action: 'grant-coins',
    payload: { id: player.user.id, amount: target - player.profile.coins + 1000 },
  });
  await waitFor(() => player.profile.coins >= target, 4000, 'crédit');
}

(async () => {
  // La porte d'abord : sans laissez-passer, tout renvoie le compte à rebours.
  pass = await gatePass(BASE);

  console.log(`Banc d'essai blackjack — ${BASE}\n`);
  const tag = Date.now().toString(36).slice(-4);

  section('La table');
  const host = await guest('Hote' + tag);
  await topUp(host, 50000);
  host.socket.emit('bj:create');
  const room = await waitFor(() => host.joined, 5000, 'table créée');
  const code = room.code;
  await waitFor(() => host.table, 4000, 'état de la table');
  check('table créée', /^[A-Z]{4}$/.test(code), code);
  check('cinq places, pas plus', host.table.seatsMax === 5, `${host.table.seatsMax}`);
  check('l’hôte est assis', host.table.seated === true);
  check('quatre places restent libres', host.table.seatsFree === 4, `${host.table.seatsFree}`);

  /* ── SPECTATEUR ── */
  section('Regarder sans jouer');
  const watcher = await guest('Curieux' + tag);
  watcher.socket.emit('bj:join', { code, watch: true });
  await waitFor(() => watcher.table && watcher.table.code === code, 5000, 'spectateur branché');
  check('le spectateur reçoit l’état de la table', Boolean(watcher.table.seats));
  check('il n’est pas assis', watcher.table.seated === false);
  check('il est bien compté comme spectateur', watcher.table.watching === true);
  check('il ne prend aucune place', watcher.table.seatsFree === 4, `${watcher.table.seatsFree} libres`);
  check('l’hôte voit qu’on le regarde',
    host.table.watchers && host.table.watchers.length === 1,
    `${(host.table.watchers || []).length} spectateur(s)`);

  watcher.toasts = [];
  watcher.socket.emit('bj:bet', { amount: 100 });
  await wait(500);
  check('un spectateur ne peut pas miser', watcher.toasts.some((t) => t.kind === 'error'));

  await topUp(watcher, 20000);
  watcher.socket.emit('bj:sit');
  await waitFor(() => watcher.table.seated === true, 5000, 'spectateur assis');
  check('il peut prendre une place', watcher.table.seated === true);
  check('il reste alors trois places', watcher.table.seatsFree === 3, `${watcher.table.seatsFree}`);
  check('il n’est plus spectateur', host.table.watchers.length === 0);

  /* ── DÉPART IMMÉDIAT ── */
  section('Départ dès que tout le monde a misé');
  await waitFor(() => host.table.phase === 'betting', 30000, 'phase de mises');
  const t0 = Date.now();
  const left = host.table.deadline - host.table.serverNow;
  check('le décompte normal dure une vingtaine de secondes', left > 12000, `${Math.round(left / 1000)} s`);

  host.socket.emit('bj:bet', { amount: 100 });
  await wait(350);
  check('la table attend encore le second joueur',
    host.table.phase === 'betting' && (host.table.deadline - Date.now()) > 4000);

  watcher.socket.emit('bj:bet', { amount: 100 });
  await waitFor(() => host.table.phase !== 'betting', 6000, 'distribution');
  const elapsed = Date.now() - t0;
  check('ça part dès la dernière mise, sans attendre le chrono',
    elapsed < 8000, `distribué en ${(elapsed / 1000).toFixed(1)} s au lieu de ~22 s`);

  // On laisse la main se dérouler.
  await waitFor(() => host.table.phase === 'betting' || host.table.phase === 'waiting', 60000, 'fin de main');

  /* ── EXCLUSION ── */
  section('Retirer un joueur inactif');
  const idle = await guest('Passif' + tag);
  idle.socket.emit('bj:join', { code });
  await waitFor(() => idle.table && idle.table.seated === true, 5000, 'troisième joueur assis');
  check('trois joueurs à la table', host.table.seats.length === 3, `${host.table.seats.length}`);

  idle.toasts = [];
  idle.socket.emit('bj:kick', { id: host.user.id });
  await wait(400);
  check('un joueur ordinaire ne peut retirer personne', idle.toasts.some((t) => t.kind === 'error'));

  // Avec une mise en cours, l'exclusion doit être refusée.
  await waitFor(() => host.table.phase === 'betting', 40000, 'phase de mises');
  idle.socket.emit('bj:bet', { amount: 100 });
  await wait(500);
  host.toasts = [];
  host.socket.emit('bj:kick', { id: idle.user.id });
  await wait(400);
  check('impossible de retirer quelqu’un qui a misé',
    host.toasts.some((t) => /mise en jeu/.test(t.message || '')),
    (host.toasts[0] || {}).message || 'aucun refus');

  // On attend la fin de la main, puis on retire pour de bon.
  await waitFor(() => host.table.phase === 'betting'
    && !host.table.seats.find((x) => x.id === idle.user.id).bet, 90000, 'main terminée');
  idle.toasts = [];
  host.socket.emit('bj:kick', { id: idle.user.id });
  await waitFor(() => host.table.seats.length === 2, 5000, 'joueur retiré');
  check('l’hôte libère la place', host.table.seats.length === 2, `${host.table.seats.length} joueurs`);
  check('l’exclu est prévenu', idle.toasts.some((t) => /retiré/.test(t.message || '')));
  check('l’exclu peut continuer à regarder', idle.table.seated === false && idle.table.watching === true);

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'Tout est passé.' : `${failures} vérification(s) en échec.`);
  [host, watcher, idle].forEach((p) => p.socket.close());
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('\nLe banc d’essai a échoué :', err.message);
  process.exit(1);
});
