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
const slots = require('./slots');
const medals = require('./medals');
const season = require('./season');
const gifts = require('./gifts');
const blackjack = require('./blackjack');
const { Roulette } = require('./roulette');
const { Presence } = require('./presence');
const { Chat } = require('./chat');
const admin = require('./admin');
const partyRooms = require('./party/rooms');
const partyRank = require('./party/rank');
const { Undercover } = require('./party/undercover');
const { Poker } = require('./party/poker');

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
    const sort = ['xp', 'party'].includes(req.query.sort) ? req.query.sort : 'coins';
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

/**
 * Bascule de mois.
 *
 * Personne ne remet le lot automatiquement : le site désigne le vainqueur,
 * l'annonce à tout le monde, et laisse une trace dans le panel admin. La
 * remise se fait à la main, en dehors du site.
 */
let seasonChecking = false;
async function checkSeason() {
  if (seasonChecking) return;
  seasonChecking = true;
  try {
    const state = await store.siteState();
    const profiles = await store.allProfiles();
    const winner = season.rollover(state, profiles);
    if (winner) {
      store.touchState();
      await store.flushState();
      io.emit('announce', {
        text: `${winner.name} remporte le mois de ${winner.label} avec ${winner.coins.toLocaleString('fr-FR')} pièces de bénéfice — ${winner.prize} !`,
      });
      chat.system(`🏆 ${winner.name} termine premier de ${winner.label}. Le lot est remis à la main par un administrateur.`, 'announce');
      console.log(`[saison] ${winner.label} remporté par ${winner.name} (${winner.coins})`);
    }
  } finally {
    seasonChecking = false;
  }
}

// On revérifie toutes les heures, pour que la bascule tombe même si personne
// ne se connecte au bon moment.
setInterval(() => checkSeason().catch(() => {}), 3600 * 1000).unref();

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

  // Le mois a-t-il tourné depuis la dernière connexion ? Le premier joueur
  // qui arrive après minuit le 1er déclenche le bilan.
  checkSeason().catch((e) => console.error('[saison]', e.message));

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

  /* ══════════ MACHINE À SOUS ══════════ */

  socket.on('slots:open', () => {
    presence.setStatus(user.id, 'slots');
    socket.emit('slots:state', { config: slots.view(), me: store.publicProfile(profile) });
  });

  socket.on('slots:spin', async (payload = {}) => {
    const result = slots.play(profile, payload);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });

    store.recordPlay(profile, result.staked, result.payout);
    await save();

    socket.emit('slots:result', { ...result, me: store.publicProfile(profile) });
    socket.emit('profile:update', store.publicProfile(profile));

    if (result.bonus.length) {
      io.emit('feed', {
        name: user.name, avatar: user.avatar, game: 'Machine à sous',
        text: 'tour bonus déclenché', amount: result.payout,
      });
      chat.system(`${user.name} déclenche le tour bonus et ramasse ${result.payout} 🪙 !`, 'win');
    } else if (result.profit >= result.staked * 15) {
      io.emit('feed', {
        name: user.name, avatar: user.avatar, game: 'Machine à sous',
        text: `×${Math.round(result.payout / result.staked)}`, amount: result.payout,
      });
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

    // Les paliers de collection se contrôlent ici, juste après le tirage.
    const state = await store.siteState();
    const earned = medals.check(profile, state.records);
    if (earned.length) store.touchState();

    await save();

    socket.emit('vault:state', vaultPayload({ result, medals: earned }));
    socket.emit('profile:update', store.publicProfile(profile));

    for (const tier of earned) {
      if (tier.first) {
        io.emit('announce', {
          text: `${user.name} est le PREMIER du site à atteindre ${tier.need} objets — ${tier.icon} ${tier.name} !`,
        });
        chat.system(`🥇 ${user.name} décroche « ${tier.name} » en premier — ${tier.need} objets !`, 'win');
      } else {
        chat.system(`${tier.icon} ${user.name} atteint ${tier.need} objets : ${tier.name}.`, 'drop');
      }
    }

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

  /* ══════════ MÉDAILLES ET COSMÉTIQUES ══════════ */

  async function sendMedals() {
    const state = await store.siteState();
    socket.emit('medals:state', medals.view(profile, state.records));
  }

  socket.on('medals:open', () => { sendMedals(); });

  socket.on('medals:equip', async ({ kind, id } = {}) => {
    const result = medals.equip(profile, kind, id);
    socket.emit('toast', { message: result.message, kind: result.ok ? 'success' : 'error' });
    if (result.ok) {
      await save();
      sendMe();
      sendMedals();
      // Les cosmétiques se voient partout : on prévient les autres écrans.
      presence.schedule();
    }
  });

  /* ══════════ SAISON ══════════ */

  socket.on('season:open', async () => {
    const state = await store.siteState();
    const profiles = await store.allProfiles();
    socket.emit('season:state', {
      ...season.view(state),
      ranking: season.ranking(profiles, 20),
      you: profile.season,
    });
  });

  /* ══════════ CADEAUX ══════════ */

  /**
   * Offrir une caisse à quelqu'un.
   *
   * C'est un transfert de pièces déguisé, donc on le traite comme tel : le
   * donneur paie le prix réel de la caisse, le receveur reçoit un bon à
   * ouvrir. Un plafond quotidien évite qu'on se serve du cadeau pour
   * contourner les limites du jeu ou blanchir un gros gain sur un autre
   * compte.
   */
  socket.on('gift:send', async ({ to, caseId, count } = {}) => {
    const result = await gifts.send(profile, { to, caseId, count }, store);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });

    await save();
    socket.emit('profile:update', store.publicProfile(profile));
    socket.emit('toast', { message: result.message, kind: 'success' });

    // On prévient le destinataire s'il est là.
    const entry = presence.users.get(result.target.id);
    if (entry) {
      for (const socketId of entry.sockets) {
        io.to(socketId).emit('gift:received', result.gift);
        io.to(socketId).emit('profile:update', store.publicProfile(result.target));
      }
    }
    chat.system(`🎁 ${user.name} offre ${result.gift.count} × ${result.gift.caseName} à ${result.target.name}.`, 'drop');
  });

  socket.on('gift:list', () => {
    socket.emit('gift:list', gifts.view(profile));
  });

  /** Ouvrir un cadeau : c'est une ouverture de caisse normale, mais gratuite. */
  socket.on('gift:claim', async ({ id } = {}) => {
    const taken = gifts.claim(profile, id);
    if (!taken.ok) return socket.emit('toast', { message: taken.message, kind: 'error' });

    const result = vault.open(profile, taken.gift.caseId, taken.gift.count, Date.now(), { free: true });
    if (!result.ok) {
      // On remet le bon : rien ne doit se perdre en route.
      profile.gifts.unshift(taken.gift);
      return socket.emit('toast', { message: result.message, kind: 'error' });
    }

    store.grantXp(profile, result.xp);
    profile.stats.cases += result.pulls.length;

    const state = await store.siteState();
    const earned = medals.check(profile, state.records);
    if (earned.length) store.touchState();

    await save();
    socket.emit('vault:state', vaultPayload({ result, medals: earned }));
    socket.emit('gift:list', gifts.view(profile));
    socket.emit('profile:update', store.publicProfile(profile));
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

  /* ══════════ PARTY ══════════ */

  /**
   * La section Party n'a rien de commun avec le casino : pas de pièces, pas
   * de mise, pas de redistribution. On y gagne un rang à part, qui compte le
   * fait de venir jouer avec les autres plutôt que la chance.
   */

  const GAMES = {
    undercover: { build: () => new Undercover(io) },
    poker: { build: () => new Poker(io) },
  };

  const partyRoom = () => partyRooms.roomOf(user.id);

  function broadcastPartyList() {
    io.emit('party:list', { rooms: partyRooms.list() });
  }

  /** Un onglet se ferme : le salon décide lui-même si le joueur sort ou non. */
  function leavePartySocket() {
    const room = partyRoom();
    if (!room) return;
    room.leaveSocket(user.id, socket.id);
    socket.leave(room.channel);
    room.broadcast();
    broadcastPartyList();
  }

  /** Sortie volontaire, définitive. */
  function leaveParty() {
    const room = partyRoom();
    if (!room) return;
    room.system(`${user.name} quitte le salon.`);
    room.leave(user.id);
    socket.leave(room.channel);
    room.broadcast();
    socket.emit('party:left', {});
    broadcastPartyList();
  }

  function enterRoom(room) {
    const result = room.join(user, profile, socket.id, { cosmetics: medals.publicCosmetics(profile) });
    if (!result.ok) return result;
    socket.join(room.channel);
    if (!result.rejoined) room.system(`${user.name} rejoint le salon.`);
    room.broadcast();
    broadcastPartyList();
    return result;
  }

  socket.on('party:open', () => {
    presence.setStatus(user.id, 'party');
    socket.emit('party:list', { rooms: partyRooms.list() });
    socket.emit('party:rank', partyRank.view(profile));

    // Reconnexion : si le joueur était déjà dans un salon, on l'y remet
    // plutôt que de le laisser croire qu'il a perdu sa place.
    const room = partyRoom();
    if (room) {
      socket.join(room.channel);
      const player = room.playerOf(user.id);
      if (player) { player.sockets.add(socket.id); player.connected = true; }
      room.broadcast();
    }
  });

  socket.on('party:create', ({ game } = {}) => {
    const entry = GAMES[game];
    if (!entry) return socket.emit('toast', { message: 'Ce jeu n’existe pas encore.', kind: 'error' });

    const already = partyRoom();
    if (already) leaveParty();

    const room = entry.build();
    // La partie peut s'achever sur un minuteur du salon, pas seulement sur
    // un clic : on branche le crédit du rang directement sur la fin de
    // partie, sinon les XP ne tomberaient que par hasard.
    room.onEnd = (finished) => {
      creditParty(finished).catch((e) => console.error('[party]', e.message));
      broadcastPartyList();
    };
    const result = enterRoom(room);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });
    socket.emit('party:joined', { code: room.code, game: room.game });
  });

  socket.on('party:join', ({ code } = {}) => {
    const room = partyRooms.get(code);
    if (!room) return socket.emit('toast', { message: 'Aucun salon avec ce code.', kind: 'error' });

    const already = partyRoom();
    if (already && already !== room) leaveParty();

    const result = enterRoom(room);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });
    socket.emit('party:joined', { code: room.code, game: room.game });
  });

  socket.on('party:leave', () => leaveParty());

  socket.on('party:list', () => socket.emit('party:list', { rooms: partyRooms.list() }));

  socket.on('party:say', ({ text } = {}) => {
    const room = partyRoom();
    if (!room) return;
    const result = room.say(user, text);
    if (!result.ok) socket.emit('toast', { message: result.message, kind: 'warn' });
  });

  socket.on('party:start', () => {
    const room = partyRoom();
    if (!room) return;
    room.credited = false; // une relance doit pouvoir créditer à nouveau
    const result = room.start(user.id);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });
    broadcastPartyList();
  });

  /**
   * Une partie terminée crédite le rang de tous ceux qui y étaient — les
   * perdants aussi, un peu moins. Le rang Party récompense la présence, pas
   * la performance.
   */
  async function creditParty(room) {
    if (!room.result || room.credited) return;
    // Une partie ne crédite qu'une fois, même si deux chemins mènent à la fin.
    room.credited = true;
    const winners = new Set(room.winners());
    const players = room.players;

    for (const p of players) {
      const target = p.id === user.id ? profile : await store.findProfile(p.id);
      if (!target) continue;
      const gain = partyRank.record(target, room.game, {
        won: winners.has(p.id),
        players: players.length,
        rounds: room.round || room.hand || 1,
      });
      await store.saveProfile(target);

      const entry = presence.users.get(p.id);
      if (entry) {
        for (const socketId of entry.sockets) {
          io.to(socketId).emit('party:rank', partyRank.view(target));
          io.to(socketId).emit('toast', {
            message: `+${gain.gained} XP Party — ${gain.title} (niveau ${gain.level})`,
            kind: winners.has(p.id) ? 'success' : 'info',
          });
        }
      }
    }
  }

  /* ─── Undercover ─── */

  const ucRoom = () => {
    const room = partyRoom();
    return room && room.game === 'undercover' ? room : null;
  };

  socket.on('uc:configure', (payload = {}) => {
    const room = ucRoom();
    if (!room) return;
    const result = room.configure(user.id, payload);
    if (!result.ok) socket.emit('toast', { message: result.message, kind: 'error' });
  });

  socket.on('uc:describe', ({ text } = {}) => {
    const room = ucRoom();
    if (!room) return;
    const result = room.describe(user.id, text);
    if (!result.ok) socket.emit('toast', { message: result.message, kind: 'error' });
  });

  socket.on('uc:vote', ({ id } = {}) => {
    const room = ucRoom();
    if (!room) return;
    const result = room.vote(user.id, id);
    if (!result.ok) socket.emit('toast', { message: result.message, kind: 'error' });
  });

  socket.on('uc:guess', ({ text } = {}) => {
    const room = ucRoom();
    if (!room) return;
    const result = room.guess(user.id, text);
    if (!result.ok) socket.emit('toast', { message: result.message, kind: 'error' });
  });

  /* ─── Poker ─── */

  socket.on('pk:act', ({ move, amount } = {}) => {
    const room = partyRoom();
    if (!room || room.game !== 'poker') return;
    const result = room.act(user.id, move, amount);
    if (!result.ok) socket.emit('toast', { message: result.message, kind: 'error' });
  });

  socket.on('party:rank', () => socket.emit('party:rank', partyRank.view(profile)));

  socket.on('disconnect', () => {
    clearTimeout(saveTimer);
    leaveTable();
    leavePartySocket();
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
