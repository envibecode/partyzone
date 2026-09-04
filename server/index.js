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
const market = require('./market');
const rakeback = require('./rakeback');
const blackjack = require('./blackjack');
const { Roulette } = require('./roulette');
const { Presence, STATUS_LABEL } = require('./presence');
const { Chat } = require('./chat');
const admin = require('./admin');
const partyRooms = require('./party/rooms');
const partyRank = require('./party/rank');
const { Undercover } = require('./party/undercover');
const { Poker } = require('./party/poker');
const { Uno } = require('./party/uno');
const { Belote } = require('./party/belote');
const { Monopoly } = require('./party/monopoly');
const { Loup } = require('./party/loup');
const { Blindtest } = require('./party/blindtest');
const soirees = require('./party/soiree');
const gate = require('./gate');
const assets = require('./assets');
const ledger = require('./ledger');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
const presence = new Presence(io);
const chat = new Chat(io);

app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// LA PORTE, avant tout le reste.
//
// Elle est posée AVANT express.static exprès : si elle venait après, le
// fichier index.html serait servi par le middleware statique et la porte
// ne verrait jamais passer la requête. Un site fermé dont on peut lire la
// page d'accueil en tapant /index.html n'est pas fermé.
gate.mount(app);

/*
 * LES PAGES HTML, AVANT LE SERVICE DE FICHIERS.
 *
 * Elles passent par `assets.sendPage`, qui tamponne les adresses des CSS et
 * des JS avec l'empreinte du déploiement et interdit leur mise en cache.
 * Sans ça, un joueur qui revient après une mise à jour reçoit le nouveau
 * HTML avec l'ancienne feuille de style — le site s'affiche à moitié, et
 * personne ne comprend pourquoi.
 *
 * Elles sont déclarées AVANT express.static : sinon le middleware statique
 * servirait index.html brut et le tampon ne serait jamais posé.
 */
app.get(['/', '/index.html'], (req, res) => assets.sendPage(res, 'index.html'));

app.use(express.static(path.join(__dirname, '..', 'public'), {
  // Les fichiers portent une empreinte dans leur adresse : quand leur
  // contenu change, l'adresse change, donc on peut les garder longtemps
  // sans risque de servir du périmé.
  maxAge: '30d',
  extensions: ['html'],
}));

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

/*
 * L'EXPORT DE LA BASE.
 *
 * Un fichier JSON avec tous les profils et l'état du site. Neon fait ses
 * propres sauvegardes, mais avoir le fichier chez soi coûte dix secondes et
 * évite une très mauvaise soirée — et c'est le seul moyen de repartir
 * ailleurs si un jour l'hébergeur ferme.
 *
 * L'authentification passe par le cookie de session, comme le reste du
 * site : ce n'est pas une API publique, c'est un bouton du panel admin.
 */
app.get('/api/admin/export', async (req, res) => {
  try {
    const user = auth.userFromCookieHeader(req.headers.cookie);
    if (!user) return res.status(401).json({ error: 'Session absente.' });
    const profile = await store.findProfile(user.id);
    if (!profile || !admin.isAdmin(profile)) {
      return res.status(403).json({ error: 'Réservé aux administrateurs.' });
    }

    // On force l'écriture des tampons en attente : sinon l'export sort
    // avec un registre en retard de dix secondes et des profils non écrits.
    await store.flushState().catch(() => {});
    await ledger.flush().catch(() => {});

    const [profiles, state] = await Promise.all([store.allProfiles(), store.siteState()]);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="partyzone-${stamp}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(JSON.stringify({
      exportedAt: Date.now(),
      exportedBy: profile.name,
      version: 1,
      storage: process.env.DATABASE_URL ? 'postgres' : 'fichier',
      counts: { profiles: profiles.length },
      state,
      profiles,
    }, null, 2));
    admin.record(profile, 'export', 'base complète', `${profiles.length} profils`);
  } catch (err) {
    console.error('[export]', err.message);
    res.status(500).json({ error: 'Export impossible.' });
  }
});

/**
 * LE PALMARÈS ENTRE POTES.
 *
 * Le rang Party compte les XP, ce qui dit combien on a joué mais pas
 * comment. Ici : par jeu, qui a gagné combien de fois, et sur quel taux.
 * C'est la seule page qui permette de dire « toi, à la belote, jamais ».
 *
 * On ne classe que ceux qui ont au moins trois parties : sur une seule
 * partie gagnée, un taux de 100 % ne veut rien dire et écrase tout le
 * monde en tête du tableau.
 */
const PALMARES_MIN = 3;

app.get('/api/palmares', async (req, res) => {
  try {
    const profiles = await store.allProfiles();
    const games = {};
    let total = 0;

    for (const p of profiles) {
      const party = (p.party && p.party.games) || {};
      for (const [game, g] of Object.entries(party)) {
        if (!g || !g.played) continue;
        total += g.played;
        const list = games[game] || (games[game] = []);
        list.push({
          id: p.id,
          name: p.name,
          avatar: p.avatar || null,
          played: g.played,
          won: g.won || 0,
          rate: g.played ? Math.round(((g.won || 0) / g.played) * 100) : 0,
        });
      }
    }

    const table = Object.entries(games).map(([game, list]) => {
      const ranked = list
        .filter((x) => x.played >= PALMARES_MIN)
        .sort((a, b) => b.won - a.won || b.rate - a.rate || a.name.localeCompare(b.name));
      return {
        game,
        parties: list.reduce((n, x) => n + x.played, 0),
        joueurs: list.length,
        // Le classement, et à part le « jamais gagné » — c'est la ligne
        // dont on se moque le plus volontiers.
        top: ranked.slice(0, 8),
        jamais: list.filter((x) => x.played >= PALMARES_MIN && x.won === 0).map((x) => x.name),
      };
    }).sort((a, b) => b.parties - a.parties);

    res.json({ table, total, min: PALMARES_MIN });
  } catch (err) {
    console.error('[palmarès]', err.message);
    res.status(500).json({ table: [] });
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
        text: `${winner.name} remporte le mois de ${winner.label} avec ${(winner.xp || 0).toLocaleString('fr-FR')} XP — ${winner.prize} !`,
      });
      chat.system(`🏆 ${winner.name} termine premier de ${winner.label}. Le lot est remis à la main par un administrateur.`, 'announce');
      console.log(`[saison] ${winner.label} remporté par ${winner.name} (${winner.xp || 0} XP)`);
    }
  } finally {
    seasonChecking = false;
  }
}

// On revérifie toutes les heures, pour que la bascule tombe même si personne
// ne se connecte au bon moment.
setInterval(() => checkSeason().catch(() => {}), 3600 * 1000).unref();

/**
 * Le crédit de fin de partie Party.
 *
 * Une partie ne paie qu'une fois : le drapeau `credited` est posé avant le
 * moindre `await`, sinon deux chemins de fin arrivés en même temps
 * paieraient deux fois. Il est sauvegardé avec le salon, donc un
 * redémarrage ne le remet pas à zéro.
 */
async function creditPartyRoom(room) {
  if (!room.result || room.credited) return;
  room.credited = true;
  const winners = new Set(room.winners());
  const players = room.players;

  for (const p of players) {
    const target = await store.findProfile(p.id);
    if (!target) continue;
    const gain = partyRank.record(target, room.game, {
      won: winners.has(p.id),
      players: players.length,
      rounds: room.round || room.hand || room.laps || 1,
    });
    store.quest(target, 'party', { game: room.game, won: winners.has(p.id) });
    await store.saveProfile(target);

    const entry = presence.users.get(p.id);
    if (entry) {
      // Le profil en cache de la présence doit suivre : sinon la personne
      // garde son ancien rang tant qu'elle ne recharge pas la page.
      entry.profile = target;
      for (const socketId of entry.sockets) {
        io.to(socketId).emit('party:rank', partyRank.view(target));
        io.to(socketId).emit('profile:update', store.publicProfile(target));
        io.to(socketId).emit('toast', {
          message: `+${gain.gained} XP Party — ${gain.title} (niveau ${gain.level})`,
          kind: winners.has(p.id) ? 'success' : 'info',
        });
      }
    }
  }
}

/* ═══════════ LA SOIRÉE ═══════════ */

/**
 * Envoie l'état d'une soirée à ceux qui la suivent.
 *
 * On vise les joueurs un par un plutôt que le canal du salon : entre deux
 * manches, la soirée n'a pas de salon, et les spectateurs d'une manche ne
 * font pas partie de la soirée.
 */
function emitSoiree(s) {
  const payload = s.state();
  for (const id of s.scores.keys()) {
    const entry = presence.users.get(id);
    if (!entry) continue;
    for (const socketId of entry.sockets) io.to(socketId).emit('soiree:state', payload);
  }
}

/**
 * La fin d'une partie Party, une bonne fois pour toutes.
 *
 * Deux choses arrivent : le rang Party est crédité, et si la partie était
 * une manche de soirée, le classement cumulé est mis à jour. Les deux
 * chemins de fin — le clic et le minuteur — passent ici.
 */
function onPartyEnd(room) {
  creditPartyRoom(room).catch((e) => console.error('[party]', e.message));

  const s = soirees.ofRoom(room);
  if (s && s.record(room)) {
    emitSoiree(s);
    if (s.over && s.result) {
      const names = s.result.winnerIds.map((id) => {
        const who = s.names.get(id);
        return who ? who.name : '—';
      });
      room.system(names.length
        ? `Soirée terminée — ${names.join(' et ')} l’emporte au cumul après ${s.history.length} manches.`
        : 'Soirée terminée.', 'end');
    } else if (s.nextGame) {
      const next = PARTY_GAMES[s.nextGame];
      room.system(`Manche ${s.step + 1}/${s.games.length} comptée. Prochaine : ${next ? next.name : s.nextGame}.`, 'end');
    }
  }

  io.emit('party:list', { rooms: partyRooms.list() });
}

/* ═══════════ LES JEUX PARTY, ET LEUR SURVIE ═══════════ */

/**
 * La table des jeux, à un seul endroit.
 *
 * Elle sert à deux choses : ouvrir un salon quand quelqu'un le demande, et
 * reconstruire les salons sauvegardés au démarrage. Un jeu ajouté ici est
 * ajouté partout.
 */
const PARTY_GAMES = {
  undercover: { name: 'Undercover', build: () => new Undercover(io) },
  poker: { name: 'Poker', build: () => new Poker(io) },
  uno: { name: 'Uno', build: () => new Uno(io) },
  belote: { name: 'Belote', build: () => new Belote(io) },
  monopoly: { name: 'Monopoly', build: () => new Monopoly(io) },
  loup: { name: 'Loup-garou', build: () => new Loup(io) },
  blindtest: { name: 'Blindtest', build: () => new Blindtest(io) },
};
const PARTY_BUILDERS = Object.fromEntries(
  Object.entries(PARTY_GAMES).map(([id, g]) => [id, g.build])
);

/**
 * Écrit les salons en cours dans l'état du site.
 *
 * Toutes les quinze secondes, et à l'arrêt. Sans ça, chaque `git push`
 * tuait toutes les parties — un Monopoly de quarante-cinq minutes perdu
 * parce qu'on a corrigé une faute de frappe dans un texte.
 */
async function savePartyRooms() {
  try {
    const state = await store.siteState();
    state.partyRooms = partyRooms.saveAll();
    // Une soirée, c'est trois quarts d'heure à quatre : elle survit au
    // redéploiement comme les parties elles-mêmes.
    soirees.sweep(partyRooms);
    state.soirees = soirees.saveAll();
    store.touchState();
  } catch (err) {
    console.error('[party] sauvegarde impossible :', err.message);
  }
}
setInterval(() => { savePartyRooms(); }, 15000).unref();

/** Au démarrage : on remet les salons là où ils étaient. */
async function restorePartyRooms() {
  try {
    const state = await store.siteState();
    const n = partyRooms.restoreAll(state.partyRooms, PARTY_BUILDERS);
    if (n) console.log(`  Salons Party  : ${n} partie(s) reprise(s) après redémarrage`);
    const s = soirees.restoreAll(state.soirees);
    if (s) console.log(`  Soirées       : ${s} reprise(s) après redémarrage`);
    // Les salons rechargés doivent recevoir le crédit de fin de partie
    // comme les autres : on rebranche le rappel, perdu à la sérialisation.
    for (const room of partyRooms.rooms.values()) {
      if (!room.onEnd) room.onEnd = onPartyEnd;
    }
  } catch (err) {
    console.error('[party] restauration impossible :', err.message);
  }
}

/* ─── Socket.IO ────────────────────────────────────────── */

io.use(async (socket, next) => {
  // La porte vaut aussi pour les websockets. Sans ce contrôle, une page
  // laissée ouverte avant la fermeture continuerait de jouer tranquillement
  // pendant que le site est censé être clos.
  if (!(await gate.isOpen()) && !gate.hasPassHeader(socket.handshake.headers.cookie)) {
    return next(new Error('site_ferme'));
  }
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
  socket.emit('quest:state', { quests: store.questsView(profile) });

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

    store.recordPlay(profile, result.staked, result.payout, 'plinko');
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
      chat.system(`${user.name} touche ×${best} au Plinko et repart avec ${result.payout} ¤ !`, 'win');
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

    store.recordPlay(profile, result.staked, result.payout, 'horse house');
    await save();

    socket.emit('slots:result', { ...result, me: store.publicProfile(profile) });
    socket.emit('profile:update', store.publicProfile(profile));

    if (result.free.length) {
      const tours = result.free.length;
      io.emit('feed', {
        name: user.name, avatar: user.avatar, game: 'Horse House',
        text: `${tours} tours offerts`, amount: result.payout,
      });
      chat.system(
        `🐴 ${user.name} ouvre les portes de l’écurie : ${tours} tours offerts`
        + `${result.extraSpins ? ` (dont ${result.extraSpins} rajoutés)` : ''}`
        + ` et ${result.payout} ¤ ramassés !`, 'win');
    } else if (result.profit >= result.staked * 15) {
      io.emit('feed', {
        name: user.name, avatar: user.avatar, game: 'Horse House',
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

  /**
   * Rejoindre une table, assis ou debout.
   *
   * `watch: true` place en spectateur : on voit tout, on ne mise rien. C'est
   * aussi le repli automatique quand les cinq sièges sont pris — plutôt que
   * de renvoyer un message d'erreur et de laisser la personne devant une
   * porte fermée.
   */
  function joinTable(table, { watch = false } = {}) {
    const full = table.seats.length >= blackjack.SEATS && !table.seatOf(user.id);

    if (watch || full) {
      table.addWatcher(user, socket.id);
      socket.join('bj:' + table.code);
      socket.data.tableCode = table.code;
      presence.setStatus(user.id, 'blackjack');
      socket.emit('bj:joined', { code: table.code, watching: true });
      if (full && !watch) {
        socket.emit('toast', {
          message: 'Les cinq sièges sont pris — tu regardes la partie. Une place se libère, tu pourras t’asseoir.',
          kind: 'info',
        });
      }
      table.broadcast();
      broadcastLobby();
      return true;
    }

    const seat = table.addPlayer(user, profile, socket.id);
    if (!seat) {
      socket.emit('toast', { message: 'La table est pleine (5 sièges).', kind: 'error' });
      return false;
    }
    table.removeWatcher(user.id);
    socket.join('bj:' + table.code);
    socket.data.tableCode = table.code;
    table.profiles.set(user.id, profile);
    presence.setStatus(user.id, 'blackjack');
    table.say('Croupier', `${user.name} rejoint la table.`);
    socket.emit('bj:joined', { code: table.code, watching: false });
    table.broadcast();
    broadcastLobby();
    return true;
  }

  function leaveTable() {
    const table = currentTable();
    if (!table) return;
    socket.leave('bj:' + table.code);
    socket.data.tableCode = null;
    const wasSeated = Boolean(table.seatOf(user.id));
    table.profiles.delete(user.id);
    table.removePlayer(user.id);
    table.removeWatcher(user.id);
    if (wasSeated) table.say('Croupier', `${user.name} quitte la table.`);
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
        store.recordPlay(p, seat.lastResult.staked, seat.lastResult.payout, 'blackjack');
        await store.saveProfile(p).catch(() => {});
        pushProfile(p);
      }
    };
    joinTable(table);
  });

  socket.on('bj:join', ({ code, watch } = {}) => {
    const table = blackjack.getTable(code);
    if (!table) return socket.emit('toast', { message: 'Table introuvable. Vérifie le code.', kind: 'error' });
    leaveTable();
    joinTable(table, { watch: Boolean(watch) });
  });

  /** Un spectateur prend une des places libres. */
  socket.on('bj:sit', () => {
    const table = currentTable();
    if (!table) return;
    if (table.seatOf(user.id)) return;
    if (table.seats.length >= blackjack.SEATS) {
      return socket.emit('toast', { message: 'Toutes les places sont prises.', kind: 'warn' });
    }
    table.addPlayer(user, profile, socket.id);
    table.removeWatcher(user.id);
    table.profiles.set(user.id, profile);
    table.say('Croupier', `${user.name} prend place à la table.`);
    table.broadcast();
    broadcastLobby();
  });

  /** Se lever sans quitter la table : on continue à regarder. */
  socket.on('bj:stand-up', () => {
    const table = currentTable();
    if (!table) return;
    const seat = table.seatOf(user.id);
    if (!seat) return;
    if (seat.bet >= blackjack.MIN_BET || (seat.hands && seat.hands.length)) {
      return socket.emit('toast', { message: 'Tu as une mise en jeu : attends la fin de la main.', kind: 'warn' });
    }
    table.removePlayer(user.id);
    table.profiles.delete(user.id);
    table.addWatcher(user, socket.id);
    table.say('Croupier', `${user.name} se lève et regarde.`);
    table.broadcast();
    broadcastLobby();
  });

  /** L'hôte libère une place occupée par quelqu'un qui ne joue pas. */
  socket.on('bj:kick', ({ id } = {}) => {
    const table = currentTable();
    if (!table) return;
    const result = table.kick(user.id, id);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });

    // L'exclu reste dans la salle en spectateur : on lui retire sa place,
    // pas la partie qu'il était en train de regarder.
    const entry = presence.users.get(id);
    if (entry) {
      for (const socketId of entry.sockets) {
        io.to(socketId).emit('toast', {
          message: `${user.name} t’a retiré de la table. Tu peux continuer à regarder.`,
          kind: 'warn',
        });
      }
      table.addWatcher(entry.user, [...entry.sockets][0]);
    }
    table.broadcast();
    broadcastLobby();
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

  // L'accueil affiche le minuteur de la caisse offerte sans ouvrir la page :
  // il lui faut l'état, mais surtout PAS le changement de statut, sinon la
  // liste des joueurs en ligne dirait que tout le monde est aux caisses.
  socket.on('vault:peek', () => socket.emit('vault:state', vaultPayload()));

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
      // Un palier n'est plus une course : on annonce celui qui l'atteint,
      // sans le comparer à personne.
      chat.system(`${tier.icon} ${user.name} atteint ${tier.need} objets : ${tier.name}.`, 'drop');
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

    // Un objet maudit, c'est huit chances sur dix mille. Ça mérite mieux
    // qu'une ligne de chat que tout le monde rate : tout le site s'arrête
    // une seconde pour le regarder.
    const legend = result.pulls.find((p) => p.r === 'cursed');
    if (legend) {
      io.emit('announce', {
        text: `${user.name} vient de sortir ${legend.emoji} ${legend.name} — MAUDIT. Il est trop fort.`,
        kind: 'jackpot',
      });
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
    socket.emit('medals:state', medals.view(profile));
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
      // On remet le bon exactement comme il était : rien ne doit se perdre.
      taken.restore();
      return socket.emit('toast', { message: result.message, kind: 'error' });
    }
    if (taken.left > 0) {
      socket.emit('toast', {
        message: `Il te reste ${taken.left} caisse${taken.left > 1 ? 's' : ''} de ce cadeau. Reclique pour continuer.`,
        kind: 'info',
      });
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

  /* ══════════ RAKEBACK ══════════ */

  /**
   * Une part de tout ce qui est misé revient au joueur, gagné ou perdu.
   * Le compteur monte tout seul dans `store.recordPlay` ; ici on ne fait que
   * l'afficher et le verser.
   */
  const rakePayload = () => rakeback.view(profile, store.levelFromXp(profile.xp).level);

  socket.on('rake:open', () => socket.emit('rake:state', rakePayload()));

  socket.on('rake:claim', async () => {
    const result = rakeback.claim(profile);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'warn' });

    await save();
    socket.emit('rake:state', rakePayload());
    socket.emit('profile:update', store.publicProfile(profile));
    socket.emit('toast', { message: `Rakeback récolté : +${result.amount} ¤`, kind: 'success' });
  });

  /* ══════════ LE MARCHÉ ══════════ */

  async function marketPayload(query = {}) {
    const state = await store.siteState();
    return market.view(profile, state, query);
  }

  socket.on('market:open', async (query = {}) => {
    presence.setStatus(user.id, 'market');
    socket.emit('market:state', await marketPayload(query));
  });

  socket.on('market:list', async ({ itemId, price, count } = {}) => {
    const state = await store.siteState();
    const result = market.list(profile, state, { itemId, price, count });
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });

    store.touchState();
    await save();
    socket.emit('market:state', await marketPayload());
    socket.emit('vault:state', vaultPayload());
    socket.emit('toast', { message: result.message, kind: 'success' });
    io.emit('market:changed', {});
  });

  socket.on('market:cancel', async ({ id } = {}) => {
    const state = await store.siteState();
    const result = market.cancel(profile, state, id);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });

    store.touchState();
    await save();
    socket.emit('market:state', await marketPayload());
    socket.emit('toast', { message: result.message, kind: 'info' });
    io.emit('market:changed', {});
  });

  socket.on('market:buy', async ({ id } = {}) => {
    const state = await store.siteState();
    const listing = market.ensure(state).listings.find((l) => l.id === Number(id));
    if (!listing) return socket.emit('toast', { message: 'Cette offre vient de partir.', kind: 'warn' });

    // Le vendeur est peut-être déconnecté : on charge son profil pour le
    // créditer quand même, et on l'enregistre séparément.
    const seller = listing.sellerId === user.id ? profile : await store.findProfile(listing.sellerId);
    const result = market.buy(profile, state, id, seller);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });

    store.touchState();
    await save();
    if (seller && seller !== profile) await store.saveProfile(seller);

    const earned = medals.check(profile, state.records);
    if (earned.length) store.touchState();

    socket.emit('market:state', await marketPayload());
    socket.emit('vault:state', vaultPayload({ medals: earned }));
    socket.emit('profile:update', store.publicProfile(profile));
    socket.emit('toast', {
      message: `${result.message} Le vendeur touche ${result.net} (commission ${result.fee}).`,
      kind: 'success',
    });

    // Le vendeur, s'il est là, doit voir arriver ses pièces tout de suite.
    if (seller) {
      const entry = presence.users.get(seller.id);
      if (entry) {
        for (const socketId of entry.sockets) {
          io.to(socketId).emit('profile:update', store.publicProfile(seller));
          io.to(socketId).emit('toast', {
            message: `💰 ${user.name} a acheté ton ${result.item.name} : +${result.net} ¤`,
            kind: 'success',
          });
        }
      }
    }
    io.emit('market:changed', {});
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

  socket.on('me:refresh', () => {
    sendMe();
    socket.emit('quest:state', { quests: store.questsView(profile) });
  });

  socket.on('presence:status', ({ status } = {}) => {
    // La liste des états connus vit dans `presence.js` : la recopier ici
    // en oubliant la moitié, c'est exactement ce qui faisait afficher
    // « Dans le hall » à quelqu'un assis au poker.
    if (Object.prototype.hasOwnProperty.call(STATUS_LABEL, status)) {
      presence.setStatus(user.id, status);
    }
  });

  /* ══════════ PARTY ══════════ */

  /**
   * La section Party n'a rien de commun avec le casino : pas de pièces, pas
   * de mise, pas de redistribution. On y gagne un rang à part, qui compte le
   * fait de venir jouer avec les autres plutôt que la chance.
   */

  const GAMES = PARTY_GAMES;

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

  /** Le code du salon qu'on regarde sans y jouer, s'il y en a un. */
  let watching = null;

  function stopWatching() {
    if (!watching) return;
    const room = partyRooms.get(watching);
    if (room) {
      room.unwatch(user.id, socket.id);
      socket.leave(room.channel);
      room.broadcast();
      broadcastPartyList();
    }
    watching = null;
    socket.emit('party:left', {});
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

    // Entrer dans une manche de soirée, c'est entrer dans la soirée : on
    // est inscrit au classement dès maintenant, avec zéro point, plutôt
    // qu'à la fin de la manche. Sinon on joue une partie entière sans
    // savoir qu'elle compte.
    const s = soirees.ofRoom(room);
    if (s && !s.over) {
      s.remember(room);
      emitSoiree(s);
    }
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
    // un clic : on branche la fin de partie ici, sinon les XP et le
    // classement de la soirée ne tomberaient que par hasard.
    room.onEnd = onPartyEnd;
    const result = enterRoom(room);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });
    socket.emit('party:joined', { code: room.code, game: room.game });

    /*
     * « Léa vient d'ouvrir une table de belote. »
     *
     * Avant, seuls ceux déjà dans le hall Party voyaient un salon s'ouvrir.
     * Si tu étais aux caisses, rien ne te le disait, et deux personnes
     * pouvaient s'attendre chacune de son côté sans le savoir. À trois ou
     * quatre connectés, c'est ce détail qui fait la soirée.
     *
     * On prévient tout le monde SAUF celui qui vient d'ouvrir : il est déjà
     * au courant, et une notification de sa propre action fait bête.
     */
    socket.broadcast.emit('party:invite', {
      code: room.code,
      game: room.game,
      gameName: room.gameName,
      host: user.name,
      hostAvatar: user.avatar || null,
      max: room.max,
      at: Date.now(),
    });

    // Et l'état APRÈS avoir dit où aller. `enterRoom` a déjà diffusé une
    // fois, mais le client n'écoutait pas encore : sa page du jeu n'est
    // branchée qu'au moment où il y arrive, c'est-à-dire sur ce
    // `party:joined`. Sans ce second envoi, on tombe sur un salon vide qui
    // ne se remplit qu'au premier coup joué.
    room.broadcast();
  });

  socket.on('party:join', ({ code } = {}) => {
    const room = partyRooms.get(code);
    if (!room) return socket.emit('toast', { message: 'Aucun salon avec ce code.', kind: 'error' });

    const already = partyRoom();
    if (already && already !== room) leaveParty();

    const result = enterRoom(room);
    if (!result.ok) return socket.emit('toast', { message: result.message, kind: 'error' });
    socket.emit('party:joined', { code: room.code, game: room.game });
    room.broadcast();   // même raison que ci-dessus
  });

  /*
   * REGARDER UNE PARTIE.
   *
   * On peut déjà regarder une table de blackjack ; ici c'est encore plus
   * utile, parce qu'une partie de Monopoly dure trois quarts d'heure et
   * qu'on ne peut pas y entrer une fois lancée. Le spectateur reçoit le
   * même état que les joueurs, construit pour un identifiant qui n'est à
   * aucune place : les mains, les mots et les rôles ne l'atteignent donc
   * jamais — c'est le serveur qui garantit ça, pas l'affichage.
   */
  socket.on('party:watch', ({ code } = {}) => {
    const room = partyRooms.get(code);
    if (!room) return socket.emit('toast', { message: 'Aucun salon avec ce code.', kind: 'error' });

    const already = partyRoom();
    if (already && already !== room) leaveParty();

    const result = room.watch(user, socket.id);
    if (!result.ok) {
      // Déjà à la table : autant l'y renvoyer plutôt que de refuser sèchement.
      socket.emit('party:joined', { code: room.code, game: room.game });
      room.broadcast();
      return;
    }
    socket.join(room.channel);
    watching = room.code;
    presence.setStatus(user.id, room.game);
    socket.emit('party:joined', { code: room.code, game: room.game, watching: true });
    room.broadcast();
    broadcastPartyList();
  });

  socket.on('party:unwatch', () => stopWatching());

  socket.on('party:leave', () => { stopWatching(); leaveParty(); });

  socket.on('party:list', () => socket.emit('party:list', { rooms: partyRooms.list() }));

  /*
   * LES RÉACTIONS RAPIDES.
   *
   * Personne n'écrit dans le chat pendant qu'il joue : on a les deux mains
   * sur ses cartes. Six emojis, un clic, et ça s'affiche deux secondes
   * au-dessus de son siège. C'est la version numérique du regard qu'on
   * lance à la table quand quelqu'un pose un +4.
   *
   * On limite la cadence ici, pas côté navigateur : un client bricolé ne
   * doit pas pouvoir noyer la table sous les emojis.
   */
  const REACTIONS = ['👍', '😂', '😱', '🤡', '🎉', '💀'];
  let lastReactAt = 0;

  socket.on('party:react', ({ emoji } = {}) => {
    const room = partyRoom();
    if (!room || !REACTIONS.includes(emoji)) return;
    if (!room.playerOf(user.id)) return;
    const now = Date.now();
    if (now - lastReactAt < 900) return;   // en silence : ce n'est pas une faute
    lastReactAt = now;
    room.emit('party:reaction', { id: user.id, name: user.name, emoji, at: now });
  });

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
  const creditParty = creditPartyRoom;
  void creditParty;

  /* ══════════ LA SOIRÉE ══════════
   *
   * Plusieurs jeux à la suite, un seul classement. L'organisateur choisit
   * la liste, le serveur ouvre un salon par manche, et à la fin de chaque
   * partie tout le monde bascule dans le suivant.
   *
   * On ne déplace personne de force : le serveur envoie le code du salon
   * suivant, et le navigateur le rejoint tout seul par le chemin habituel.
   */

  /** Ouvre le salon de la manche `s.step + 1` et y envoie tout le monde. */
  function openSoireeRound(s, fromRoom) {
    const id = s.nextGame;
    const entry = GAMES[id];
    if (!entry) return { ok: false, message: 'Ce jeu n’existe plus.' };

    const room = entry.build();
    room.onEnd = onPartyEnd;
    room.soiree = s.code;
    room.reserveHost = s.hostId;   // la casquette revient à l'organisateur
    s.step += 1;
    s.roomCode = room.code;
    s.awaiting = false;            // la manche est ouverte : plus rien à attendre

    // On prévient les joueurs, pas les spectateurs : un spectateur n'est
    // pas de la soirée, et il n'a rien à faire dans le salon suivant.
    const targets = fromRoom ? fromRoom.players.map((p) => p.id) : [...s.scores.keys()];
    const seen = new Set();
    for (const playerId of targets) {
      if (seen.has(playerId)) continue;
      seen.add(playerId);
      const online = presence.users.get(playerId);
      if (!online) continue;
      for (const socketId of online.sockets) {
        io.to(socketId).emit('soiree:go', { code: room.code, game: room.game, round: s.step + 1, rounds: s.games.length });
      }
    }
    emitSoiree(s);
    broadcastPartyList();
    return { ok: true, room };
  }

  socket.on('soiree:create', ({ games } = {}) => {
    const list = (Array.isArray(games) ? games : [])
      .map((g) => String(g))
      .filter((g) => GAMES[g])
      .slice(0, soirees.MAX_GAMES);

    if (list.length < soirees.MIN_GAMES) {
      return socket.emit('toast', {
        message: `Une soirée, c’est au moins ${soirees.MIN_GAMES} jeux à la suite.`, kind: 'error',
      });
    }

    // Une soirée déjà en cours pour cette personne : on ne la double pas.
    const running = soirees.ofPlayer(user.id);
    if (running && !running.over) {
      return socket.emit('toast', { message: 'Tu es déjà dans une soirée. Termine-la ou quitte-la.', kind: 'warn' });
    }

    if (partyRoom()) leaveParty();

    const s = new soirees.Soiree(list, user.id);
    s.scores.set(user.id, 0);
    s.names.set(user.id, { name: user.name, avatar: user.avatar });

    const opened = openSoireeRound(s, null);
    if (!opened.ok) { s.close(); return socket.emit('toast', { message: opened.message, kind: 'error' }); }

    const joined = enterRoom(opened.room);
    if (!joined.ok) { s.close(); opened.room.close(); return socket.emit('toast', { message: joined.message, kind: 'error' }); }
    socket.emit('party:joined', { code: opened.room.code, game: opened.room.game });
    opened.room.system(
      `Soirée en ${list.length} manches : ${list.map((g) => GAMES[g].name).join(' → ')}.`, 'end');

    socket.broadcast.emit('party:invite', {
      code: opened.room.code,
      game: opened.room.game,
      gameName: opened.room.gameName,
      host: user.name,
      hostAvatar: user.avatar || null,
      max: opened.room.max,
      soiree: list.length,
      at: Date.now(),
    });
    opened.room.broadcast();
    emitSoiree(s);
  });

  socket.on('soiree:next', () => {
    const s = soirees.ofPlayer(user.id);
    if (!s) return socket.emit('toast', { message: 'Aucune soirée en cours.', kind: 'warn' });
    if (s.hostId !== user.id) return socket.emit('toast', { message: 'C’est l’organisateur qui lance la manche suivante.', kind: 'warn' });
    if (s.over || !s.nextGame) return socket.emit('toast', { message: 'La soirée est terminée.', kind: 'info' });

    const current = s.roomCode ? partyRooms.get(s.roomCode) : null;
    /*
     * On ne saute pas une manche : il faut qu'elle ait été COMPTÉE.
     *
     * Tester la phase du salon ne suffisait pas — un salon encore au lobby
     * n'est pas « en cours », et l'organisateur pouvait donc enchaîner sans
     * que personne ait joué. Le vrai critère, c'est le classement : tant
     * que la manche n'a rien rapporté, il n'y a pas de manche suivante.
     *
     * La seule exception : un salon qui a disparu (tout le monde a fermé
     * l'onglet, le concierge l'a fermé). Là, rester bloqué serait pire.
     */
    if (!s.awaiting && current) {
      return socket.emit('toast', {
        message: current.phase === 'lobby'
          ? 'La manche n’a pas encore été jouée.'
          : 'La manche en cours n’est pas finie.',
        kind: 'warn',
      });
    }
    const opened = openSoireeRound(s, current);
    if (!opened.ok) return socket.emit('toast', { message: opened.message, kind: 'error' });
  });

  socket.on('soiree:state', () => {
    const s = soirees.ofPlayer(user.id);
    if (s) socket.emit('soiree:state', s.state());
    else socket.emit('soiree:state', null);
  });

  socket.on('soiree:quit', () => {
    const s = soirees.ofPlayer(user.id);
    if (!s) return;
    // On sort du classement, on ne supprime pas la soirée des autres.
    s.scores.delete(user.id);
    if (!s.scores.size) s.close();
    else emitSoiree(s);
    socket.emit('soiree:state', null);
  });

  /* ─── Blindtest ─── */

  const btRoom = () => {
    const room = partyRoom();
    return room && room.game === 'blindtest' ? room : null;
  };
  const btDo = (fn) => {
    const room = btRoom();
    if (!room) return;
    const result = fn(room);
    if (result && !result.ok) socket.emit('toast', { message: result.message, kind: 'warn' });
  };

  socket.on('bt:configure', (payload = {}) => btDo((r) => r.configure(user.id, payload)));
  socket.on('bt:playlist', (payload = {}) => btDo((r) => {
    const out = r.setPlaylist(user.id, payload);
    if (out.ok) socket.emit('toast', { message: `Playlist chargée : ${out.count} morceaux.`, kind: 'success' });
    return out;
  }));
  socket.on('bt:answer', ({ index } = {}) => btDo((r) => r.answer(user.id, index)));
  socket.on('bt:skip', () => btDo((r) => r.skip(user.id)));

  /* ─── Loup-garou ─── */

  const lgRoom = () => {
    const room = partyRoom();
    return room && room.game === 'loup' ? room : null;
  };
  const lgDo = (fn) => {
    const room = lgRoom();
    if (!room) return;
    const result = fn(room);
    if (result && !result.ok) socket.emit('toast', { message: result.message, kind: 'warn' });
  };

  socket.on('lg:configure', (payload = {}) => lgDo((r) => r.configure(user.id, payload)));
  socket.on('lg:wolf', ({ id } = {}) => lgDo((r) => r.wolfVote(user.id, id)));
  socket.on('lg:seer', ({ id } = {}) => lgDo((r) => r.seerLookAt(user.id, id)));
  socket.on('lg:witch', (payload = {}) => lgDo((r) => r.witchAct(user.id, payload)));
  socket.on('lg:witch-pass', () => lgDo((r) => r.witchPass(user.id)));
  socket.on('lg:vote', ({ id } = {}) => lgDo((r) => r.vote(user.id, id || null)));
  socket.on('lg:shoot', ({ id } = {}) => lgDo((r) => r.hunterShoot(user.id, id)));
  socket.on('lg:skip-debate', () => lgDo((r) => r.skipDebate(user.id)));

  /* ─── Monopoly ─── */

  /**
   * Le salon du joueur, à condition que ce soit bien une partie de
   * Monopoly. On revérifie le jeu à chaque message : un client bricolé ne
   * doit pas pouvoir envoyer « mono:roll » à une table de belote.
   */
  const monoRoom = () => {
    const room = partyRoom();
    return room && room.game === 'monopoly' ? room : null;
  };
  const monoDo = (fn) => {
    const room = monoRoom();
    if (!room) return;
    const result = fn(room);
    if (result && !result.ok) socket.emit('toast', { message: result.message, kind: 'warn' });
    if (result && result.ok && result.message) socket.emit('toast', { message: result.message, kind: 'info' });
  };

  socket.on('mono:configure', (payload = {}) => monoDo((r) => r.configure(user.id, payload)));
  socket.on('mono:roll', () => monoDo((r) => r.roll(user.id)));
  socket.on('mono:buy', () => monoDo((r) => r.buy(user.id)));
  socket.on('mono:pass', () => monoDo((r) => r.pass(user.id)));
  socket.on('mono:bid', ({ amount } = {}) => monoDo((r) => r.bid(user.id, amount)));
  socket.on('mono:bid-pass', () => monoDo((r) => r.passBid(user.id)));
  socket.on('mono:end', () => monoDo((r) => r.endTurn(user.id)));
  socket.on('mono:build', ({ cell } = {}) => monoDo((r) => r.build(user.id, Number(cell))));
  socket.on('mono:sell', ({ cell } = {}) => monoDo((r) => r.sell(user.id, Number(cell))));
  socket.on('mono:mortgage', ({ cell } = {}) => monoDo((r) => r.mortgage(user.id, Number(cell))));
  socket.on('mono:unmortgage', ({ cell } = {}) => monoDo((r) => r.unmortgage(user.id, Number(cell))));
  socket.on('mono:jail-pay', () => monoDo((r) => r.payJail(user.id)));
  socket.on('mono:jail-card', () => monoDo((r) => r.useFreeCard(user.id)));
  socket.on('mono:pay', () => monoDo((r) => r.pay(user.id)));
  socket.on('mono:bankrupt', () => monoDo((r) => r.bankrupt(user.id)));
  socket.on('mono:offer', (payload = {}) => monoDo((r) => r.offer(user.id, payload)));
  socket.on('mono:trade', ({ accept } = {}) => monoDo((r) => r.respondTrade(user.id, Boolean(accept))));

  /* ─── Belote ─── */

  const blRoom = () => {
    const room = partyRoom();
    return room && room.game === 'belote' ? room : null;
  };
  const blDo = (fn) => {
    const room = blRoom();
    if (!room) return;
    const result = fn(room);
    if (result && !result.ok) socket.emit('toast', { message: result.message, kind: 'warn' });
  };

  socket.on('bl:configure', (payload = {}) => blDo((r) => r.configure(user.id, payload)));
  socket.on('bl:bid', ({ take, suit } = {}) => blDo((r) => r.bid(user.id, { take, suit })));
  socket.on('bl:play', ({ cardId } = {}) => blDo((r) => r.play(user.id, { cardId })));

  /* ─── Uno ─── */

  /**
   * Le salon du joueur, à condition que ce soit bien une table d'Uno.
   *
   * On revérifie le jeu à chaque message : sans ça, un client bricolé
   * pourrait envoyer « uno:play » à une partie de poker et faire planter la
   * soirée de tout le monde.
   */
  const unoRoom = () => {
    const room = partyRoom();
    return room && room.game === 'uno' ? room : null;
  };

  /** Renvoie le refus au joueur, sans rien dire aux autres. */
  const unoDo = (fn) => {
    const room = unoRoom();
    if (!room) return;
    const result = fn(room);
    if (result && !result.ok) socket.emit('toast', { message: result.message, kind: 'warn' });
  };

  socket.on('uno:configure', (payload = {}) => unoDo((r) => r.configure(user.id, payload)));
  socket.on('uno:play', ({ cardId, color } = {}) => unoDo((r) => r.play(user.id, { cardId, color })));
  socket.on('uno:draw', () => unoDo((r) => r.pick(user.id)));
  socket.on('uno:keep', () => unoDo((r) => r.keep(user.id)));
  socket.on('uno:challenge', () => unoDo((r) => r.challenge(user.id)));
  socket.on('uno:say', () => unoDo((r) => r.sayUno(user.id)));
  socket.on('uno:catch', ({ id } = {}) => unoDo((r) => r.catchUno(user.id, id)));

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
    stopWatching();
    leavePartySocket();
    presence.leave(socket, user.id);
    refreshAdmins();
    clicker.collect(profile);
    save();
  });
});

blackjack.startJanitor();
// Le registre d'économie verse son tampon dans l'état du site.
ledger.start();
restorePartyRooms();

/*
 * UN DÉFI QUI TOMBE.
 *
 * Les pièces sont déjà créditées par `quests.record` ; ici on ne fait que
 * le dire — une fenêtre, un son, et le profil rafraîchi. Pas de bouton
 * « récupérer » : une récompense qu'on oublie de prendre et qui disparaît
 * à minuit est une punition déguisée en fonctionnalité.
 */
store.onQuestDone((profile, done) => {
  const entry = presence.users.get(profile.id);
  if (!entry) return;
  entry.profile = profile;
  for (const socketId of entry.sockets) {
    io.to(socketId).emit('profile:update', store.publicProfile(profile));
    io.to(socketId).emit('quest:done', { done, quests: store.questsView(profile) });
  }
});
// Une place libérée toute seule (siège quitté en pleine main, récupéré en
// fin de main) doit rafraîchir le hall sans que personne n'ait cliqué.
blackjack.onLobbyChange(broadcastLobby);

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
      // Les parties en cours partent dans la base AVANT de fermer : c'est
      // tout l'intérêt de l'exercice.
      await savePartyRooms();
      await ledger.flush();
      await store.close();
    } catch {}
    process.exit(0);
  });
}
