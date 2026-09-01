'use strict';
require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const auth = require('./auth');
const store = require('./store');
const fairness = require('./fair');
const vault = require('./vault');
const clicker = require('./clicker');
const plinko = require('./plinko');
const blackjack = require('./blackjack');
const { Roulette } = require('./roulette');
const { Presence } = require('./presence');
const { Chat } = require('./chat');
const admin = require('./admin');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
const presence = new Presence(io);
const chat = new Chat(io);

app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', extensions: ['html'] }));

auth.register(app);

/* ─── API ──────────────────────────────────────────────── */

app.get('/api/admin-config', (req, res) => res.json({ keyConfigured: admin.adminKeyConfigured() }));

app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(3, Number(req.query.limit) || 12));
    const sort = req.query.sort === 'xp' ? 'xp' : 'coins';
    res.json({ leaderboard: await store.leaderboard(limit, sort), sort });
  } catch (err) {
    console.error('[leaderboard]', err.message);
    res.status(500).json({ leaderboard: [] });
  }
});

app.get('/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

/* ─── Roulette partagée ────────────────────────────────── */

const roulette = new Roulette(io, store);

/** Pousse un profil mis à jour vers toutes les sessions du joueur. */
function pushProfile(profile) {
  const entry = presence.users.get(profile.id);
  if (!entry) return;
  entry.profile = profile;
  for (const socketId of entry.sockets) {
    io.to(socketId).emit('profile:update', store.publicProfile(profile));
  }
}
roulette.onProfile = pushProfile;

/* ─── Les tables ouvertes, pour le carrousel du lobby ──── */

function lobbyTables() {
  return [...blackjack.tables.values()].map((table) => {
    const host = table.seats.find((s) => s.id === table.hostId);
    const humans = table.seats.filter((s) => !s.isBot);
    return {
      code: table.code,
      host: host ? host.name : null,
      seats: table.seats.length,
      seatsMax: blackjack.SEATS,
      bots: table.seats.filter((s) => s.isBot).length,
      phase: table.phase,
      hand: table.hand,
      minBet: blackjack.MIN_BET,
      // Les têtes affichées sur la vignette.
      faces: humans.slice(0, 4).map((s) => ({ name: s.name, avatar: s.avatar })),
      more: Math.max(0, humans.length - 4),
    };
  });
}

/** Prévient tout le monde que la liste des tables a bougé. */
function broadcastLobby() {
  io.emit('bj:lobby', { tables: lobbyTables() });
  refreshAdmins();
}

/**
 * Le panel d'administration se met à jour tout seul.
 *
 * Les administrateurs en train de le regarder sont dans le salon 'admin' ;
 * dès que quelque chose bouge sur le site — une table ouverte, un joueur
 * qui arrive — on leur renvoie un état frais. On regroupe les appels pour
 * ne pas recalculer la liste des profils dix fois par seconde.
 */
let adminTimer = null;
function refreshAdmins() {
  if (adminTimer) return;
  adminTimer = setTimeout(async () => {
    adminTimer = null;
    const room = io.sockets.adapter.rooms.get('admin');
    if (!room || !room.size) return;
    try {
      const [snap, list] = await Promise.all([
        admin.snapshot(presence),
        admin.players({ sort: 'coins' }),
      ]);
      io.to('admin').emit('admin:state', { ...snap, ...list, live: true });
    } catch (err) {
      console.error('[admin] rafraîchissement impossible :', err.message);
    }
  }, 700);
}

/* ─── Socket.IO ────────────────────────────────────────── */

io.use((socket, next) => {
  const user = auth.userFromCookieHeader(socket.handshake.headers.cookie);
  if (!user) return next(new Error('non_authentifie'));
  socket.data.user = user;
  next();
});

io.on('connection', async (socket) => {
  const user = socket.data.user;

  let profile;
  try {
    profile = await store.loadProfile(user);
  } catch (err) {
    console.error('[store] chargement du profil impossible :', err.message);
    socket.emit('toast', { message: 'Progression indisponible pour le moment.', kind: 'error' });
    return;
  }

  if (profile.banned) {
    socket.emit('kicked', { reason: profile.banReason || 'Ce compte est banni.' });
    return socket.disconnect(true);
  }

  socket.data.profile = profile;
  presence.join(socket, user, profile);
  refreshAdmins();

  const sendMe = () => socket.emit('me', { user, profile: store.publicProfile(profile) });
  const save = () => store.saveProfile(profile).catch((e) => console.error('[store]', e.message));

  sendMe();
  socket.emit('online:list', { online: presence.list() });
  socket.emit('chat:history', { messages: chat.history(), maxLength: 240 });
  socket.emit('bj:lobby', { tables: lobbyTables() });

  /** Écriture différée : utile pour les rafales de clics. */
  let saveTimer = null;
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 900);
  };

  /* ══════════ LA MINE ══════════ */

  socket.on('mine:open', async () => {
    presence.setStatus(user.id, 'mine');
    const idle = clicker.collect(profile);
    if (idle.coins > 0) await save();
    socket.emit('mine:state', { mine: clicker.view(profile), me: store.publicProfile(profile), idle });
  });

  socket.on('mine:click', ({ count } = {}) => {
    const result = clicker.click(profile, count);
    saveSoon();
    socket.emit('mine:hit', result);
    socket.emit('profile:update', store.publicProfile(profile));
  });

  socket.on('mine:buy', async ({ id } = {}) => {
    clicker.collect(profile);
    const result = clicker.buy(profile, id);
    if (result.ok) await save();
    socket.emit('mine:state', { mine: clicker.view(profile), me: store.publicProfile(profile), result });
    if (result.ok) socket.emit('profile:update', store.publicProfile(profile));
  });

  /* ══════════ PLINKO ══════════ */

  socket.on('plinko:open', () => {
    presence.setStatus(user.id, 'plinko');
    socket.emit('plinko:state', { config: plinko.view(), me: store.publicProfile(profile) });
  });

  socket.on('plinko:play', async (payload = {}) => {
    const result = plinko.play(profile, payload);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });

    store.recordPlay(profile, result.staked, result.payout);
    await save();

    socket.emit('plinko:result', { ...result, me: store.publicProfile(profile) });
    socket.emit('profile:update', store.publicProfile(profile));

    const best = result.drops.reduce((m, d) => Math.max(m, d.multiplier), 0);
    if (best >= 50) {
      io.emit('feed', {
        name: user.name,
        avatar: user.avatar,
        game: 'Plinko',
        text: `×${best}`,
        amount: result.payout,
      });
      chat.system(`${user.name} touche ×${best} au Plinko et repart avec ${result.payout} 🪙 !`, 'win');
    }
  });

  /* ══════════ ROULETTE ══════════ */

  socket.on('roulette:join', () => {
    presence.setStatus(user.id, 'roulette');
    socket.join(roulette.room);
    socket.emit('roulette:state', roulette.publicState(user.id));
  });

  socket.on('roulette:leave', () => socket.leave(roulette.room));

  socket.on('roulette:bet', async (payload = {}) => {
    const result = await roulette.place(profile, payload);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });
    await save();
    socket.emit('profile:update', store.publicProfile(profile));
  });

  socket.on('roulette:rebet', async () => {
    const result = await roulette.rebet(profile);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });
    await save();
    socket.emit('profile:update', store.publicProfile(profile));
    socket.emit('toast', { message: `${result.count} mise(s) reposée(s).`, kind: 'success' });
  });

  /* Les configurations de mises vivent dans le profil : elles suivent le
     compte d'un appareil à l'autre. */
  socket.on('roulette:setups', () => {
    socket.emit('roulette:setups', { setups: profile.setups || [] });
  });

  socket.on('roulette:setup-save', async ({ name } = {}) => {
    const entry = roulette.publicState(user.id).you;
    if (!entry || !entry.bets.length) {
      return socket.emit('toast', { message: 'Pose d’abord des jetons sur le tapis.', kind: 'error' });
    }
    profile.setups = (profile.setups || []).filter((s) => s.name !== name).slice(0, 7);
    profile.setups.unshift({
      name: String(name || 'Sans nom').trim().slice(0, 24) || 'Sans nom',
      bets: entry.bets.map((b) => ({ type: b.type, value: b.value, amount: b.amount })),
      total: entry.staked,
    });
    await save();
    socket.emit('roulette:setups', { setups: profile.setups });
    socket.emit('toast', { message: 'Configuration enregistrée.', kind: 'success' });
  });

  socket.on('roulette:setup-apply', async ({ name } = {}) => {
    const setup = (profile.setups || []).find((s) => s.name === name);
    if (!setup) return socket.emit('toast', { message: 'Configuration introuvable.', kind: 'error' });
    const result = await roulette.applySetup(profile, setup.bets);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });
    await save();
    socket.emit('profile:update', store.publicProfile(profile));
  });

  socket.on('roulette:setup-delete', async ({ name } = {}) => {
    profile.setups = (profile.setups || []).filter((s) => s.name !== name);
    await save();
    socket.emit('roulette:setups', { setups: profile.setups });
  });

  socket.on('roulette:clear', async () => {
    const result = await roulette.clear(profile);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });
    await save();
    socket.emit('profile:update', store.publicProfile(profile));
  });

  /* ══════════ BLACKJACK ══════════ */

  function currentTable() {
    return socket.data.tableCode ? blackjack.getTable(socket.data.tableCode) : null;
  }

  function joinTable(table) {
    const seat = table.addPlayer(user, profile, socket.id);
    if (!seat) {
      socket.emit('toast', { message: 'La table est pleine (5 sièges).', kind: 'error' });
      return false;
    }
    socket.join('bj:' + table.code);
    socket.data.tableCode = table.code;
    table.profiles.set(user.id, profile);
    presence.setStatus(user.id, 'blackjack');
    table.say('Croupier', `${user.name} rejoint la table.`);
    socket.emit('bj:joined', { code: table.code });
    table.broadcast();
    broadcastLobby();
    return true;
  }

  function leaveTable() {
    const table = currentTable();
    if (!table) return;
    socket.leave('bj:' + table.code);
    socket.data.tableCode = null;
    table.profiles.delete(user.id);
    table.removePlayer(user.id);
    table.say('Croupier', `${user.name} quitte la table.`);
    presence.setStatus(user.id, 'home');
    table.broadcast();
    broadcastLobby();
  }

  socket.on('bj:create', () => {
    leaveTable();
    const table = blackjack.createTable(io, store);
    table.hostId = user.id;
    table.onProfile = pushProfile;
    table.onSettle = async (t) => {
      for (const seat of t.seats) {
        if (seat.isBot || !seat.lastResult) continue;
        const p = t.profiles.get(seat.id);
        if (!p) continue;
        store.recordPlay(p, seat.lastResult.staked, seat.lastResult.payout);
        await store.saveProfile(p).catch(() => {});
        pushProfile(p);
      }
    };
    joinTable(table);
  });

  socket.on('bj:join', ({ code } = {}) => {
    const table = blackjack.getTable(code);
    if (!table) return socket.emit('toast', { message: 'Table introuvable. Vérifie le code.', kind: 'error' });
    leaveTable();
    joinTable(table);
  });

  socket.on('bj:leave', () => leaveTable());

  socket.on('bj:lobby', () => socket.emit('bj:lobby', { tables: lobbyTables() }));

  socket.on('bj:bet', async ({ amount, side } = {}) => {
    const table = currentTable();
    if (!table) return;
    const result = await table.setBet(profile, amount, side);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });
    await save();
    socket.emit('profile:update', store.publicProfile(profile));
  });

  socket.on('bj:move', async ({ move } = {}) => {
    const table = currentTable();
    if (!table) return;
    const result = table.act(user.id, move);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });
    await save();
    socket.emit('profile:update', store.publicProfile(profile));
  });

  socket.on('bj:auto', ({ on } = {}) => {
    const table = currentTable();
    if (!table) return;
    const result = table.setAuto(user.id, on);
    socket.emit('toast', { message: result.message, kind: result.ok ? 'success' : 'error' });
  });

  socket.on('bj:say', ({ text } = {}) => {
    const table = currentTable();
    if (!table) return;
    const clean = String(text || '').trim().slice(0, 160);
    if (!clean) return;
    table.say(user.name, clean);
    table.broadcast();
  });

  /* ══════════ MEMEVAULT ══════════ */

  function vaultPayload(extra = {}) {
    return { vault: vault.view(profile), me: store.publicProfile(profile), ...extra };
  }

  socket.on('vault:open', () => {
    presence.setStatus(user.id, 'vault');
    socket.emit('vault:state', vaultPayload());
  });

  socket.on('vault:pull', async ({ caseId, count } = {}) => {
    const result = vault.open(profile, caseId, count);
    if (!result.ok) return socket.emit('vault:state', vaultPayload({ result }));

    store.grantXp(profile, result.xp);
    profile.stats.cases += result.pulls.length;
    await save();

    socket.emit('vault:state', vaultPayload({ result }));
    socket.emit('profile:update', store.publicProfile(profile));

    for (const pull of result.pulls.filter((p) => ['mythic', 'cursed'].includes(p.r))) {
      io.emit('feed', {
        name: user.name,
        avatar: user.avatar,
        game: 'MemeVault',
        text: `${pull.emoji} ${pull.name}`,
        rarity: pull.rarity,
        color: pull.color,
      });
      chat.system(`${user.name} sort ${pull.emoji} ${pull.name} — ${pull.rarity} !`, 'drop');
    }
  });

  socket.on('vault:sell', async () => {
    const result = vault.sellDuplicates(profile);
    if (result.ok) await save();
    socket.emit('vault:state', vaultPayload({ result }));
    if (result.ok) socket.emit('profile:update', store.publicProfile(profile));
  });

  /* ══════════ ÉQUITÉ VÉRIFIABLE ══════════ */

  socket.on('fair:rotate', async ({ clientSeed } = {}) => {
    fairness.rotate(profile.fair, clientSeed);
    await save();
    sendMe();
    socket.emit('toast', { message: 'Nouvelle graine. L’ancienne est révélée, tu peux tout vérifier.', kind: 'success' });
  });

  /* ══════════ ADMINISTRATION ══════════ */

  function requireAdmin() {
    if (admin.isAdmin(profile)) return true;
    socket.emit('toast', { message: 'Réservé aux administrateurs.', kind: 'error' });
    return false;
  }

  async function adminState(query = {}) {
    const [snap, list] = await Promise.all([admin.snapshot(presence), admin.players(query)]);
    return { ...snap, ...list, query };
  }

  socket.on('admin:claim', async ({ key } = {}) => {
    const result = await admin.claim(profile, key);
    socket.emit('toast', { message: result.message, kind: result.ok ? 'success' : 'error' });
    if (result.ok) {
      sendMe();
      socket.emit('admin:state', await adminState());
    }
  });

  socket.on('admin:open', async (query = {}) => {
    if (!requireAdmin()) return;
    presence.setStatus(user.id, 'admin');
    socket.join('admin');
    socket.emit('admin:state', await adminState(query));
  });

  socket.on('admin:close', () => socket.leave('admin'));

  socket.on('admin:action', async ({ action, payload, query } = {}) => {
    if (!requireAdmin()) return;
    let result;
    try {
      result = await admin.act(profile, action, payload || {}, { io, presence, chat });
    } catch (err) {
      result = { ok: false, message: err.message };
    }
    socket.emit('toast', { message: result.message, kind: result.ok ? 'success' : 'error' });
    socket.emit('admin:state', { ...(await adminState(query || {})), result });
    refreshAdmins();
  });

  /* ══════════ CHAT ══════════ */

  socket.on('chat:say', ({ text } = {}) => {
    const result = chat.say(user, profile, text, { isAdmin: admin.isAdmin(profile) });
    if (!result.ok) socket.emit('toast', { message: result.message, kind: 'warn' });
  });

  /* ══════════ DIVERS ══════════ */

  socket.on('me:refresh', () => sendMe());

  socket.on('presence:status', ({ status } = {}) => {
    if (['home', 'mine', 'plinko', 'roulette', 'blackjack', 'vault', 'admin'].includes(status)) {
      presence.setStatus(user.id, status);
    }
  });

  socket.on('disconnect', () => {
    clearTimeout(saveTimer);
    leaveTable();
    presence.leave(socket, user.id);
    refreshAdmins();
    clicker.collect(profile);
    save();
  });
});

blackjack.startJanitor();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  🎰 PartyZone démarré sur http://localhost:${PORT}`);
  console.log(`  Discord OAuth : ${auth.discordConfigured() ? 'activé' : 'non configuré (mode invité seulement)'}`);
  console.log(`  Progression   : ${process.env.DATABASE_URL ? 'PostgreSQL' : 'fichier data/profiles.json'}`);
  console.log(`  Panel admin   : ${admin.adminKeyConfigured() ? 'clé configurée' : 'ADMIN_KEY absente'}\n`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    console.log('\n[serveur] arrêt en cours…');
    try {
      roulette.stop();
      await store.close();
    } catch {}
    process.exit(0);
  });
}
