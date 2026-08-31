'use strict';
require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const auth = require('./auth');
const { createRoom, getRoom, startJanitor } = require('./room');
const yt = require('./youtube');
const { CATEGORIES } = require('./data/questions');

const BlindTest = require('./games/blindtest');
const Quiz = require('./games/quiz');
const Undercover = require('./games/undercover');

const GAMES = {
  blindtest: BlindTest,
  quiz: Quiz,
  undercover: Undercover,
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });

app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', extensions: ['html'] }));

auth.register(app);

app.get('/api/categories', (req, res) => res.json({ categories: CATEGORIES }));
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

function joinRoom(socket, room) {
  const user = socket.data.user;
  socket.join('room:' + room.code);
  socket.data.roomCode = room.code;
  room.addPlayer(user, socket.id);
  socket.emit('room:joined', { code: room.code, chat: room.chat });
  room.pushChat({ system: true, text: `${user.name} a rejoint le salon.` });
  room.broadcast();
}

function leaveRoom(socket) {
  const room = currentRoom(socket);
  if (!room) return;
  const user = socket.data.user;
  socket.leave('room:' + room.code);
  socket.data.roomCode = null;
  room.removePlayer(user.id);
  room.pushChat({ system: true, text: `${user.name} a quitté le salon.` });
  room.broadcast();
}

io.on('connection', (socket) => {
  const user = socket.data.user;
  socket.emit('me', user);

  socket.on('room:create', () => {
    leaveRoom(socket);
    const room = createRoom(io);
    room.hostId = user.id;
    joinRoom(socket, room);
  });

  socket.on('room:join', ({ code } = {}) => {
    const room = getRoom(code);
    if (!room) return socket.emit('toast', { message: 'Salon introuvable. Vérifie le code.', kind: 'error' });
    if (room.players.size >= 24 && !room.players.has(user.id)) {
      return socket.emit('toast', { message: 'Ce salon est complet (24 joueurs max).', kind: 'error' });
    }
    leaveRoom(socket);
    joinRoom(socket, room);
  });

  socket.on('room:leave', () => leaveRoom(socket));

  socket.on('chat:send', ({ text } = {}) => {
    const room = currentRoom(socket);
    if (!room) return;
    const clean = String(text || '').trim().slice(0, 300);
    if (!clean) return;
    room.pushChat({ id: user.id, name: user.name, avatar: user.avatar, text: clean });
    // Pendant le blind test ou le quiz, le chat sert aussi de zone de réponse.
    if (room.game && (room.gameKey === 'blindtest' || room.gameKey === 'quiz')) {
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

  socket.on('blindtest:import', async ({ url } = {}) => {
    const room = currentRoom(socket);
    if (!room || !room.isHost(user.id)) return;

    const playlistId = yt.parsePlaylistId(url);
    const videoId = yt.parseVideoId(url);

    if (!playlistId && !videoId) {
      return socket.emit('toast', { message: 'Lien YouTube non reconnu. Colle l’URL d’une playlist.', kind: 'error' });
    }

    socket.emit('blindtest:importing', { playlistId });

    // 1) chemin serveur (si une clé API est configurée)
    if (playlistId && process.env.YOUTUBE_API_KEY) {
      try {
        const tracks = await yt.fetchPlaylistWithApi(playlistId);
        if (tracks && tracks.length) return setPlaylist(room, tracks, url);
      } catch (err) {
        console.warn('[youtube] API indisponible, repli navigateur :', err.message);
      }
    }

    // 2) vidéo seule
    if (!playlistId && videoId) {
      const tracks = await yt.buildTracksFromIds([videoId]);
      if (tracks.length) return setPlaylist(room, tracks, url);
      return socket.emit('toast', { message: 'Vidéo inaccessible.', kind: 'error' });
    }

    // 3) repli : le navigateur de l'hôte extrait les IDs via l'IFrame API
    socket.emit('blindtest:extract', { playlistId });
  });

  socket.on('blindtest:videoIds', async ({ ids, source } = {}) => {
    const room = currentRoom(socket);
    if (!room || !room.isHost(user.id)) return;
    const list = (Array.isArray(ids) ? ids : []).filter((s) => /^[A-Za-z0-9_-]{11}$/.test(s));
    if (!list.length) {
      return socket.emit('toast', { message: 'Playlist vide ou privée.', kind: 'error' });
    }
    try {
      const tracks = await yt.buildTracksFromIds(list);
      if (!tracks.length) throw new Error('aucune piste');
      setPlaylist(room, tracks, source);
    } catch (err) {
      socket.emit('toast', { message: 'Impossible de lire les titres de la playlist.', kind: 'error' });
    }
  });

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

  /* ── Lancement / arrêt d'un jeu ────────────────────── */

  socket.on('game:start', ({ key } = {}) => {
    const room = currentRoom(socket);
    if (!room || !room.isHost(user.id)) return;
    const GameClass = GAMES[key];
    if (!GameClass) return;

    if (key === 'blindtest') {
      if (!room.playlist || !room.playlist.tracks.length) {
        return socket.emit('toast', { message: 'Importe d’abord une playlist YouTube.', kind: 'error' });
      }
      return room.startGame(GameClass, key, { ...room.settings.blindtest, tracks: room.playlist.tracks });
    }
    if (key === 'undercover' && room.connectedPlayers().length < 3) {
      return socket.emit('toast', { message: 'Undercover demande au moins 3 joueurs.', kind: 'error' });
    }
    room.startGame(GameClass, key, room.settings[key]);
  });

  socket.on('game:stop', () => {
    const room = currentRoom(socket);
    if (!room || !room.isHost(user.id)) return;
    room.stopGame();
    room.toast('Partie terminée par l’hôte.', 'info');
  });

  socket.on('game:action', ({ action, payload } = {}) => {
    const room = currentRoom(socket);
    if (!room || !room.game) return;
    room.game.handle(user.id, action, payload || {});
  });

  socket.on('disconnect', () => {
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
  console.log(`  YouTube API   : ${process.env.YOUTUBE_API_KEY ? 'clé détectée' : 'import via navigateur'}\n`);
});
