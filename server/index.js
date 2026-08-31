'use strict';
require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const auth = require('./auth');
const store = require('./store');
const vault = require('./vault');
const { Presence } = require('./presence');
const difficulty = require('./difficulty');
const { createRoom, getRoom, startJanitor } = require('./room');
const yt = require('./youtube');
const { CATEGORIES } = require('./data/questions');

const BlindTest = require('./games/blindtest');
const Quiz = require('./games/quiz');
const Undercover = require('./games/undercover');

const GAMES = { blindtest: BlindTest, quiz: Quiz, undercover: Undercover };

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
const presence = new Presence(io);

app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', extensions: ['html'] }));

auth.register(app);

app.get('/api/categories', (req, res) => res.json({ categories: CATEGORIES }));

app.get('/api/difficulties', (req, res) =>
  res.json({ blindtest: difficulty.list('blindtest'), quiz: difficulty.list('quiz') })
);

/** Classement général — c'est ce qui s'affiche sur la page d'accueil. */
app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(3, Number(req.query.limit) || 15));
    res.json({ leaderboard: await store.leaderboard(limit) });
  } catch (err) {
    console.error('[leaderboard]', err.message);
    res.status(500).json({ leaderboard: [] });
  }
});

app.get('/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

/* ─── Socket.IO ────────────────────────────────────────── */

io.use((socket, next) => {
  const user = auth.userFromCookieHeader(socket.handshake.headers.cookie);
  if (!user) return next(new Error('non_authentifie'));
  socket.data.user = user;
  next();
});

function currentRoom(socket) {
  return socket.data.roomCode ? getRoom(socket.data.roomCode) : null;
}

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
  socket.data.profile = profile;
  presence.join(socket, user, profile);

  /** Renvoie au joueur son profil à jour (niveau, XP, pièces). */
  const sendMe = () => socket.emit('me', { user, profile: store.publicProfile(profile) });
  sendMe();

  /* ── Salons ────────────────────────────────────────── */

  function joinRoom(room) {
    socket.join('room:' + room.code);
    socket.data.roomCode = room.code;
    room.addPlayer(user, socket.id, profile);
    presence.setStatus(user.id, 'room');
    socket.emit('room:joined', { code: room.code, chat: room.chat });
    room.pushChat({ system: true, text: `${user.name} a rejoint le salon.` });
    room.broadcast();
  }

  function leaveRoom() {
    const room = currentRoom(socket);
    if (!room) return;
    socket.leave('room:' + room.code);
    socket.data.roomCode = null;
    presence.setStatus(user.id, 'home');
    room.removePlayer(user.id);
    room.pushChat({ system: true, text: `${user.name} a quitté le salon.` });
    room.broadcast();
  }

  socket.on('room:create', () => {
    leaveRoom();
    const room = createRoom(io);
    room.hostId = user.id;
    joinRoom(room);
  });

  socket.on('room:join', ({ code } = {}) => {
    const room = getRoom(code);
    if (!room) return socket.emit('toast', { message: 'Salon introuvable. Vérifie le code.', kind: 'error' });
    if (room.players.size >= 24 && !room.players.has(user.id)) {
      return socket.emit('toast', { message: 'Ce salon est complet (24 joueurs max).', kind: 'error' });
    }
    leaveRoom();
    joinRoom(room);
  });

  socket.on('room:leave', () => leaveRoom());

  socket.on('chat:send', ({ text } = {}) => {
    const room = currentRoom(socket);
    if (!room) return;
    const clean = String(text || '').trim().slice(0, 300);
    if (!clean) return;
    room.pushChat({ id: user.id, name: user.name, avatar: user.avatar, text: clean });
    // En mode saisie, le chat sert aussi de zone de réponse.
    if (room.game && room.game.answerMode === 'type') {
      room.game.handle(user.id, 'guess', { text: clean });
    }
  });

  socket.on('settings:update', ({ game, patch } = {}) => {
    const room = currentRoom(socket);
    if (!room || !room.isHost(user.id)) return;
    if (!room.settings[game]) return;
    Object.assign(room.settings[game], patch || {});
    room.broadcast();
  });

  /* ── Import de playlist YouTube ────────────────────── */

  function setPlaylist(room, tracks, source) {
    room.playlist = { tracks, source, importedAt: Date.now() };
    room.settings.blindtest.playlistUrl = source || '';
    room.emit('blindtest:playlist', {
      count: tracks.length,
      sample: tracks.slice(0, 6).map((t) => ({ title: t.title, artist: t.artist, thumbnail: t.thumbnail })),
    });
    room.toast(`Playlist importée : ${tracks.length} titres prêts.`, 'success');
    room.broadcast();
  }

  socket.on('blindtest:import', async ({ url } = {}) => {
    const room = currentRoom(socket);
    if (!room || !room.isHost(user.id)) return;

    const playlistId = yt.parsePlaylistId(url);
    const videoId = yt.parseVideoId(url);
    if (!playlistId && !videoId) {
      return socket.emit('toast', { message: 'Lien YouTube non reconnu. Colle l’URL d’une playlist.', kind: 'error' });
    }

    socket.emit('blindtest:importing', { playlistId });

    if (playlistId && process.env.YOUTUBE_API_KEY) {
      try {
        const tracks = await yt.fetchPlaylistWithApi(playlistId);
        if (tracks && tracks.length) return setPlaylist(room, tracks, url);
      } catch (err) {
        console.warn('[youtube] API indisponible, repli navigateur :', err.message);
      }
    }

    if (!playlistId && videoId) {
      const tracks = await yt.buildTracksFromIds([videoId]);
      if (tracks.length) return setPlaylist(room, tracks, url);
      return socket.emit('toast', { message: 'Vidéo inaccessible.', kind: 'error' });
    }

    socket.emit('blindtest:extract', { playlistId });
  });

  socket.on('blindtest:videoIds', async ({ ids, source } = {}) => {
    const room = currentRoom(socket);
    if (!room || !room.isHost(user.id)) return;
    const list = (Array.isArray(ids) ? ids : []).filter((s) => /^[A-Za-z0-9_-]{11}$/.test(s));
    if (!list.length) return socket.emit('toast', { message: 'Playlist vide ou privée.', kind: 'error' });
    try {
      const tracks = await yt.buildTracksFromIds(list);
      if (!tracks.length) throw new Error('aucune piste');
      setPlaylist(room, tracks, source);
    } catch (err) {
      socket.emit('toast', { message: 'Impossible de lire les titres de la playlist.', kind: 'error' });
    }
  });

  /* ── Lancement / arrêt d'un jeu ────────────────────── */

  /** Tout le salon bascule en « En partie » (ou revient au salon). */
  function markRoomStatus(room, status) {
    for (const p of room.connectedPlayers()) presence.setStatus(p.id, status);
  }

  socket.on('game:start', ({ key } = {}) => {
    const room = currentRoom(socket);
    if (!room || !room.isHost(user.id)) return;
    const GameClass = GAMES[key];
    if (!GameClass) return;

    if (key === 'blindtest') {
      if (!room.playlist || !room.playlist.tracks.length) {
        return socket.emit('toast', { message: 'Importe d’abord une playlist YouTube.', kind: 'error' });
      }
      room.startGame(GameClass, key, { ...room.settings.blindtest, tracks: room.playlist.tracks });
      return markRoomStatus(room, 'game');
    }
    if (key === 'undercover' && room.connectedPlayers().length < 3) {
      return socket.emit('toast', { message: 'Undercover demande au moins 3 joueurs.', kind: 'error' });
    }
    room.startGame(GameClass, key, room.settings[key]);
    markRoomStatus(room, 'game');
  });

  socket.on('game:stop', () => {
    const room = currentRoom(socket);
    if (!room || !room.isHost(user.id)) return;
    room.stopGame();
    markRoomStatus(room, 'room');
    room.toast('Partie terminée par l’hôte.', 'info');
  });

  socket.on('game:action', ({ action, payload } = {}) => {
    const room = currentRoom(socket);
    if (!room || !room.game) return;
    room.game.handle(user.id, action, payload || {});
  });

  /* ── MEMEVAULT ─────────────────────────────────────── */

  function vaultPayload(extra = {}) {
    return { vault: vault.view(profile), me: store.publicProfile(profile), ...extra };
  }

  socket.on('vault:open', () => {
    presence.setStatus(user.id, 'vault');
    socket.emit('vault:state', vaultPayload());
  });

  socket.on('vault:pull', async ({ caseId, count } = {}) => {
    const result = vault.open(profile, caseId, count);
    if (!result.ok) {
      return socket.emit('vault:state', vaultPayload({ result }));
    }
    store.grantXp(profile, result.xp);
    await store.saveProfile(profile);
    socket.emit('vault:state', vaultPayload({ result }));
    socket.emit('profile:update', store.publicProfile(profile));

    // Un tirage exceptionnel, ça se partage : tout le site le voit passer.
    const showcase = result.pulls.filter((p) => ['mythic', 'cursed'].includes(p.r));
    for (const pull of showcase) {
      io.emit('vault:showcase', {
        name: user.name,
        avatar: user.avatar,
        item: { emoji: pull.emoji, name: pull.name, rarity: pull.rarity, color: pull.color },
      });
    }
  });

  socket.on('vault:sell', async () => {
    const result = vault.sellDuplicates(profile);
    if (result.ok) await store.saveProfile(profile);
    socket.emit('vault:state', vaultPayload({ result }));
    if (result.ok) socket.emit('profile:update', store.publicProfile(profile));
  });

  /* ── Divers ────────────────────────────────────────── */

  socket.on('me:refresh', () => sendMe());
  socket.on('presence:status', ({ status } = {}) => {
    if (['home', 'room', 'game', 'vault'].includes(status)) presence.setStatus(user.id, status);
  });
  socket.emit('online:list', { online: presence.list() });

  socket.on('disconnect', () => {
    clearTimeout(socket.data.saveTimer);
    presence.leave(socket, user.id);
    store.saveProfile(profile).catch(() => {});
    const room = currentRoom(socket);
    if (!room) return;
    room.removePlayer(user.id);
    room.broadcast();
  });
});

startJanitor();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  🎉 PartyZone démarré sur http://localhost:${PORT}`);
  console.log(`  Discord OAuth : ${auth.discordConfigured() ? 'activé' : 'non configuré (mode invité seulement)'}`);
  console.log(`  YouTube API   : ${process.env.YOUTUBE_API_KEY ? 'clé détectée' : 'import via navigateur'}`);
  console.log(`  Progression   : ${process.env.DATABASE_URL ? 'PostgreSQL' : 'fichier data/profiles.json'}\n`);
});

/* Arrêt propre : on vide le tampon d'écriture avant de mourir. */
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    console.log('\n[serveur] arrêt en cours…');
    try {
      await store.close();
    } catch {}
    process.exit(0);
  });
}
