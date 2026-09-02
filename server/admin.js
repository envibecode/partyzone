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
const blackjack = require('./blackjack');
const collection = require('./data/collection');
const gifts = require('./gifts');
const market = require('./market');
const ledger = require('./ledger');
const { CASES } = require('./data/cases');

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
  const totalCoins = profiles.reduce((sum, p) => sum + ((p.vault && p.vault.coins) || 0), 0);
  const wagered = profiles.reduce((sum, p) => sum + ((p.stats && p.stats.wagered) || 0), 0);
  const returned = profiles.reduce((sum, p) => sum + ((p.stats && p.stats.returned) || 0), 0);
  const rounds = profiles.reduce((sum, p) => sum + ((p.stats && p.stats.rounds) || 0), 0);
  const banned = profiles.filter((p) => p.banned).length;
  const admins = profiles.filter((p) => isAdmin(p)).length;

  return {
    stats: {
      players: profiles.length,
      online: online.length,
      tables: blackjack.tables.size,
      totalXp,
      totalCoins,
      totalOpened,
      rounds,
      wagered,
      returned,
      // Taux de redistribution réellement observé sur tout le site.
      realRtp: wagered > 0 ? Math.round((returned / wagered) * 10000) / 100 : null,
      banned,
      admins,
      uptime: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      storage: process.env.DATABASE_URL ? 'PostgreSQL' : 'fichier JSON',
      discord: Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
      adminKey: adminKeyConfigured(),
    },
    tables: [...blackjack.tables.values()].map((table) => {
      const host = table.seats.find((s) => s.id === table.hostId);
      return {
        code: table.code,
        host: host ? host.name : '—',
        seated: table.seats.length,
        humans: table.seats.length,
        phase: table.phase,
        hand: table.hand,
      };
    }),
    online,
    log,
    // L'état de la porte, pour que le panel affiche l'interrupteur dans la
    // bonne position au lieu de le deviner.
    gate: await (async () => {
      const g = require('./gate');
      const cfg = await g.config();
      return { mode: cfg.mode, opensAt: cfg.opensAt, open: await g.isOpen() };
    })(),
    // La liste des caisses distribuables, pour que le panel puisse proposer
    // un menu déroulant plutôt que de faire taper un identifiant à la main.
    cases: CASES.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, price: c.price })),
    // Les offres du marché, les plus chères par rapport à leur valeur en
    // premier : c'est là que se cachent les transferts déguisés.
    market: market.all(await store.siteState()),
    // Le registre d'économie : ce que le site fabrique et détruit chaque
    // jour, et par quelle porte.
    ledger: ledger.view(await store.siteState(), { days: 14 }),
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
          collectionTotal: collection.TOTAL,
          rounds: p.stats.rounds || 0,
          wagered: p.stats.wagered || 0,
          returned: p.stats.returned || 0,
          biggestWin: p.stats.biggestWin || 0,
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
  const { io, presence, chat } = ctx;
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
      // Un cadeau d'administrateur fabrique de la monnaie comme la mine :
      // il doit apparaître au registre, sinon la courbe d'inflation ment.
      if (amount > 0) ledger.mint('cadeau admin', amount);
      else ledger.burn('reprise admin', -amount);
      await store.saveProfile(target);
      record(actor, 'pièces', target.name, `${amount > 0 ? '+' : ''}${amount} pièces`);
      pushProfile(io, presence, target);
      return { ok: true, message: `${target.name} : ${amount > 0 ? '+' : ''}${amount} pièces.` };
    }

    /**
     * Renommer un joueur.
     *
     * Le pseudo voyage dans les salons, le chat et les tables déjà ouverts,
     * qui en gardent chacun une copie ; on ne peut donc pas se contenter de
     * changer le profil. Les endroits qui affichent un pseudo se remettent à
     * jour à la prochaine diffusion, sauf les tables en cours — d'où la
     * mise à jour explicite des sièges.
     */
    case 'rename': {
      const target = await loadTarget();
      const wanted = String(payload.name || '').replace(/\s+/g, ' ').trim();

      if (wanted.length < 2 || wanted.length > 18) {
        return { ok: false, message: 'Un pseudo fait entre 2 et 18 caractères.' };
      }
      const all = await store.allProfiles();
      const taken = all.some((p) => p.id !== target.id && p.name.toLowerCase() === wanted.toLowerCase());
      if (taken) return { ok: false, message: `« ${wanted} » est déjà pris.` };

      const before = target.name;
      if (before === wanted) return { ok: false, message: 'C’est déjà son pseudo.' };

      target.name = wanted;
      await store.saveProfile(target);

      for (const table of blackjack.tables.values()) {
        const seat = table.seats.find((s) => s.id === target.id);
        if (seat) { seat.name = wanted; table.broadcast(); }
      }

      record(actor, 'renommage', before, `devient « ${wanted} »`);
      pushProfile(io, presence, target);

      // Le joueur concerné doit voir son nouveau nom sans recharger.
      if (io && presence) {
        const entry = presence.users.get(target.id);
        if (entry) {
          entry.user.name = wanted;
          for (const socketId of entry.sockets) {
            io.to(socketId).emit('me:renamed', { name: wanted });
            io.to(socketId).emit('toast', { message: `Tu t’appelles maintenant ${wanted}.`, kind: 'info' });
          }
          presence.schedule();
        }
      }
      return { ok: true, message: `${before} s’appelle maintenant ${wanted}.` };
    }

    case 'ban': {
      const target = await loadTarget();
      if (isAdmin(target)) return { ok: false, message: 'On ne bannit pas un administrateur.' };
      target.banned = true;
      target.banReason = String(payload.reason || '').slice(0, 140) || 'Comportement inapproprié.';
      await store.saveProfile(target);
      record(actor, 'bannissement', target.name, target.banReason);
      if (chat) chat.mute(target.id, 24 * 60, 'compte banni');
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
      target.stats = { wagered: 0, returned: 0, rounds: 0, biggestWin: 0, cases: 0 };
      target.vault = require('./vault').blankVault();
      target.clicker = require('./clicker').blankClicker();
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

    case 'close-table': {
      const code = String(payload.code || '').toUpperCase();
      const table = blackjack.getTable(code);
      if (!table) return { ok: false, message: 'Table introuvable.' };
      if (io) io.to('bj:' + code).emit('toast', { message: 'Cette table a été fermée par un administrateur.', kind: 'warn' });
      blackjack.closeTable(code);
      record(actor, 'table fermée', code);
      return { ok: true, message: `Table ${code} fermée.` };
    }

    /*
     * L'OUVERTURE DU SITE.
     *
     * Trois modes seulement, et le mode normal est celui où personne n'a
     * rien à faire : « auto » ouvre tout seul à l'heure dite. Les deux
     * autres servent aux imprévus — ouvrir plus tôt parce que tout est
     * prêt, refermer parce qu'on a cassé quelque chose.
     */
    case 'site-gate': {
      const gate = require('./gate');
      const next = await gate.setConfig({ mode: payload.mode, opensAt: payload.opensAt });
      const open = await gate.isOpen();
      record(actor, 'porte du site', next.mode, new Date(next.opensAt).toISOString());
      const said = {
        auto: `Ouverture automatique le ${new Date(next.opensAt).toLocaleString('fr-FR', {
          timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short',
        })}.`,
        open: 'Le site est ouvert à tout le monde.',
        closed: 'Le site est fermé : seule la clé d’administration passe.',
      }[next.mode];
      return { ok: true, message: said, gate: { ...next, open } };
    }

    case 'announce': {
      const text = String(payload.text || '').trim().slice(0, 200);
      if (!text) return { ok: false, message: 'Message vide.' };
      // Une annonce doit se voir : fenêtre animée chez tout le monde, plus
      // une trace dans le chat pour ceux qui arrivent après.
      io.emit('announce', { text });
      if (chat) chat.system(`📢 ${text}`, 'announce');
      record(actor, 'annonce', 'tout le site', text);
      return { ok: true, message: 'Annonce envoyée.' };
    }

    case 'grant-case': {
      const target = await loadTarget();
      const result = gifts.grant(target, payload.caseId, payload.count, actor.name);
      if (!result.ok) return result;
      await store.saveProfile(target);
      record(actor, 'caisses', target.name, `${result.gift.count} × ${result.gift.caseName}`);
      pushProfile(io, presence, target);
      if (io && presence) {
        const entry = presence.users.get(target.id);
        if (entry) {
          for (const socketId of entry.sockets) {
            io.to(socketId).emit('gift:received', result.gift);
          }
        }
      }
      return result;
    }

    /* ── Modération du chat ── */

    case 'mute': {
      const target = await loadTarget();
      if (isAdmin(target)) return { ok: false, message: 'On ne coupe pas la parole à un administrateur.' };
      const minutes = Math.max(1, Math.min(1440, Math.round(Number(payload.minutes) || 10)));
      const reason = String(payload.reason || '').slice(0, 120);
      if (chat) chat.mute(target.id, minutes, reason);
      record(actor, 'chat coupé', target.name, `${minutes} min${reason ? ` — ${reason}` : ''}`);
      if (io && presence) {
        const entry = presence.users.get(target.id);
        if (entry) {
          for (const socketId of entry.sockets) {
            io.to(socketId).emit('toast', {
              message: `Tu ne peux plus écrire dans le chat pendant ${minutes} min.${reason ? ` (${reason})` : ''}`,
              kind: 'warn',
            });
          }
        }
      }
      return { ok: true, message: `${target.name} est muet pendant ${minutes} min.` };
    }

    case 'unmute': {
      const target = await loadTarget();
      if (chat) chat.unmute(target.id);
      record(actor, 'chat rendu', target.name);
      return { ok: true, message: `${target.name} peut réécrire.` };
    }

    case 'delete-message': {
      if (!chat) return { ok: false, message: 'Chat indisponible.' };
      const done = chat.remove(String(payload.id || ''));
      if (!done) return { ok: false, message: 'Message introuvable (déjà parti ?).' };
      record(actor, 'message supprimé', payload.author || '—');
      return { ok: true, message: 'Message supprimé.' };
    }

    /*
     * RETIRER UNE OFFRE DU MARCHÉ.
     *
     * L'objet retourne au vendeur, pas à l'administrateur : on retire une
     * vitrine, on ne confisque pas. Le vendeur est prévenu et voit son
     * objet revenir dans son coffre, en ligne ou non.
     */
    case 'market-remove': {
      const state = await store.siteState();
      const result = market.takeDown(state, payload.listingId);
      if (!result.ok) return result;

      store.touchState();
      await store.flushState();

      const { listing } = result;
      const label = result.item ? result.item.name : listing.itemId;
      const seller = await store.findProfile(listing.sellerId);
      if (seller) {
        seller.vault.items[listing.itemId] = (seller.vault.items[listing.itemId] || 0) + listing.count;
        await store.saveProfile(seller);
        pushProfile(io, presence, seller);
        if (io && presence) {
          const entry = presence.users.get(seller.id);
          if (entry) {
            for (const socketId of entry.sockets) {
              io.to(socketId).emit('toast', {
                message: `Ton offre « ${label} » a été retirée du marché par un administrateur. L’objet est revenu dans ton coffre.`,
                kind: 'warn',
              });
            }
          }
        }
      }

      if (io) io.emit('market:changed', {});
      record(actor, 'offre retirée', listing.sellerName || '—', `${listing.count} × ${label} à ${listing.price} ¤`);
      return { ok: true, message: `Offre retirée. ${listing.count} × ${label} rendu${listing.count > 1 ? 's' : ''} à ${listing.sellerName || 'son vendeur'}.` };
    }

    case 'clear-chat': {
      if (!chat) return { ok: false, message: 'Chat indisponible.' };
      chat.clear();
      record(actor, 'chat vidé', 'tout le site');
      return { ok: true, message: 'Chat vidé.' };
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

module.exports = {
  isAdmin, claim, adminKeyConfigured, snapshot, players, act, record, log,
  // La liste des caisses distribuables, pour le menu du panel.
  giftableCases: () => CASES.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, price: c.price })),
};
