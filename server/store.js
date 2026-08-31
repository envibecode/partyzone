'use strict';
/**
 * Persistance des profils joueurs : pièces, XP, statistiques de jeu,
 * collection de caisses, mine, et graines d'équité vérifiable.
 *
 * Deux back-ends, choisis automatiquement :
 *   • DATABASE_URL défini  → PostgreSQL (les données survivent aux redéploiements)
 *   • sinon                → fichier JSON dans data/profiles.json
 *
 * Le fichier JSON suffit en local et pour dépanner. En ligne sur une offre
 * gratuite, le disque est effacé à chaque redéploiement : c'est pour ça que
 * l'adaptateur Postgres existe (voir README).
 */
const fs = require('fs');
const path = require('path');
const { blankVault } = require('./vault');
const { blankClicker } = require('./clicker');
const fairness = require('./fair');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'profiles.json');
const MAX_LEVEL = 99;

/* ─── Courbe d'expérience ──────────────────────────────── */

/** XP nécessaire pour passer du niveau `level` au suivant. */
function xpToNext(level) {
  return Math.round(100 * Math.pow(1.16, level - 1));
}

/** Décompose un total d'XP en niveau + progression dans le niveau. */
function levelFromXp(xp) {
  let level = 1;
  let spent = 0;
  let need = xpToNext(1);
  while (level < MAX_LEVEL && xp >= spent + need) {
    spent += need;
    level++;
    need = xpToNext(level);
  }
  return {
    level,
    into: Math.max(0, xp - spent),
    need: level >= MAX_LEVEL ? 0 : need,
    ratio: level >= MAX_LEVEL ? 1 : Math.min(1, (xp - spent) / need),
  };
}

/** Titre affiché à côté du pseudo, façon rang arcade. */
function rankTitle(level) {
  if (level >= 99) return 'GOD MODE';
  if (level >= 70) return 'LEGEND';
  if (level >= 50) return 'MASTER';
  if (level >= 35) return 'VETERAN';
  if (level >= 22) return 'RAIDER';
  if (level >= 12) return 'PLAYER';
  if (level >= 5) return 'ROOKIE';
  return 'NOOB';
}

/* ─── Forme d'un profil ────────────────────────────────── */

function blankProfile(user, now = Date.now()) {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar || null,
    provider: user.provider || 'guest',
    xp: 0,
    stats: {
      wagered: 0, // total misé, tous jeux confondus
      returned: 0, // total récupéré
      rounds: 0, // nombre de manches jouées
      biggestWin: 0,
      cases: 0,
    },
    vault: blankVault(now),
    clicker: blankClicker(now),
    fair: fairness.blankFair(),
    admin: false,
    banned: false,
    banReason: '',
    createdAt: now,
    updatedAt: now,
    seenAt: now,
  };
}

/** Complète un profil chargé depuis le disque avec les champs manquants. */
function migrate(profile, now = Date.now()) {
  const fresh = blankProfile({ id: profile.id, name: profile.name }, now);
  const merged = {
    ...fresh,
    ...profile,
    stats: { ...fresh.stats, ...(profile.stats || {}) },
    vault: { ...fresh.vault, ...(profile.vault || {}) },
    clicker: { ...fresh.clicker, ...(profile.clicker || {}) },
    fair: profile.fair && profile.fair.serverSeed ? profile.fair : fresh.fair,
  };
  merged.vault.items = { ...(merged.vault.items || {}) };
  merged.clicker.upgrades = { ...fresh.clicker.upgrades, ...(merged.clicker.upgrades || {}) };
  delete merged.farm;
  return merged;
}

/* ─── Back-end fichier ─────────────────────────────────── */

class FileBackend {
  constructor() {
    this.map = new Map();
    this.dirty = false;
    this.load();
    this.timer = setInterval(() => this.flush(), 5000);
    if (this.timer.unref) this.timer.unref();
  }

  load() {
    try {
      const raw = fs.readFileSync(FILE, 'utf8');
      for (const p of JSON.parse(raw)) this.map.set(p.id, migrate(p));
      console.log(`[store] ${this.map.size} profils chargés depuis data/profiles.json`);
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[store] fichier illisible, on repart à zéro :', err.message);
    }
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify([...this.map.values()]), 'utf8');
    } catch (err) {
      console.error('[store] écriture impossible :', err.message);
    }
  }

  async ready() {}
  async get(id) {
    return this.map.get(id) || null;
  }
  async put(profile) {
    this.map.set(profile.id, profile);
    this.dirty = true;
  }
  async all() {
    return [...this.map.values()];
  }
  async remove(id) {
    this.map.delete(id);
    this.dirty = true;
  }
  async close() {
    this.flush();
  }
}

/* ─── Back-end PostgreSQL ──────────────────────────────── */

class PostgresBackend {
  constructor(url) {
    const { Pool } = require('pg');
    this.pool = new Pool({
      connectionString: url,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
      max: 4,
    });
    this.cache = new Map();
    this.initPromise = this.init();
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id         TEXT PRIMARY KEY,
        data       JSONB NOT NULL,
        xp         INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await this.pool.query('CREATE INDEX IF NOT EXISTS profiles_xp_idx ON profiles (xp DESC)');
    console.log('[store] PostgreSQL prêt');
  }

  async ready() {
    return this.initPromise;
  }

  async get(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const { rows } = await this.pool.query('SELECT data FROM profiles WHERE id = $1', [id]);
    if (!rows.length) return null;
    const profile = migrate(rows[0].data);
    this.cache.set(id, profile);
    return profile;
  }

  async put(profile) {
    this.cache.set(profile.id, profile);
    await this.pool.query(
      `INSERT INTO profiles (id, data, xp, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET data = $2, xp = $3, updated_at = now()`,
      [profile.id, JSON.stringify(profile), profile.xp]
    );
  }

  async all() {
    const { rows } = await this.pool.query('SELECT data FROM profiles ORDER BY xp DESC LIMIT 1000');
    return rows.map((r) => migrate(r.data));
  }

  async remove(id) {
    this.cache.delete(id);
    await this.pool.query('DELETE FROM profiles WHERE id = $1', [id]);
  }

  async close() {
    await this.pool.end();
  }
}

/* ─── Façade ───────────────────────────────────────────── */

let backend;
if (process.env.DATABASE_URL) {
  try {
    backend = new PostgresBackend(process.env.DATABASE_URL);
  } catch (err) {
    console.error('[store] PostgreSQL indisponible (' + err.message + '), repli sur le fichier JSON');
    backend = new FileBackend();
  }
} else {
  backend = new FileBackend();
}

/** Récupère (ou crée) le profil d'un utilisateur, et rafraîchit pseudo/avatar. */
async function loadProfile(user) {
  await backend.ready();
  let profile = await backend.get(user.id);
  if (!profile) {
    profile = blankProfile(user);
    await backend.put(profile);
  } else if (profile.name !== user.name || profile.avatar !== (user.avatar || null)) {
    profile.name = user.name;
    profile.avatar = user.avatar || null;
    await backend.put(profile);
  }
  return profile;
}

async function saveProfile(profile) {
  profile.updatedAt = Date.now();
  await backend.put(profile);
}

/** Vue publique d'un profil (ce qui part vers le navigateur). */
function publicProfile(profile) {
  const lvl = levelFromXp(profile.xp);
  return {
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    provider: profile.provider,
    xp: profile.xp,
    level: lvl.level,
    into: lvl.into,
    need: lvl.need,
    ratio: lvl.ratio,
    title: rankTitle(lvl.level),
    admin: Boolean(profile.admin),
    stats: profile.stats,
    coins: profile.vault.coins,
    collected: Object.values(profile.vault.items || {}).filter((n) => n > 0).length,
    fair: fairness.publicFair(profile.fair),
  };
}

/**
 * Classement général. Deux lectures possibles :
 *   • « fortune » — qui a le plus de pièces, la mesure d'un casino ;
 *   • « niveau »  — qui a le plus joué, indépendamment de la chance.
 */
async function leaderboard(limit = 20, sort = 'coins') {
  await backend.ready();
  const all = await backend.all();
  const key = sort === 'xp' ? (p) => p.xp : (p) => p.vault.coins;
  return all
    .filter((p) => key(p) > 0 && !p.banned)
    .sort((a, b) => key(b) - key(a) || a.createdAt - b.createdAt)
    .slice(0, limit)
    .map((p, i) => ({ rank: i + 1, ...publicProfile(p) }));
}

/**
 * Enregistre une manche jouée : mise, retour, et l'XP qui va avec.
 * L'XP progresse avec le volume joué, pas avec la chance — c'est ce qui
 * rend le classement « niveau » lisible.
 */
function recordPlay(profile, staked, returned) {
  const s = profile.stats;
  s.wagered += staked;
  s.returned += returned;
  s.rounds += 1;
  s.biggestWin = Math.max(s.biggestWin, returned);
  const xp = Math.max(1, Math.floor(staked / 20));
  grantXp(profile, xp);
  return xp;
}

/** Ajoute de l'XP et signale un éventuel passage de niveau. */
function grantXp(profile, amount) {
  const before = levelFromXp(profile.xp).level;
  profile.xp = Math.max(0, profile.xp + Math.round(amount));
  const after = levelFromXp(profile.xp).level;
  return { gained: Math.round(amount), levelUp: after > before, level: after };
}

/** Tous les profils enregistrés — réservé au panel d'administration. */
async function allProfiles() {
  await backend.ready();
  return backend.all();
}

/** Lit un profil par son identifiant, sans le créer s'il n'existe pas. */
async function findProfile(id) {
  await backend.ready();
  return backend.get(id);
}

async function deleteProfile(id) {
  await backend.ready();
  return backend.remove(id);
}

async function close() {
  await backend.close();
}

module.exports = {
  loadProfile,
  saveProfile,
  publicProfile,
  leaderboard,
  grantXp,
  recordPlay,
  allProfiles,
  findProfile,
  deleteProfile,
  levelFromXp,
  rankTitle,
  close,
  MAX_LEVEL,
};
