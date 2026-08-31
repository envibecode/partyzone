'use strict';
/**
 * Banc d'essai : simule plusieurs joueurs connectés en Socket.IO et joue
 * une partie complète de chaque mini-jeu. Lancer avec `node test/harness.js`
 * pendant que le serveur tourne sur le port 3000.
 */
const { io } = require('socket.io-client');

const BASE = process.env.BASE || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
}

async function makeGuest(name) {
  const res = await fetch(`${BASE}/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  const cookie = raw.map((c) => c.split(';')[0]).join('; ');
  const socket = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
  const player = { name, socket, state: null, game: null, events: [] };
  socket.on('room:state', ({ room, you, game }) => {
    player.state = room;
    player.me = you;
    player.game = game;
  });
  socket.on('toast', (t) => player.events.push(['toast', t.message]));
  socket.onAny((ev, payload) => {
    if (ev !== 'room:state') player.events.push([ev, payload]);
  });
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });
  return player;
}

async function until(fn, timeout = 15000, label = '') {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await wait(120);
  }
  throw new Error('délai dépassé : ' + label);
}

/* ══════════════ Scénario 1 — Quiz ══════════════ */

async function testQuiz() {
  console.log('\n▶ Quiz culture G');
  const host = await makeGuest('Hôte');
  const p2 = await makeGuest('Bob');
  const p3 = await makeGuest('Clara');

  host.socket.emit('room:create');
  await until(() => host.state, 5000, 'salon créé');
  const code = host.state.code;
  check('salon créé avec un code à 4 lettres', /^[A-Z]{4}$/.test(code), code);

  p2.socket.emit('room:join', { code });
  p3.socket.emit('room:join', { code });
  await until(() => host.state.players.length === 3, 5000, '3 joueurs');
  check('3 joueurs dans le salon', host.state.players.length === 3);
  check('l’hôte est bien le créateur', host.state.hostId === host.me);

  // un non-hôte ne peut pas lancer la partie
  p2.socket.emit('game:start', { key: 'quiz' });
  await wait(400);
  check('un joueur non-hôte ne peut pas lancer', !host.game);

  host.socket.emit('settings:update', { game: 'quiz', patch: { rounds: 3, roundSeconds: 10 } });
  await wait(300);
  host.socket.emit('game:start', { key: 'quiz' });

  await until(() => host.game && host.game.phase === 'playing', 8000, 'phase de jeu');
  check('la partie démarre', host.game.key === 'quiz');
  check('3 questions configurées', host.game.totalRounds === 3, String(host.game.totalRounds));
  check('la réponse est masquée', /·/.test(host.game.hint), host.game.hint);

  // Bob répond juste (on triche : on lit la réponse dans la banque)
  const { QUESTIONS } = require('../server/data/questions');
  const q = QUESTIONS.find((x) => x.q === host.game.question);
  check('question issue de la banque', Boolean(q));

  p2.socket.emit('game:action', { action: 'guess', payload: { text: q.a[0] } });
  await until(() => p2.game && p2.game.solved, 5000, 'bonne réponse');
  check('la bonne réponse est acceptée', p2.game.solved);
  const bob = () => host.state.players.find((p) => p.name === 'Bob');
  check('Bob marque des points', bob().score > 0, String(bob().score));

  // réponse avec une faute de frappe + accents
  const typo = q.a[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  p3.socket.emit('game:action', { action: 'guess', payload: { text: typo } });
  await until(() => p3.game && p3.game.solved, 5000, 'tolérance orthographique');
  check('tolérance casse/accents', p3.game.solved);

  const first = host.game.board[0];
  check('Bob est premier au classement de la manche', first && first.name === 'Bob');

  // on laisse la partie se terminer
  await until(() => host.game && host.game.phase === 'results', 90000, 'fin de partie');
  check('la partie se termine sur les résultats', host.game.phase === 'results');
  check('historique complet', host.game.history.length === 3, String(host.game.history.length));

  host.socket.emit('game:stop');
  await until(() => !host.game, 5000, 'retour au salon');
  check('retour au salon après la partie', host.game === null);
  check('les points sont cumulés sur la session', host.state.players.some((p) => p.totalScore > 0));

  [host, p2, p3].forEach((p) => p.socket.close());
}

/* ══════════════ Scénario 2 — Undercover ══════════════ */

async function testUndercover() {
  console.log('\n▶ Undercover');
  const players = [];
  for (const n of ['Alice', 'Bob', 'Clara', 'David']) players.push(await makeGuest(n));
  const [host] = players;

  host.socket.emit('room:create');
  await until(() => host.state, 5000, 'salon');
  const code = host.state.code;
  for (const p of players.slice(1)) p.socket.emit('room:join', { code });
  await until(() => host.state.players.length === 4, 5000, '4 joueurs');

  host.socket.emit('settings:update', {
    game: 'undercover',
    patch: { undercoverCount: 1, mrWhite: 0, descriptionSeconds: 15, voteSeconds: 15 },
  });
  await wait(300);
  host.socket.emit('game:start', { key: 'undercover' });

  await until(() => host.game && host.game.phase === 'roles', 6000, 'distribution des rôles');
  const roles = players.map((p) => p.game.you.role);
  check('un rôle attribué à chacun', roles.every(Boolean), roles.join(', '));
  check('exactement 1 undercover', roles.filter((r) => r === 'undercover').length === 1);
  check('3 civils', roles.filter((r) => r === 'civil').length === 3);

  const words = players.map((p) => p.game.you.word);
  const civilWords = players.filter((p) => p.game.you.role === 'civil').map((p) => p.game.you.word);
  check('les civils partagent le même mot', new Set(civilWords).size === 1, civilWords[0]);
  const underWord = players.find((p) => p.game.you.role === 'undercover').game.you.word;
  check('l’undercover a un mot différent', underWord !== civilWords[0], `${civilWords[0]} / ${underWord}`);
  check('personne ne voit le rôle des autres', players[0].game.players.every((p) => p.role === null));

  await until(() => host.game.phase === 'describe', 12000, 'phase de description');
  check('phase de description atteinte', host.game.phase === 'describe');

  // chaque joueur parle à son tour
  for (let i = 0; i < 4; i++) {
    await until(() => players.some((p) => p.game && p.game.you.isSpeaker), 20000, 'tour de parole ' + i);
    const speaker = players.find((p) => p.game.you.isSpeaker);
    speaker.socket.emit('game:action', { action: 'describe', payload: { word: 'mot' + i } });
    await wait(900);
  }

  await until(() => host.game.phase === 'vote', 20000, 'phase de vote');
  check('phase de vote atteinte', host.game.phase === 'vote');
  check('4 descriptions enregistrées', host.game.descriptions.length === 4, String(host.game.descriptions.length));

  // l'auto-vote est refusé
  players[0].socket.emit('game:action', { action: 'vote', payload: { targetId: players[0].me } });
  await wait(400);
  check('l’auto-vote est refusé', !players[0].game.you.hasVoted);

  // tout le monde vote contre l'undercover
  const target = players.find((p) => p.game.you.role === 'undercover');
  for (const p of players) {
    if (p !== target) p.socket.emit('game:action', { action: 'vote', payload: { targetId: target.me } });
  }
  target.socket.emit('game:action', { action: 'vote', payload: { targetId: players.find((p) => p !== target).me } });

  await until(() => host.game.phase === 'result' || host.game.phase === 'over', 20000, 'résultat du vote');
  check('un joueur est éliminé', host.game.lastResult && host.game.lastResult.eliminated);
  check('l’undercover est démasqué', host.game.lastResult.eliminated.role === 'undercover');

  await until(() => host.game.phase === 'over', 20000, 'fin de partie');
  check('les civils gagnent', host.game.winner === 'civils', host.game.winner);
  check('les mots sont révélés', Boolean(host.game.words && host.game.words.civil));
  check('les civils marquent des points', host.state.players.filter((p) => p.score > 0).length === 3);

  players.forEach((p) => p.socket.close());
}

/* ══════════════ Scénario 3 — Blind Test (parsing + garde-fous) ══════════════ */

async function testBlindTest() {
  console.log('\n▶ Blind Test');
  const host = await makeGuest('DJ');
  host.socket.emit('room:create');
  await until(() => host.state, 5000, 'salon');

  host.socket.emit('game:start', { key: 'blindtest' });
  await until(() => host.events.some(([e, p]) => e === 'toast' && /playlist/i.test(p.message || p)), 5000, 'refus sans playlist');
  check('refuse de démarrer sans playlist', !host.game);

  host.socket.emit('blindtest:import', { url: 'https://example.com/pas-youtube' });
  await wait(500);
  check('rejette un lien non YouTube', host.events.some(([e, p]) => e === 'toast' && /non reconnu/i.test((p && p.message) || '')));

  // Vérification du moteur d'appariement hors ligne
  const { parseTrack } = require('../server/youtube');
  const { matchesAny } = require('../server/util');
  const t1 = parseTrack('Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams', 'DaftPunkVEVO');
  check('artiste extrait', t1.artist === 'Daft Punk', t1.artist);
  check('titre nettoyé', /get lucky/i.test(t1.title), t1.title);
  check('faute de frappe tolérée', matchesAny('get lucki', t1.acceptTitles));
  check('réponse fausse rejetée', !matchesAny('around the world', t1.acceptTitles));

  const t2 = parseTrack('Stromae — Alors on danse [Clip Officiel]', 'Stromae');
  check('tiret cadratin géré', t2.artist === 'Stromae' && /alors on danse/i.test(t2.title), `${t2.artist} / ${t2.title}`);

  const t3 = parseTrack('Bohemian Rhapsody', 'Queen Official');
  check('repli sur la chaîne quand il n’y a pas de séparateur', t3.artist === 'Queen', t3.artist);

  host.socket.close();
}

(async () => {
  try {
    await testQuiz();
    await testUndercover();
    await testBlindTest();
  } catch (err) {
    console.error('\n💥 ' + err.message);
    failures++;
  }
  console.log(failures === 0 ? '\n🎉 Tous les tests passent.\n' : `\n⚠️  ${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
