'use strict';
/**
 * ROULETTE européenne, en tours partagés.
 *
 * Il n'y a qu'une seule roue pour tout le site : tout le monde mise sur le
 * même tour, voit la même bille et le même résultat. Un cycle dure environ
 * 33 secondes — 20 s de mises, 7 s de rotation, 6 s de résultat — et
 * s'enchaîne sans fin.
 *
 * Un seul zéro (37 cases), donc l'avantage de la maison est de 1/37, soit un
 * taux de redistribution de 97,3 % sur TOUTES les mises, quelle qu'elle soit.
 * C'est la règle européenne, et c'est affiché en clair.
 */
const crypto = require('crypto');
const fair = require('./fair');
const medals = require('./medals');

const BETTING_MS = 20000;
const SPIN_MS = 7000;
const RESULT_MS = 6000;

const MIN_BET = 10;
const MAX_BET = 50000;
const HISTORY = 24;

/** L'ordre réel des cases sur une roue européenne. */
const WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
  16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function colorOf(n) {
  if (n === 0) return 'green';
  return RED.has(n) ? 'red' : 'black';
}

/* ─── Les mises possibles ──────────────────────────────── */

const BETS = {
  red: { name: 'Rouge', payout: 2, test: (n) => colorOf(n) === 'red' },
  black: { name: 'Noir', payout: 2, test: (n) => colorOf(n) === 'black' },
  even: { name: 'Pair', payout: 2, test: (n) => n !== 0 && n % 2 === 0 },
  odd: { name: 'Impair', payout: 2, test: (n) => n % 2 === 1 },
  low: { name: '1–18', payout: 2, test: (n) => n >= 1 && n <= 18 },
  high: { name: '19–36', payout: 2, test: (n) => n >= 19 && n <= 36 },
  dozen: { name: 'Douzaine', payout: 3, test: (n, v) => n !== 0 && Math.ceil(n / 12) === v },
  column: { name: 'Colonne', payout: 3, test: (n, v) => n !== 0 && ((n - 1) % 3) + 1 === v },
  straight: { name: 'Plein', payout: 36, test: (n, v) => n === v },
};

function betLabel(type, value) {
  const def = BETS[type];
  if (!def) return '?';
  if (type === 'straight') return `N° ${value}`;
  if (type === 'dozen') return `${['1re', '2e', '3e'][value - 1]} douzaine`;
  if (type === 'column') return `${value}re colonne`.replace('1re', '1re').replace(/^(\d)re/, (m, d) => (d === '1' ? '1re' : `${d}e`));
  return def.name;
}

/* ─── La table ─────────────────────────────────────────── */

class Roulette {
  constructor(io, store) {
    this.io = io;
    this.store = store;
    this.round = 0;
    this.history = [];
    this.bets = new Map();     // userId → { name, avatar, bets: [], staked }
    this.previous = new Map();  // userId → les mises du tour précédent
    this.lastWinners = null;
    this.timer = null;
    this.startRound();
  }

  get room() {
    return 'roulette';
  }

  /* ── Cycle ── */

  startRound() {
    this.round += 1;
    this.serverSeed = fair.newServerSeed();
    this.serverSeedHash = fair.hashSeed(this.serverSeed);
    // Ce que chacun avait misé au tour précédent, pour le bouton « remiser ».
    this.previous = new Map();
    for (const [userId, entry] of this.bets) {
      if (entry.bets.length) this.previous.set(userId, entry.bets.map((b) => ({ ...b })));
    }

    this.bets = new Map();
    this.result = null;
    this.phase = 'betting';
    this.deadline = Date.now() + BETTING_MS;
    this.broadcast();
    this.timer = setTimeout(() => this.spin(), BETTING_MS);
  }

  spin() {
    this.phase = 'spinning';
    this.deadline = Date.now() + SPIN_MS;

    // Le numéro est décidé maintenant, à partir de la graine dont l'empreinte
    // a été publiée au début du tour : impossible de l'ajuster après les mises.
    const hex = crypto
      .createHmac('sha256', this.serverSeed)
      .update(`roulette:${this.round}`)
      .digest('hex');
    const number = fair.intBelow(parseInt(hex.slice(0, 8), 16) / 0x100000000, 37);

    this.result = {
      number,
      color: colorOf(number),
      index: WHEEL.indexOf(number),
      wheelSize: WHEEL.length,
    };

    this.broadcast();
    this.timer = setTimeout(() => this.settle(), SPIN_MS);
  }

  async settle() {
    this.phase = 'result';
    this.deadline = Date.now() + RESULT_MS;
    const number = this.result.number;

    const winners = [];
    for (const [userId, entry] of this.bets) {
      let payout = 0;
      const detail = [];
      for (const bet of entry.bets) {
        const def = BETS[bet.type];
        const won = def && def.test(number, bet.value);
        const gain = won ? bet.amount * def.payout : 0;
        payout += gain;
        detail.push({ ...bet, won, gain });
      }
      entry.payout = payout;
      entry.detail = detail;

      // La manche est enregistrée même quand elle est perdue.
      //
      // Elle ne l'était pas du tout : la roulette ne passait jamais par
      // `recordPlay`, donc elle ne comptait ni dans les statistiques, ni
      // dans le rakeback, ni dans le classement du mois. On pouvait y
      // passer la soirée sans que le site le sache.
      const profile = await this.store.findProfile(userId).catch(() => null);
      if (profile) {
        if (payout > 0) profile.vault.coins += payout;
        this.store.recordPlay(profile, entry.staked, payout, 'roulette');
        await this.store.saveProfile(profile).catch(() => {});
        this.pushProfile(profile);
      }
      if (payout > 0) {
        winners.push({ name: entry.name, avatar: entry.avatar, payout, staked: entry.staked });
      }
    }

    this.history.unshift({ number, color: this.result.color, at: Date.now() });
    this.history.length = Math.min(this.history.length, HISTORY);

    this.reveal = { serverSeed: this.serverSeed, serverSeedHash: this.serverSeedHash, round: this.round };
    this.winners = winners.sort((a, b) => b.payout - a.payout).slice(0, 8);

    // Le bandeau des gagnants reste affiché pendant le tour suivant : c'est
    // ce qui donne l'impression que la salle est vivante.
    this.lastWinners = {
      round: this.round,
      number,
      color: this.result.color,
      players: this.winners,
      total: winners.reduce((sum, w) => sum + w.payout, 0),
    };

    this.broadcast();
    this.timer = setTimeout(() => this.startRound(), RESULT_MS);
  }

  /* ── Mises ── */

  async place(profile, { type, value, amount } = {}) {
    if (this.phase !== 'betting') return { ok: false, message: 'Les mises sont fermées, attends le tour suivant.' };

    const def = BETS[type];
    if (!def) return { ok: false, message: 'Type de mise inconnu.' };

    let v = Number(value);
    if (type === 'straight') {
      if (!Number.isInteger(v) || v < 0 || v > 36) return { ok: false, message: 'Numéro invalide.' };
    } else if (type === 'dozen' || type === 'column') {
      if (![1, 2, 3].includes(v)) return { ok: false, message: 'Choix invalide.' };
    } else {
      v = null;
    }

    const stake = Math.floor(Number(amount) || 0);
    if (stake < MIN_BET) return { ok: false, message: `Mise minimum : ${MIN_BET} pièces.` };
    if (stake > MAX_BET) return { ok: false, message: `Mise maximum : ${MAX_BET} pièces.` };
    if (profile.vault.coins < stake) {
      return { ok: false, message: `Il te manque ${stake - profile.vault.coins} pièces.` };
    }

    profile.vault.coins -= stake;

    let entry = this.bets.get(profile.id);
    if (!entry) {
      entry = {
        name: profile.name,
        avatar: profile.avatar,
        // Les parures suivent le joueur jusque sur le tapis.
        cosmetics: medals.publicCosmetics(profile),
        bets: [],
        staked: 0,
      };
      this.bets.set(profile.id, entry);
    }

    // Une mise déjà posée sur la même case s'additionne plutôt que de s'empiler.
    const same = entry.bets.find((b) => b.type === type && b.value === v);
    if (same) same.amount += stake;
    else entry.bets.push({ type, value: v, amount: stake, label: betLabel(type, v) });
    entry.staked += stake;

    this.broadcast();
    return { ok: true, coins: profile.vault.coins, staked: entry.staked };
  }

  /**
   * Repose exactement les mises du tour précédent.
   * C'est le geste le plus fréquent à la roulette, et le refaire case par
   * case à chaque tour est pénible.
   */
  async rebet(profile) {
    if (this.phase !== 'betting') return { ok: false, message: 'Les mises sont fermées.' };
    const previous = this.previous.get(profile.id);
    if (!previous || !previous.length) return { ok: false, message: 'Aucune mise à reposer.' };

    const total = previous.reduce((sum, b) => sum + b.amount, 0);
    if (profile.vault.coins < total) {
      return { ok: false, message: `Il te manque ${total - profile.vault.coins} pièces pour reposer la même chose.` };
    }

    for (const bet of previous) {
      await this.place(profile, { type: bet.type, value: bet.value, amount: bet.amount });
    }
    return { ok: true, coins: profile.vault.coins, staked: total, count: previous.length };
  }

  /**
   * Pose d'un coup un ensemble de mises enregistré par le joueur.
   * `setup` est une liste { type, value, amount } déjà validée par `place`.
   */
  async applySetup(profile, setup) {
    if (this.phase !== 'betting') return { ok: false, message: 'Les mises sont fermées.' };
    if (!Array.isArray(setup) || !setup.length) return { ok: false, message: 'Configuration vide.' };

    const total = setup.reduce((sum, b) => sum + (Math.floor(Number(b.amount)) || 0), 0);
    if (profile.vault.coins < total) {
      return { ok: false, message: `Il te manque ${total - profile.vault.coins} pièces pour cette configuration.` };
    }

    let placed = 0;
    for (const bet of setup) {
      const r = await this.place(profile, bet);
      if (r.ok) placed++;
    }
    if (!placed) return { ok: false, message: 'Aucune mise n’a pu être posée.' };
    return { ok: true, coins: profile.vault.coins, count: placed };
  }

  /** Retire toutes les mises du tour et rembourse. */
  async clear(profile) {
    if (this.phase !== 'betting') return { ok: false, message: 'Trop tard pour retirer.' };
    const entry = this.bets.get(profile.id);
    if (!entry) return { ok: false, message: 'Aucune mise à retirer.' };
    profile.vault.coins += entry.staked;
    this.bets.delete(profile.id);
    this.broadcast();
    return { ok: true, coins: profile.vault.coins, refunded: entry.staked };
  }

  /* ── Diffusion ── */

  pushProfile(profile) {
    // Le module de présence, s'il est branché, sait à quelles sockets écrire.
    if (this.onProfile) this.onProfile(profile);
  }

  publicState(userId) {
    const mine = this.bets.get(userId);
    const pot = [...this.bets.values()].reduce((sum, e) => sum + e.staked, 0);

    // Ce que TOUT LE MONDE a posé, case par case : chaque case du tapis
    // affiche les têtes des joueurs qui y ont mis des jetons.
    const board = {};
    const table = [];
    for (const [id, entry] of this.bets) {
      table.push({
        id,
        name: entry.name,
        avatar: entry.avatar,
        cosmetics: entry.cosmetics || null,
        staked: entry.staked,
        you: id === userId,
      });
      for (const bet of entry.bets) {
        const key = `${bet.type}:${bet.value}`;
        if (!board[key]) board[key] = { total: 0, players: [] };
        board[key].total += bet.amount;
        if (board[key].players.length < 4) {
          board[key].players.push({ name: entry.name, avatar: entry.avatar, you: id === userId });
        }
      }
    }
    table.sort((a, b) => b.staked - a.staked);

    return {
      round: this.round,
      phase: this.phase,
      deadline: this.deadline,
      serverNow: Date.now(),
      serverSeedHash: this.serverSeedHash,
      wheel: WHEEL,
      result: this.phase === 'betting' ? null : this.result,
      reveal: this.phase === 'result' ? this.reveal : null,
      winners: this.phase === 'result' ? this.winners : [],
      history: this.history,
      players: this.bets.size,
      pot,
      board,
      table: table.slice(0, 12),
      lastWinners: this.lastWinners || null,
      canRebet: this.phase === 'betting' && (this.previous.get(userId) || []).length > 0,
      minBet: MIN_BET,
      maxBet: MAX_BET,
      rtp: Math.round((36 / 37) * 10000) / 100,
      you: mine ? { bets: mine.bets, staked: mine.staked, payout: mine.payout ?? null, detail: mine.detail || null } : null,
      redNumbers: [...RED].sort((a, b) => a - b),
    };
  }

  broadcast() {
    const sockets = this.io.sockets.adapter.rooms.get(this.room);
    if (!sockets) return;
    for (const socketId of sockets) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (!socket || !socket.data.user) continue;
      socket.emit('roulette:state', this.publicState(socket.data.user.id));
    }
  }

  stop() {
    clearTimeout(this.timer);
  }
}

module.exports = { Roulette, colorOf, WHEEL, BETS, betLabel, MIN_BET, MAX_BET };
