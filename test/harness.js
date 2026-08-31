'use strict';
/**
 * Banc d'essai : simule plusieurs joueurs connectés en Socket.IO et joue
 * une partie complète de chaque mini-jeu, plus la ferme et le classement.
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

async function makeGuest(name) {
  const res = await fetch(`${BASE}/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  const cookie = raw.map((c) => c.split(';')[0]).join('; ');
  const socket = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
  const player = { name, socket, cookie, state: null, game: null, farm: null, profile: null, events: [] };

  socket.on('room:state', ({ room, you, game }) => {
    player.state = room;
    player.me = you;
    player.game = game;
  });
  socket.on('me', ({ user, profile }) => {
    player.user = user;
    player.profile = profile;
    player.me = user.id;
  });
  socket.on('profile:update', (profile) => {
    player.profile = profile;
  });
  socket.on('farm:state', (payload) => {
    player.farm = payload.farm;
    player.lastResult = payload.result;
    if (payload.me) player.profile = payload.me;
  });
  socket.onAny((ev, payload) => {
    if (!['room:state', 'farm:state'].includes(ev)) player.events.push([ev, payload]);
  });

  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });
  await until(() => player.profile, 5000, 'profil chargé');
  return player;
}

async function until(fn, timeout = 15000, label = '') {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await wait(100);
  }
  throw new Error('délai dépassé : ' + label);
}

/* ══════════════ 1 — Quiz en QCM ══════════════ */

async function testQuizChoice() {
  section('Quiz culture G — mode QCM');
  const host = await makeGuest('Hote');
  const p2 = await makeGuest('Bob');

  host.socket.emit('room:create');
  await until(() => host.state, 5000, 'salon');
  const code = host.state.code;
  check('salon créé', /^[A-Z]{4}$/.test(code), code);

  p2.socket.emit('room:join', { code });
  await until(() => host.state.players.length === 2, 5000, '2 joueurs');

  host.socket.emit('settings:update', {
    game: 'quiz',
    patch: { rounds: 3, answerMode: 'choice', difficulty: 'nightmare' },
  });
  await wait(300);
  host.socket.emit('game:start', { key: 'quiz' });

  await until(() => host.game && host.game.phase === 'playing', 8000, 'phase de jeu');
  check('mode QCM actif', host.game.answerMode === 'choice');
  check('exactement 4 propositions', host.game.choices.length === 4, String(host.game.choices.length));
  check('propositions toutes différentes', new Set(host.game.choices).size === 4);
  check('la bonne réponse est cachée', host.game.correctIndex === null);
  check('difficulté appliquée', host.game.difficulty.name === 'NIGHTMARE', host.game.difficulty.name);

  const { QUESTIONS } = require('../server/data/questions');
  const q = QUESTIONS.find((x) => x.q === host.game.question);
  check('question issue de la banque', Boolean(q));
  check('la bonne réponse est parmi les propositions', host.game.choices.includes(q.a[0]));

  const good = host.game.choices.indexOf(q.a[0]);
  const bad = (good + 1) % 4;

  host.socket.emit('game:action', { action: 'pick', payload: { index: good } });
  await until(() => host.game.yourResult, 4000, 'réponse enregistrée');
  check('bonne réponse acceptée', host.game.yourResult.correct === true);
  check('points multipliés par la difficulté', host.game.yourResult.points > 120, String(host.game.yourResult.points));

  // second clic ignoré : un seul essai
  const pointsBefore = host.state.players.find((p) => p.name === 'Hote').score;
  host.socket.emit('game:action', { action: 'pick', payload: { index: good } });
  await wait(400);
  check('un seul essai autorisé', host.state.players.find((p) => p.name === 'Hote').score === pointsBefore);

  p2.socket.emit('game:action', { action: 'pick', payload: { index: bad } });
  await until(() => p2.game.yourResult, 4000, 'mauvaise réponse');
  check('mauvaise réponse refusée', p2.game.yourResult.correct === false);
  check('mauvaise réponse ne rapporte rien', p2.game.yourResult.points === 0);

  await until(() => host.game.phase === 'results', 90000, 'fin de partie');
  check('partie terminée', host.game.phase === 'results');

  host.socket.emit('game:stop');
  await until(() => !host.game, 5000, 'retour au salon');
  await until(() => host.profile.xp > 0, 6000, 'XP versée');
  check('XP créditée au profil', host.profile.xp > 0, host.profile.xp + ' XP');

  [host, p2].forEach((p) => p.socket.close());
  return host;
}

/* ══════════════ 2 — Blind test en QCM ══════════════ */

async function testBlindtestChoice() {
  section('Blind Test — mode QCM');
  const host = await makeGuest('DJ');
  host.socket.emit('room:create');
  await until(() => host.state, 5000, 'salon');

  // le serveur de test simule les métadonnées YouTube (voir test/stub-youtube.js)
  host.socket.emit('blindtest:import', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  const ok = await until(() => host.state.hasPlaylist, 12000, 'playlist importée').catch(() => false);
  if (!ok) {
    console.log('  ⏭  playlist indisponible (serveur sans stub YouTube) — test QCM du blind test ignoré');
    host.socket.close();
    return;
  }

  host.socket.emit('settings:update', {
    game: 'blindtest',
    patch: { rounds: 2, answerMode: 'choice', difficulty: 'rookie' },
  });
  await wait(300);
  host.socket.emit('game:start', { key: 'blindtest' });

  await until(() => host.game && host.game.phase === 'playing', 10000, 'manche en cours');
  check('mode QCM actif', host.game.answerMode === 'choice');
  check('4 propositions « Artiste — Titre »', host.game.choices.length === 4, host.game.choices[0]);
  check('aucun doublon dans les propositions', new Set(host.game.choices).size === 4);
  check('la bonne réponse reste cachée', host.game.correctIndex === null);
  check('difficulté ROOKIE = 40 s', Math.round((host.game.deadline - host.game.serverNow) / 1000) === 40);

  host.socket.emit('game:action', { action: 'pick', payload: { index: 0 } });
  await until(() => host.game.yourResult, 4000, 'réponse');
  check('réponse enregistrée', host.game.yourResult !== null);

  await until(() => host.game.phase === 'reveal', 50000, 'révélation');
  check('la bonne réponse est révélée', Number.isInteger(host.game.correctIndex));
  check('titre révélé', Boolean(host.game.revealed && host.game.revealed.title));

  host.socket.emit('game:stop');
  await wait(500);
  host.socket.close();
}

/* ══════════════ 3 — PIXEL FARM ══════════════ */

async function testFarm() {
  section('PIXEL FARM');
  const p = await makeGuest('Fermier');

  p.socket.emit('farm:open');
  await until(() => p.farm, 5000, 'ferme ouverte');
  check('6 parcelles au départ', p.farm.plots.length === 6, String(p.farm.plots.length));
  check('pièces de départ', p.farm.coins === 40, String(p.farm.coins));
  check('réservoir plein', p.farm.water === p.farm.waterMax);
  check('graines avancées verrouillées', p.farm.seeds.find((s) => s.id === 'crystal').locked === true);

  // planter
  p.socket.emit('farm:action', { action: 'plant', payload: { plot: 0, seed: 'wheat' } });
  await until(() => p.farm.plots[0].seed === 'wheat', 4000, 'blé planté');
  check('blé planté', p.farm.plots[0].seed === 'wheat');
  check('coût débité', p.farm.coins === 38, String(p.farm.coins));

  // planter sur une parcelle occupée doit échouer
  p.socket.emit('farm:action', { action: 'plant', payload: { plot: 0, seed: 'wheat' } });
  await wait(400);
  check('parcelle occupée refusée', p.lastResult && p.lastResult.ok === false, p.lastResult && p.lastResult.message);

  // récolter trop tôt doit échouer
  p.socket.emit('farm:action', { action: 'harvest', payload: { plot: 0 } });
  await wait(400);
  check('récolte prématurée refusée', p.lastResult.ok === false, p.lastResult.message);

  // arroser jusqu'à maturité (chaque clic avance de 4 s, il faut ~30 s)
  const waterBefore = p.farm.water;
  for (let i = 0; i < 9; i++) {
    p.socket.emit('farm:action', { action: 'water', payload: { plot: 0 } });
    await wait(120);
  }
  check('l’eau est consommée par les clics', p.farm.water < waterBefore, `${waterBefore} → ${p.farm.water}`);
  await until(() => p.farm.plots[0].progress >= 1, 6000, 'blé mûr');
  check('l’arrosage accélère la pousse', p.farm.plots[0].progress >= 1);

  const coinsBefore = p.farm.coins;
  const xpBefore = p.profile.xp;
  p.socket.emit('farm:action', { action: 'harvest', payload: { plot: 0 } });
  await until(() => p.farm.coins > coinsBefore, 4000, 'récolte');
  check('récolte créditée en pièces', p.farm.coins === coinsBefore + 8, String(p.farm.coins));
  await until(() => p.profile.xp > xpBefore, 4000, 'XP de récolte');
  check('récolte créditée en XP', p.profile.xp === xpBefore + 4, `${xpBefore} → ${p.profile.xp}`);
  check('compteur de récoltes', p.farm.harvested === 1);

  // améliorations : refusée sans pièces, acceptée avec
  p.socket.emit('farm:action', { action: 'upgrade', payload: { id: 'can' } });
  await wait(400);
  check('amélioration refusée sans pièces', p.lastResult.ok === false, p.lastResult.message);

  // parcelle supplémentaire hors budget
  p.socket.emit('farm:action', { action: 'buy-plot', payload: {} });
  await wait(400);
  check('parcelle refusée sans pièces', p.lastResult.ok === false);

  // action inconnue
  p.socket.emit('farm:action', { action: 'triche', payload: {} });
  await wait(400);
  check('action inconnue rejetée', p.lastResult.ok === false);

  p.socket.close();
}

/* ══════════════ 4 — Classement ══════════════ */

async function testLeaderboard() {
  section('Classement général');
  const { leaderboard } = await fetch(`${BASE}/api/leaderboard?limit=10`).then((r) => r.json());
  check('le classement répond', Array.isArray(leaderboard));
  check('il contient les joueurs des tests', leaderboard.length > 0, leaderboard.length + ' joueurs');
  if (leaderboard.length) {
    const first = leaderboard[0];
    check('chaque ligne a rang, niveau et titre', Boolean(first.rank && first.level && first.title), `${first.name} LV${first.level} ${first.title}`);
    check('trié par XP décroissante', leaderboard.every((p, i) => i === 0 || leaderboard[i - 1].xp >= p.xp));
  }
}

/* ══════════════ 5 — Undercover (inchangé) ══════════════ */

async function testUndercover() {
  section('Undercover');
  const players = [];
  for (const n of ['Alice', 'Bruno', 'Chloe', 'David']) players.push(await makeGuest(n));
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

  await until(() => host.game && host.game.phase === 'roles', 6000, 'rôles');
  const roles = players.map((p) => p.game.you.role);
  check('exactement 1 undercover', roles.filter((r) => r === 'undercover').length === 1);
  const civilWords = players.filter((p) => p.game.you.role === 'civil').map((p) => p.game.you.word);
  check('les civils partagent le même mot', new Set(civilWords).size === 1, civilWords[0]);
  check('personne ne voit le rôle des autres', players[0].game.players.every((p) => p.role === null));

  await until(() => host.game.phase === 'describe', 12000, 'description');
  for (let i = 0; i < 4; i++) {
    await until(() => players.some((p) => p.game && p.game.you.isSpeaker), 20000, 'tour ' + i);
    const speaker = players.find((p) => p.game.you.isSpeaker);
    speaker.socket.emit('game:action', { action: 'describe', payload: { word: 'mot' + i } });
    await wait(900);
  }

  await until(() => host.game.phase === 'vote', 20000, 'vote');
  check('4 descriptions enregistrées', host.game.descriptions.length === 4);

  const target = players.find((p) => p.game.you.role === 'undercover');
  for (const p of players) {
    if (p !== target) p.socket.emit('game:action', { action: 'vote', payload: { targetId: target.me } });
  }
  target.socket.emit('game:action', { action: 'vote', payload: { targetId: players.find((p) => p !== target).me } });

  await until(() => host.game.phase === 'over', 25000, 'fin');
  check('les civils gagnent', host.game.winner === 'civils', host.game.winner);
  check('les mots sont révélés', Boolean(host.game.words && host.game.words.civil));

  host.socket.emit('game:stop');
  await wait(800);
  players.forEach((p) => p.socket.close());
}

/* ══════════════ 6 — Génération des propositions ══════════════ */

function testChoiceGeneration() {
  section('Génération des propositions (hors ligne)');
  const { quizChoices, numericDecoys } = require('../server/choices');
  const { QUESTIONS } = require('../server/data/questions');

  let allFour = true;
  let allContainAnswer = true;
  let allUnique = true;
  for (const q of QUESTIONS) {
    const c = quizChoices(q, QUESTIONS);
    if (c.length !== 4) allFour = false;
    if (!c.includes(q.a[0])) allContainAnswer = false;
    if (new Set(c).size !== 4) allUnique = false;
  }
  check('les 150 questions produisent 4 propositions', allFour);
  check('la bonne réponse y figure toujours', allContainAnswer);
  check('aucun doublon', allUnique);

  const years = numericDecoys(1989, 3);
  check('leurres d’année plausibles', years.every((y) => Math.abs(Number(y) - 1989) <= 12), years.join(', '));
  const small = numericDecoys(8, 3);
  check('leurres de petits nombres plausibles', small.every((n) => Number(n) > 0 && Number(n) <= 12), small.join(', '));
  const big = numericDecoys(300000, 3);
  check('leurres de grands nombres arrondis', big.every((n) => Number(n) % 1000 === 0), big.join(', '));
}

/* ══════════════ Exécution ══════════════ */

(async () => {
  try {
    testChoiceGeneration();
    await testQuizChoice();
    await testBlindtestChoice();
    await testFarm();
    await testUndercover();
    await testLeaderboard();
  } catch (err) {
    console.error('\n💥 ' + err.message);
    failures++;
  }
  console.log(failures === 0 ? '\n🎉 Tous les tests passent.\n' : `\n⚠️  ${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
