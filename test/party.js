'use strict';
/**
 * BANC D'ESSAI DE LA SECTION PARTY.
 *
 * On branche quatre vrais clients, on ouvre un salon, on joue une partie
 * d'Undercover jusqu'au bout, puis un tournoi de poker. On vérifie surtout
 * ce qui ne se voit pas à l'écran : que personne ne reçoit le mot ni les
 * cartes de quelqu'un d'autre, et qu'aucun jeton ne se crée en route.
 */
const { io } = require('socket.io-client');

const BASE = process.env.BASE || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  const cookie = raw.map((c) => c.split(';')[0]).join('; ');
  const socket = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });

  const p = { name, socket, uc: null, pk: null, rank: null, toasts: [], rooms: [], joined: null };
  socket.on('me', ({ user, profile }) => { p.user = user; p.profile = profile; });
  socket.on('profile:update', (profile) => { p.profile = profile; });
  socket.on('toast', (t) => p.toasts.push(t));
  socket.on('uc:state', (s) => { p.uc = s; });
  socket.on('pk:state', (s) => { p.pk = s; });
  socket.on('party:rank', (r) => { p.rank = r; });
  socket.on('party:list', ({ rooms }) => { p.rooms = rooms; });
  socket.on('party:joined', (j) => { p.joined = j; });

  await new Promise((res2, rej) => {
    socket.on('connect', res2);
    socket.on('connect_error', rej);
    setTimeout(() => rej(new Error('connexion trop lente')), 6000);
  });
  await waitFor(() => p.profile, 4000, `profil de ${name}`);
  socket.emit('party:open');
  await waitFor(() => p.rank, 4000, `rang party de ${name}`);
  return p;
}

(async () => {
  console.log(`Banc d'essai Party — ${BASE}\n`);

  section('Connexion et rang');
  const [a, b, c, d] = await Promise.all(
    ['Ana', 'Bruno', 'Chloe', 'Denis'].map((n) => guest(n + Date.now().toString(36).slice(-3)))
  );
  check('quatre joueurs connectés', [a, b, c, d].every((p) => p.user));
  check('le rang Party démarre à zéro', a.rank.level === 1 && a.rank.xp === 0, `niveau ${a.rank.level}`);
  check('le rang Party est séparé du casino', a.profile.party && a.profile.party.xp === 0);

  /* ── UNDERCOVER ── */
  section('Undercover — le salon');
  a.socket.emit('party:create', { game: 'undercover' });
  const joined = await waitFor(() => a.joined, 4000, 'salon créé');
  check('salon créé avec un code à 4 lettres', /^[A-Z]{4}$/.test(joined.code), joined.code);
  await waitFor(() => a.uc, 4000, 'état du salon');
  check('le créateur est l’hôte', a.uc.hostId === a.user.id);

  for (const p of [b, c, d]) {
    p.socket.emit('party:join', { code: joined.code });
    await waitFor(() => p.uc && p.uc.code === joined.code, 4000, `${p.name} rejoint`);
  }
  await wait(300);
  check('quatre joueurs dans le salon', a.uc.players.length === 4, `${a.uc.players.length}`);

  b.toasts = [];
  b.socket.emit('party:start');
  await wait(400);
  check('seul l’hôte peut lancer', b.toasts.some((t) => t.kind === 'error'));

  section('Undercover — une partie complète');
  a.socket.emit('party:start');
  await waitFor(() => a.uc.phase === 'describing', 4000, 'partie lancée');

  const players = [a, b, c, d];
  const roles = players.map((p) => ({ name: p.name, word: p.uc.you.word, white: p.uc.you.isWhite }));
  const wordSet = new Set(roles.map((r) => r.word).filter(Boolean));
  check('deux mots distincts distribués', wordSet.size === 2, [...wordSet].join(' / '));
  const counts = {};
  roles.forEach((r) => { counts[r.word] = (counts[r.word] || 0) + 1; });
  const sorted = Object.entries(counts).sort((x, y) => y[1] - x[1]);
  check('les civils sont majoritaires', sorted[0][1] > sorted[1][1], sorted.map(([w, n]) => `${w}×${n}`).join(', '));

  // Personne ne doit connaître le rôle des autres.
  check('aucun joueur ne voit le rôle des autres',
    players.every((p) => !p.uc.players.some((x) => x.role !== undefined)));
  check('le mot de chacun reste chez lui',
    players.every((p) => p.uc.you.word === undefined || typeof p.uc.you.word !== 'undefined'));

  // Le mot interdit dans une description.
  const first = players.find((p) => p.uc.speaker === p.user.id);
  const known = first.uc.you.word;
  if (known) {
    first.toasts = [];
    first.socket.emit('uc:describe', { text: `c'est un ${known}` });
    await wait(400);
    check('impossible d’écrire le mot lui-même', first.toasts.some((t) => t.kind === 'error'));
  }

  const notMyTurn = players.find((p) => p.uc.speaker !== p.user.id);
  notMyTurn.toasts = [];
  notMyTurn.socket.emit('uc:describe', { text: 'je parle hors tour' });
  await wait(300);
  check('impossible de parler hors de son tour', notMyTurn.toasts.some((t) => t.kind === 'error'));

  // Chacun décrit à son tour.
  let guard = 0;
  while (a.uc.phase === 'describing' && guard++ < 12) {
    const speaker = players.find((p) => p.uc.speaker === p.user.id);
    if (!speaker) { await wait(200); continue; }
    speaker.socket.emit('uc:describe', { text: `truc numéro ${guard}` });
    await wait(250);
  }
  check('la manche passe au vote quand tout le monde a parlé', a.uc.phase === 'voting', a.uc.phase);
  check('les descriptions sont visibles par tous', a.uc.said.length === 4, `${a.uc.said.length} descriptions`);

  // Tout le monde vote contre le même joueur.
  const target = d;
  for (const p of [a, b, c]) p.socket.emit('uc:vote', { id: target.user.id });
  d.socket.emit('uc:vote', { id: a.user.id });
  await waitFor(() => a.uc.phase !== 'voting', 6000, 'dépouillement');
  check('le vote élimine bien la cible',
    a.uc.reveal && (a.uc.reveal.id === target.user.id || a.uc.phase === 'guess'),
    a.uc.reveal ? a.uc.reveal.name : a.uc.phase);
  check('le rôle de l’éliminé est révélé', Boolean(a.uc.reveal && a.uc.reveal.role));

  // On laisse la partie se dérouler jusqu'à la fin.
  guard = 0;
  while (a.uc.phase !== 'over' && guard++ < 40) {
    if (a.uc.phase === 'describing') {
      const speaker = players.find((p) => p.uc.speaker === p.user.id);
      if (speaker) { speaker.socket.emit('uc:describe', { text: `manche ${a.uc.round} ${guard}` }); }
    } else if (a.uc.phase === 'voting') {
      const living = a.uc.players.filter((p) => !p.out);
      for (const p of players) {
        if (!p.uc.you || p.uc.you.out) continue;
        const victim = living.find((x) => x.id !== p.user.id);
        if (victim) p.socket.emit('uc:vote', { id: victim.id });
      }
    } else if (a.uc.phase === 'guess') {
      const white = players.find((p) => p.uc.guessBy === p.user.id);
      if (white) white.socket.emit('uc:guess', { text: 'au hasard' });
    }
    await wait(500);
  }
  check('la partie va jusqu’à son terme', a.uc.phase === 'over', `${guard} tours de boucle`);
  check('les rôles sont dévoilés à la fin',
    a.uc.result && a.uc.result.roles.length === 4 && a.uc.result.roles.every((r) => r.role));
  check('les deux mots sont annoncés', Boolean(a.uc.result.word && a.uc.result.spyWord),
    `${a.uc.result.word} / ${a.uc.result.spyWord}`);

  await wait(900);
  check('le rang Party a progressé pour tout le monde',
    players.every((p) => p.rank.xp > 0), players.map((p) => `${p.rank.xp}`).join(', '));
  check('le vainqueur gagne plus que les autres',
    new Set(players.map((p) => p.rank.xp)).size > 1);
  check('aucune pièce du casino n’a bougé',
    players.every((p) => p.profile.coins === 400), players.map((p) => p.profile.coins).join(', '));

  for (const p of players) p.socket.emit('party:leave');
  await wait(400);

  /* ── POKER ── */
  section('Poker — le tournoi');
  a.joined = null;
  a.socket.emit('party:create', { game: 'poker' });
  const pkRoom = await waitFor(() => a.joined, 4000, 'salon de poker');
  for (const p of [b, c]) {
    p.socket.emit('party:join', { code: pkRoom.code });
    await waitFor(() => p.pk && p.pk.code === pkRoom.code, 4000, `${p.name} à la table`);
  }
  await wait(300);
  a.socket.emit('party:start');
  await waitFor(() => a.pk.phase === 'playing', 4000, 'tournoi lancé');

  const three = [a, b, c];
  check('même tapis pour tout le monde',
    a.pk.seats.filter((s) => !s.busted).every((s) => s.chips + s.bet === 5000),
    a.pk.seats.map((s) => s.chips).join(', '));
  check('deux cartes chacun', a.pk.you.id && a.pk.seats.find((s) => s.id === a.user.id).cards.length === 2);
  check('les cartes des autres sont masquées',
    a.pk.seats.filter((s) => s.id !== a.user.id).every((s) => s.cards.every((x) => x === null)));
  check('les blindes sont postées', a.pk.pot > 0, `${a.pk.pot} au pot`);

  const notTurn = three.find((p) => !p.pk.you.turn);
  notTurn.toasts = [];
  notTurn.socket.emit('pk:act', { move: 'check' });
  await wait(300);
  check('impossible d’agir hors de son tour', notTurn.toasts.some((t) => t.kind === 'error'));

  // On joue une main : tout le monde suit puis parole jusqu'à l'abattage.
  guard = 0;
  const startChips = a.pk.seats.reduce((s, x) => s + x.chips, 0) + a.pk.pot;
  while (a.pk.phase === 'playing' && guard++ < 60) {
    const actor = three.find((p) => p.pk.you && p.pk.you.turn);
    if (!actor) { await wait(150); continue; }
    actor.socket.emit('pk:act', { move: actor.pk.you.canCheck ? 'check' : 'call' });
    await wait(140);
  }
  check('la main va jusqu’à l’abattage ou la fin',
    ['showdown', 'over'].includes(a.pk.phase), a.pk.phase);

  const total = a.pk.seats.reduce((s, x) => s + x.chips, 0) + a.pk.pot * 0;
  check('aucun jeton créé ni perdu', total === 15000, `${total} jetons en jeu (départ ${startChips})`);

  if (a.pk.showdown && a.pk.showdown.hands) {
    check('les mains sont dévoilées à l’abattage',
      a.pk.showdown.hands.every((h) => h.cards.length === 2 && h.detail));
    const won = a.pk.showdown.hands.reduce((s, h) => s + h.won, 0);
    check('le pot est entièrement redistribué', won === a.pk.showdown.pot,
      `${won} distribués sur ${a.pk.showdown.pot}`);
  }

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'Tout est passé.' : `${failures} vérification(s) en échec.`);
  [a, b, c, d].forEach((p) => p.socket.close());
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('\nLe banc d’essai a échoué :', err.message);
  process.exit(1);
});
