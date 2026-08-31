'use strict';
/**
 * Panel d'administration.
 *
 * Qui est admin ?
 *   • tout identifiant listé dans la variable d'environnement ADMIN_IDS
 *     (séparés par des virgules, par exemple « discord:1234,guest:ab12… ») ;
 *   • ou toute personne qui a saisi une fois la clé ADMIN_KEY sur le site —
 *     le droit est alors enregistré dans son profil, définitivement.
 *
 * La deuxième voie existe parce qu'on ne connaît pas son propre identifiant
 * avant de s'être connecté : on met une clé secrète dans l'hébergeur, on la
 * tape une fois, et c'est réglé.
 *
 * IMPORTANT : chaque action revérifie les droits côté serveur. Rien ne repose
 * sur le fait que le bouton soit affiché ou non dans le navigateur.
 */
const store = require('./store');
const { rooms, closeRoom } = require('./room');
const { MEMES } = require('./data/memes');

const MAX_LOG = 60;
const log = [];

function envAdminIds() {
  return String(process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAdmin(profile) {
  if (!profile) return false;
  if (profile.admin === true) return true;
  return envAdminIds().includes(profile.id);
}

function adminKeyConfigured() {
  return Boolean(process.env.ADMIN_KEY && String(process.env.ADMIN_KEY).length >= 6);
}

/** Tentative de prise de droits avec la clé secrète. */
async function claim(profile, key) {
  if (!adminKeyConfigured()) {
    return { ok: false, message: 'Aucune clé administrateur n’est configurée sur ce serveur.' };
  }
  if (String(key || '') !== String(process.env.ADMIN_KEY)) {
    record(profile, 'claim-refused', '—', 'clé invalide');
    return { ok: false, message: 'Clé incorrecte.' };
  }
  profile.admin = true;
  await store.saveProfile(profile);
  record(profile, 'claim', profile.name, 'droits administrateur obtenus');
  return { ok: true, message: 'Tu es maintenant administrateur.' };
}

/* ─── Journal ──────────────────────────────────────────── */

function record(actor, action, target, detail = '') {
  log.unshift({
    at: Date.now(),
    actor: actor ? actor.name : 'système',
    action,
    target,
    detail,
  });
  log.length = Math.min(log.length, MAX_LOG);
}

/* ─── Vue d'ensemble ───────────────────────────────────── */

async function snapshot(presence) {
  const profiles = await store.allProfiles();
  const online = presence.list();

  const totalXp = profiles.reduce((sum, p) => sum + (p.xp || 0), 0);
  const totalOpened = profiles.reduce((sum, p) => sum + ((p.vault && p.vault.opened) || 0), 0);
  const totalGames = profiles.reduce((sum, p) => sum + ((p.stats && p.stats.games) || 0), 0);
  const banned = profiles.filter((p) => p.banned).length;
  const admins = profiles.filter((p) => isAdmin(p)).length;

  return {
    stats: {
      players: profiles.length,
      online: online.length,
      rooms: rooms.size,
      totalXp,
      totalGames,
      totalOpened,
      banned,
      admins,
      uptime: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      storage: process.env.DATABASE_URL ? 'PostgreSQL' : 'fichier JSON',
      discord: Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
      adminKey: adminKeyConfigured(),
    },
    rooms: [...rooms.values()].map((room) => {
      const host = room.players.get(room.hostId);
      return {
        code: room.code,
        host: host ? host.name : '—',
        players: room.playerList().length,
        connected: room.connectedPlayers().length,
        game: room.gameKey,
        phase: room.game ? room.game.phase : null,
        hasPlaylist: Boolean(room.playlist && room.playlist.tracks.length),
        createdAt: room.createdAt,
      };
    }),
    online,
    log,
  };
}

/** Liste paginée et filtrable des joueurs. */
async function players({ query = '', sort = 'xp', limit = 40 } = {}) {
  const all = await store.allProfiles();
  const q = String(query || '').trim().toLowerCase();

  const filtered = q
    ? all.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
    : all;

  const sorters = {
    xp: (a, b) => b.xp - a.xp,
    name: (a, b) => a.name.localeCompare(b.name),
    recent: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    coins: (a, b) => (b.vault.coins || 0) - (a.vault.coins || 0),
  };

  return {
    total: filtered.length,
    players: filtered
      .sort(sorters[sort] || sorters.xp)
      .slice(0, Math.min(120, Math.max(5, limit)))
      .map((p) => {
        const lvl = store.levelFromXp(p.xp);
        const collected = Object.values(p.vault.items || {}).filter((n) => n > 0).length;
        return {
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          provider: p.provider,
          xp: p.xp,
          level: lvl.level,
          title: store.rankTitle(lvl.level),
          coins: p.vault.coins,
          opened: p.vault.opened,
          collected,
          collectionTotal: MEMES.length,
          games: p.stats.games,
          wins: p.stats.wins,
          admin: isAdmin(p),
          envAdmin: envAdminIds().includes(p.id),
          banned: Boolean(p.banned),
          banReason: p.banReason || '',
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        };
      }),
  };
}

/* ─── Actions ──────────────────────────────────────────── */

/**
 * Exécute une action d'administration. `actor` est le profil de l'admin,
 * déjà vérifié par l'appelant.
 */
async function act(actor, action, payload = {}, ctx = {}) {
  const { io, presence } = ctx;
  const targetId = payload.id;

  /** Charge la cible et refuse si elle n'existe pas. */
  const loadTarget = async () => {
    const target = await store.findProfile(targetId);
    if (!target) throw new Error('Joueur introuvable.');
    return target;
  };

  switch (action) {
    case 'grant-xp': {
      const target = await loadTarget();
      const amount = Math.round(Number(payload.amount) || 0);
      if (!amount) return { ok: false, message: 'Indique une quantité.' };
      store.grantXp(target, amount);
      await store.saveProfile(target);
      record(actor, 'xp', target.name, `${amount > 0 ? '+' : ''}${amount} XP`);
      pushProfile(io, presence, target);
      return { ok: true, message: `${target.name} : ${amount > 0 ? '+' : ''}${amount} XP.` };
    }

    case 'grant-coins': {
      const target = await loadTarget();
      const amount = Math.round(Number(payload.amount) || 0);
      if (!amount) return { ok: false, message: 'Indique une quantité.' };
      target.vault.coins = Math.max(0, target.vault.coins + amount);
      await store.saveProfile(target);
      record(actor, 'pièces', target.name, `${amount > 0 ? '+' : ''}${amount} pièces`);
      pushProfile(io, presence, target);
      return { ok: true, message: `${target.name} : ${amount > 0 ? '+' : ''}${amount} pièces.` };
    }

    case 'ban': {
      const target = await loadTarget();
      if (isAdmin(target)) return { ok: false, message: 'On ne bannit pas un administrateur.' };
      target.banned = true;
      target.banReason = String(payload.reason || '').slice(0, 140) || 'Comportement inapproprié.';
      await store.saveProfile(target);
      record(actor, 'bannissement', target.name, target.banReason);
      kick(io, presence, target, target.banReason);
      return { ok: true, message: `${target.name} est banni.` };
    }

    case 'unban': {
      const target = await loadTarget();
      target.banned = false;
      target.banReason = '';
      await store.saveProfile(target);
      record(actor, 'débannissement', target.name);
      return { ok: true, message: `${target.name} peut revenir.` };
    }

    case 'set-admin': {
      const target = await loadTarget();
      const value = Boolean(payload.value);
      if (target.id === actor.id && !value) {
        return { ok: false, message: 'Tu ne peux pas retirer tes propres droits ici.' };
      }
      if (!value && envAdminIds().includes(target.id)) {
        return { ok: false, message: 'Ce compte est admin via ADMIN_IDS : retire-le de la variable d’environnement.' };
      }
      target.admin = value;
      if (value) target.banned = false;
      await store.saveProfile(target);
      record(actor, value ? 'promotion' : 'rétrogradation', target.name);
      pushProfile(io, presence, target);
      return { ok: true, message: `${target.name} ${value ? 'est administrateur' : 'n’est plus administrateur'}.` };
    }

    case 'reset': {
      const target = await loadTarget();
      if (isAdmin(target) && target.id !== actor.id) {
        return { ok: false, message: 'On ne réinitialise pas un autre administrateur.' };
      }
      target.xp = 0;
      target.stats = { games: 0, blindtest: 0, quiz: 0, undercover: 0, wins: 0, bestScore: 0, correct: 0 };
      target.vault = require('./vault').blankVault();
      await store.saveProfile(target);
      record(actor, 'réinitialisation', target.name);
      pushProfile(io, presence, target);
      return { ok: true, message: `${target.name} repart de zéro.` };
    }

    case 'delete': {
      const target = await loadTarget();
      if (isAdmin(target)) return { ok: false, message: 'On ne supprime pas un administrateur.' };
      await store.deleteProfile(target.id);
      record(actor, 'suppression', target.name);
      kick(io, presence, target, 'Ton profil a été supprimé.');
      return { ok: true, message: `Profil de ${target.name} supprimé.` };
    }

    case 'close-room': {
      const code = String(payload.code || '').toUpperCase();
      const done = closeRoom(code);
      if (!done) return { ok: false, message: 'Salon introuvable.' };
      record(actor, 'salon fermé', code);
      return { ok: true, message: `Salon ${code} fermé.` };
    }

    case 'announce': {
      const text = String(payload.text || '').trim().slice(0, 200);
      if (!text) return { ok: false, message: 'Message vide.' };
      io.emit('toast', { message: `📢 ${text}`, kind: 'info' });
      record(actor, 'annonce', 'tout le site', text);
      return { ok: true, message: 'Annonce envoyée.' };
    }

    default:
      return { ok: false, message: 'Action inconnue.' };
  }
}

/* ─── Effets de bord ───────────────────────────────────── */

/** Prévient le joueur concerné que son profil a changé. */
function pushProfile(io, presence, target) {
  if (!io || !presence) return;
  const entry = presence.users.get(target.id);
  if (!entry) return;
  entry.profile = target;
  for (const socketId of entry.sockets) {
    io.to(socketId).emit('profile:update', store.publicProfile(target));
  }
  presence.schedule();
}

/** Déconnecte immédiatement toutes les sessions d'un joueur. */
function kick(io, presence, target, reason) {
  if (!io || !presence) return;
  const entry = presence.users.get(target.id);
  if (!entry) return;
  for (const socketId of [...entry.sockets]) {
    io.to(socketId).emit('kicked', { reason });
    const socket = io.sockets.sockets.get(socketId);
    if (socket) setTimeout(() => socket.disconnect(true), 150);
  }
}

module.exports = { isAdmin, claim, adminKeyConfigured, snapshot, players, act, record, log };
