'use strict';
/**
 * LA SOIRÉE, EN VRAI.
 *
 * Le simulateur (`test/soiree-sim.js`) vérifie l'arithmétique sans serveur.
 * Ici on branche trois vrais clients sur le vrai serveur et on regarde la
 * seule chose que le simulateur ne peut pas voir : est-ce que tout le monde
 * bascule bien d'un jeu à l'autre tout seul ?
 *
 * C'est le cœur de la fonctionnalité. Si l'enchaînement rate, la soirée
 * n'existe pas — trois personnes restent plantées sur un écran de fin
 * pendant que la quatrième cherche le code du salon suivant.
 */
const { io } = require('socket.io-client');
const { gatePass, withPass } = require('./pass');

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

  const p = { name, socket, joined: null, soiree: null, gos: [], toasts: [], uc: null, uno: null };
  socket.on('me', ({ user, profile }) => { p.user = user; p.profile = profile; });
  socket.on('toast', (t) => p.toasts.push(t));
  socket.on('party:joined', (j) => { p.joined = j; });
  socket.on('uc:state', (s) => { p.uc = s; });
  socket.on('uno:state', (s) => { p.uno = s; });
  socket.on('soiree:state', (s) => { p.soiree = s; });

  // Le navigateur rejoint tout seul la manche suivante : on fait pareil,
  // sinon on testerait un chemin que personne n'emprunte.
  socket.on('soiree:go', ({ code }) => { p.gos.push(code); socket.emit('party:join', { code }); });

  await new Promise((res2, rej) => {
    socket.on('connect', res2);
    socket.on('connect_error', rej);
    setTimeout(() => rej(new Error('connexion trop lente')), 6000);
  });
  await waitFor(() => p.profile, 5000, `profil de ${name}`);
  socket.emit('party:open');
  return p;
}

(async () => {
  pass = await gatePass(BASE);
  console.log(`La soirée, en vrai — ${BASE}\n`);

  const tag = Date.now().toString(36).slice(-3);
  const [a, b, c] = await Promise.all(['Ana', 'Bruno', 'Chloe'].map((n) => guest(n + tag)));

  /* ── LA CRÉATION ── */
  section('On compose la soirée');

  a.toasts = [];
  a.socket.emit('soiree:create', { games: ['undercover'] });
  await wait(400);
  check('un seul jeu, ce n’est pas une soirée',
    a.toasts.some((t) => t.kind === 'error'), (a.toasts[0] || {}).message);

  a.socket.emit('soiree:create', { games: ['undercover', 'uno', 'blindtest'] });
  const first = await waitFor(() => a.joined, 5000, 'première manche ouverte');
  check('la soirée ouvre le salon du premier jeu', first.game === 'undercover', first.game);
  const s0 = await waitFor(() => a.soiree, 5000, 'état de la soirée');
  check('trois manches annoncées', s0.rounds === 3, `${s0.rounds}`);
  check('on est à la première', s0.round === 1, `${s0.round}`);
  check('l’organisateur est bien l’hôte', s0.hostId === a.user.id);

  for (const p of [b, c]) {
    p.socket.emit('party:join', { code: first.code });
    await waitFor(() => p.uc && p.uc.code === first.code, 5000, `${p.name} rejoint`);
  }
  await waitFor(() => a.soiree && a.soiree.standings.length === 3, 5000, 'trois inscrits');
  check('les arrivants entrent au classement dès l’entrée',
    a.soiree.standings.length === 3, `${a.soiree.standings.length} inscrits`);
  check('tout le monde voit la soirée',
    [a, b, c].every((p) => p.soiree && p.soiree.code === s0.code));
  check('et tout le monde part à zéro',
    a.soiree.standings.every((r) => r.points === 0));

  /* ── LA PREMIÈRE MANCHE ── */
  section('On joue la première manche');
  a.socket.emit('party:start');
  await waitFor(() => a.uc && a.uc.phase === 'describing', 6000, 'partie lancée');

  // On ne joue pas vraiment : on vote jusqu'à ce que la partie se termine.
  // Ce qui nous intéresse, c'est la fin — le simulateur d'Undercover
  // s'occupe des règles.
  let guard = 0;
  while (a.uc && a.uc.phase !== 'over' && guard++ < 40) {
    const phase = a.uc.phase;
    if (phase === 'describing') {
      for (const p of [a, b, c]) {
        if (p.uc && p.uc.speaker === p.user.id) p.socket.emit('uc:describe', { text: 'un mot' });
      }
    } else if (phase === 'voting') {
      for (const p of [a, b, c]) {
        const alive = (p.uc.players || []).filter((x) => !x.out && x.id !== p.user.id);
        if (alive.length) p.socket.emit('uc:vote', { id: alive[0].id });
      }
    }
    await wait(400);
  }
  check('la première manche se termine', a.uc && a.uc.phase === 'over', a.uc ? a.uc.phase : '—');

  const scored = await waitFor(
    () => (a.soiree && a.soiree.standings.some((r) => r.points > 0) ? a.soiree : null),
    6000, 'classement mis à jour');
  check('la manche est comptée au classement',
    scored.standings.some((r) => r.points > 0),
    scored.standings.map((r) => `${r.name} ${r.points}`).join(', '));
  check('personne ne repart les mains vides',
    scored.standings.every((r) => r.points >= 1));
  check('la manche suivante est annoncée', scored.nextGame === 'uno', String(scored.nextGame));

  /* ── LA BASCULE ── */
  section('Tout le monde bascule dans le jeu suivant');
  b.toasts = [];
  b.socket.emit('soiree:next');
  await wait(400);
  check('seul l’organisateur lance la manche suivante',
    b.toasts.some((t) => t.kind === 'warn'), (b.toasts.find((t) => t.kind === 'warn') || {}).message);

  [a, b, c].forEach((p) => { p.joined = null; p.gos = []; });
  a.socket.emit('soiree:next');

  await waitFor(() => [a, b, c].every((p) => p.joined && p.joined.game === 'uno'), 8000,
    'les trois joueurs dans le salon d’Uno');
  check('les trois basculent sans rien cliquer',
    [a, b, c].every((p) => p.gos.length === 1), [a, b, c].map((p) => p.gos.length).join('/'));
  const code2 = a.joined.code;
  check('c’est bien le même salon pour tout le monde',
    [a, b, c].every((p) => p.joined.code === code2), code2);
  check('et ce n’est pas celui de la manche précédente', code2 !== first.code);

  await waitFor(() => a.uno && a.uno.code === code2, 6000, 'état de l’Uno');
  check('trois joueurs à la table', a.uno.players.length === 3, `${a.uno.players.length}`);
  check('l’organisateur récupère la casquette d’hôte',
    a.uno.hostId === a.user.id, a.uno.hostId === a.user.id ? '' : 'la casquette est partie ailleurs');

  const s2 = await waitFor(() => (a.soiree && a.soiree.round === 2 ? a.soiree : null), 6000, 'manche 2');
  check('la soirée est passée à la manche 2', s2.round === 2 && s2.game === 'uno');
  check('les points de la manche 1 sont conservés',
    s2.standings.reduce((n, r) => n + r.points, 0) > 0,
    s2.standings.map((r) => `${r.name} ${r.points}`).join(', '));

  /* ── LE GARDE-FOU ── */
  section('Le garde-fou');
  check('la manche suivante n’est pas encore proposée', s2.awaiting === false);

  a.toasts = [];
  a.socket.emit('soiree:next');
  await wait(400);
  check('on ne saute pas une manche que personne n’a jouée',
    a.toasts.some((t) => t.kind === 'warn'), (a.toasts.find((t) => t.kind === 'warn') || {}).message);

  a.toasts = [];
  a.socket.emit('party:start');
  await waitFor(() => a.uno && a.uno.phase !== 'lobby', 6000, 'Uno lancé');
  a.socket.emit('soiree:next');
  await wait(400);
  check('ni une manche en cours',
    a.toasts.some((t) => t.kind === 'warn'), (a.toasts.find((t) => t.kind === 'warn') || {}).message);

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  [a, b, c].forEach((p) => p.socket.close());
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('\nLe banc d’essai a échoué :', err.message);
  process.exit(1);
});
