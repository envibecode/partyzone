'use strict';
/**
 * UNDERCOVER.
 *
 * Tout le monde reçoit un mot. Les civils ont le même ; un ou deux infiltrés
 * en ont un voisin sans le savoir ; et Monsieur Blanc, lui, n'a rien du tout.
 * À chaque manche, chacun décrit son mot en une phrase, puis on vote pour
 * éliminer quelqu'un. Les civils gagnent quand tous les intrus sont dehors ;
 * les intrus gagnent dès qu'ils sont aussi nombreux que les civils.
 *
 * Trois décisions qui font la partie :
 *
 *  • Le premier à parler est tiré au sort à chaque manche. Sinon le premier
 *    joueur de la liste part systématiquement à l'aveugle, ce qui est une
 *    punition imméritée — surtout pour Monsieur Blanc.
 *
 *  • Une description ne peut contenir ni le mot lui-même ni un mot de la
 *    paire : c'est vérifié côté serveur, parce que c'est exactement le genre
 *    de règle qu'on « oublie » quand on est en train de perdre.
 *
 *  • Monsieur Blanc éliminé garde une dernière chance : deviner le mot des
 *    civils. C'est ce qui rend le rôle jouable au lieu d'être une punition.
 */

const { Room } = require('./rooms');
const words = require('./words');

const MIN = 3;
const MAX = 12;
const DESCRIBE_MS = 60 * 1000;   // temps pour écrire sa description
const VOTE_MS = 45 * 1000;
const REVEAL_MS = 7 * 1000;
const GUESS_MS = 30 * 1000;      // le dernier mot de Monsieur Blanc

/* ─── Répartition des rôles ────────────────────────────── */

/**
 * Combien d'intrus pour un effectif donné.
 *
 * On reste volontairement en dessous du quart : au-delà, les intrus gagnent
 * par arithmétique avant d'avoir eu à jouer, ce qui n'amuse personne.
 */
function roleCount(total, { mrWhite = true } = {}) {
  const spies = total >= 9 ? 3 : total >= 6 ? 2 : 1;
  const white = mrWhite && total >= 5 ? 1 : 0;
  return { spies, white, civils: total - spies - white };
}

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Enlève accents, ponctuation et pluriels grossiers, pour comparer deux mots. */
function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    // Les diacritiques en échappement Unicode : écrits en clair, ils ne
    // survivent pas toujours à un copier-coller mal encodé.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

class Undercover extends Room {
  constructor(io) {
    super(io, { game: 'undercover', name: 'Undercover', min: MIN, max: MAX });

    this.level = 'melange';
    this.mrWhite = true;
    this.round = 0;
    this.pair = null;
    this.usedWords = [];
    this.order = [];
    this.turn = 0;
    this.votes = new Map();   // votantId → cibleId
    this.deadline = 0;
    this.timer = null;
    this.lastReveal = null;
    this.result = null;
    this.history = [];        // { round, entries: [{name, text}] }
  }

  /* ─── Réglages ─── */

  configure(userId, { level, mrWhite } = {}) {
    if (userId !== this.hostId) return { ok: false, message: 'Seul l’hôte règle la partie.' };
    if (this.phase !== 'lobby') return { ok: false, message: 'La partie est en cours.' };
    if (level && (words.LEVELS[level] || level === 'melange')) this.level = level;
    if (typeof mrWhite === 'boolean') this.mrWhite = mrWhite;
    this.broadcast();
    return { ok: true };
  }

  /* ─── Lancement ─── */

  start(userId) {
    if (userId !== this.hostId) return { ok: false, message: 'Seul l’hôte lance la partie.' };
    if (this.phase !== 'lobby' && this.phase !== 'over') {
      return { ok: false, message: 'La partie est déjà lancée.' };
    }
    const ready = this.players.filter((p) => p.connected);
    if (ready.length < MIN) {
      return { ok: false, message: `Il faut au moins ${MIN} joueurs. Vous êtes ${ready.length}.` };
    }

    this.round = 1;
    this.result = null;
    this.history = [];
    this.pair = words.pick(this.level, this.usedWords);
    this.usedWords.push(this.pair.civil, this.pair.spy);
    if (this.usedWords.length > 40) this.usedWords = this.usedWords.slice(-40);

    const counts = roleCount(ready.length, { mrWhite: this.mrWhite });
    const roles = [
      ...Array(counts.spies).fill('spy'),
      ...Array(counts.white).fill('white'),
      ...Array(counts.civils).fill('civil'),
    ];
    const assigned = shuffle(roles);

    this.players.forEach((p) => {
      p.out = false;
      p.role = null;
      p.word = null;
      p.said = null;
      p.eliminatedRound = null;
    });

    ready.forEach((p, i) => {
      p.role = assigned[i];
      p.word = p.role === 'spy' ? this.pair.spy : p.role === 'white' ? null : this.pair.civil;
    });

    // Les absents au moment du lancement ne jouent pas cette partie.
    this.players.filter((p) => !p.connected).forEach((p) => { p.out = true; p.role = 'absent'; });

    this.system(
      `Partie lancée : ${counts.civils} civils, ${counts.spies} infiltré${counts.spies > 1 ? 's' : ''}` +
      `${counts.white ? ' et Monsieur Blanc' : ''}.`,
      'start'
    );
    this.beginRound();
    return { ok: true };
  }

  /* ─── Une manche ─── */

  beginRound() {
    const living = this.living.filter((p) => p.connected || p.role);
    this.order = shuffle(living).map((p) => p.id);
    this.turn = 0;
    living.forEach((p) => { p.said = null; });
    this.phase = 'describing';
    this.armTurn();
    this.broadcast();
  }

  /**
   * Arme le chrono du joueur dont c'est le tour.
   *
   * Un joueur déconnecté ne fera rien de sa minute : on la raccourcit à huit
   * secondes pour que la partie ne s'arrête pas à cause d'un Wi-Fi coupé,
   * tout en lui laissant le temps de revenir.
   */
  armTurn() {
    const speaker = this.playerOf(this.currentSpeaker);
    const ms = speaker && speaker.connected ? DESCRIBE_MS : 8000;
    this.setDeadline(ms, () => this.skipTurn());
  }

  get currentSpeaker() {
    return this.order[this.turn] || null;
  }

  /** Le joueur dont c'est le tour écrit sa description. */
  describe(userId, text) {
    if (this.phase !== 'describing') return { ok: false, message: 'Ce n’est pas le moment.' };
    if (this.currentSpeaker !== userId) return { ok: false, message: 'Ce n’est pas ton tour.' };

    const player = this.playerOf(userId);
    if (!player || player.out) return { ok: false, message: 'Tu ne joues plus cette manche.' };

    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 90);
    if (clean.length < 2) return { ok: false, message: 'Écris quelque chose.' };

    // Interdit de dire le mot — le sien comme celui de l'autre camp.
    const said = normalize(clean).split(' ');
    const banned = [normalize(this.pair.civil), normalize(this.pair.spy)]
      .flatMap((w) => w.split(' '))
      .filter((w) => w.length > 2);
    if (banned.some((w) => said.includes(w))) {
      return { ok: false, message: 'Tu ne peux pas écrire le mot lui-même. Décris-le autrement.' };
    }

    player.said = clean;
    this.turn++;

    if (this.turn >= this.order.length) this.beginVote();
    else {
      this.armTurn();
      this.broadcast();
    }
    return { ok: true };
  }

  /** Le temps est écoulé : on passe au suivant, la case reste vide. */
  skipTurn() {
    if (this.phase !== 'describing') return;
    const player = this.playerOf(this.currentSpeaker);
    if (player && !player.said) {
      player.said = '…';
      this.system(`${player.name} n’a rien dit à temps.`, 'warn');
    }
    this.turn++;
    if (this.turn >= this.order.length) this.beginVote();
    else {
      this.armTurn();
      this.broadcast();
    }
  }

  /* ─── Le vote ─── */

  beginVote() {
    this.phase = 'voting';
    this.votes = new Map();
    this.history.push({
      round: this.round,
      entries: this.order.map((id) => {
        const p = this.playerOf(id);
        return { id, name: p ? p.name : '?', text: p ? p.said : '…' };
      }),
    });
    this.setDeadline(VOTE_MS, () => this.closeVote());
    this.broadcast();
  }

  vote(userId, targetId) {
    if (this.phase !== 'voting') return { ok: false, message: 'Ce n’est pas le moment de voter.' };
    const voter = this.playerOf(userId);
    if (!voter || voter.out) return { ok: false, message: 'Les éliminés ne votent pas.' };
    const target = this.playerOf(targetId);
    if (!target || target.out) return { ok: false, message: 'Cette personne n’est plus en jeu.' };
    if (targetId === userId) return { ok: false, message: 'On ne vote pas contre soi-même.' };

    this.votes.set(userId, targetId);

    // Dès que tout le monde a voté, inutile d'attendre la fin du chrono.
    const voters = this.living.filter((p) => p.connected);
    if (voters.every((p) => this.votes.has(p.id))) this.closeVote();
    else this.broadcast();
    return { ok: true };
  }

  closeVote() {
    if (this.phase !== 'voting') return;

    const tally = new Map();
    for (const targetId of this.votes.values()) {
      tally.set(targetId, (tally.get(targetId) || 0) + 1);
    }

    let top = [];
    let best = 0;
    for (const [id, n] of tally) {
      if (n > best) { best = n; top = [id]; }
      else if (n === best) top.push(id);
    }

    // Égalité, ou personne n'a voté : personne ne sort. C'est plus juste que
    // de tirer au sort une élimination, et ça arrive rarement deux fois.
    if (top.length !== 1 || best === 0) {
      this.lastReveal = { tie: true, counts: this.voteCounts() };
      this.phase = 'reveal';
      this.setDeadline(REVEAL_MS, () => this.afterReveal());
      this.system('Égalité : personne n’est éliminé cette manche.', 'warn');
      this.broadcast();
      return;
    }

    const victim = this.playerOf(top[0]);
    victim.out = true;
    victim.eliminatedRound = this.round;

    this.lastReveal = {
      id: victim.id,
      name: victim.name,
      avatar: victim.avatar,
      role: victim.role,
      word: victim.word,
      counts: this.voteCounts(),
    };

    // Monsieur Blanc démasqué a droit à une dernière tentative.
    if (victim.role === 'white') {
      this.phase = 'guess';
      this.guessBy = victim.id;
      this.setDeadline(GUESS_MS, () => this.guess(victim.id, ''));
      this.system(`${victim.name} était Monsieur Blanc ! Il a ${Math.round(GUESS_MS / 1000)} secondes pour deviner le mot.`, 'twist');
      this.broadcast();
      return;
    }

    this.phase = 'reveal';
    this.setDeadline(REVEAL_MS, () => this.afterReveal());
    this.system(
      `${victim.name} est éliminé — c’était ${victim.role === 'spy' ? 'un INFILTRÉ' : 'un civil'}.`,
      victim.role === 'spy' ? 'good' : 'bad'
    );
    this.broadcast();
  }

  voteCounts() {
    const counts = {};
    for (const [voterId, targetId] of this.votes) {
      if (!counts[targetId]) counts[targetId] = [];
      const voter = this.playerOf(voterId);
      counts[targetId].push(voter ? voter.name : '?');
    }
    return counts;
  }

  /** La dernière chance de Monsieur Blanc. */
  guess(userId, text) {
    if (this.phase !== 'guess' || this.guessBy !== userId) {
      return { ok: false, message: 'Ce n’est pas à toi de deviner.' };
    }
    const good = normalize(text) === normalize(this.pair.civil);
    this.guessBy = null;

    if (good) {
      this.system(`Monsieur Blanc a trouvé : « ${this.pair.civil} ». Il gagne la partie !`, 'twist');
      this.finish('white');
      return { ok: true, good: true };
    }

    this.system(
      text ? `Raté : ce n’était pas « ${text} ».` : 'Monsieur Blanc n’a pas répondu à temps.',
      'info'
    );
    this.phase = 'reveal';
    this.setDeadline(REVEAL_MS, () => this.afterReveal());
    this.broadcast();
    return { ok: true, good: false };
  }

  /* ─── Fin de manche ─── */

  afterReveal() {
    const living = this.living;
    const spies = living.filter((p) => p.role === 'spy' || p.role === 'white').length;
    const civils = living.length - spies;

    if (spies === 0) return this.finish('civils');
    if (spies >= civils) return this.finish('spies');
    if (living.length <= 2 && spies >= 1) return this.finish('spies');

    this.round++;
    this.beginRound();
  }

  finish(winner) {
    clearTimeout(this.timer);
    this.phase = 'over';
    this.result = {
      winner, // 'civils' | 'spies' | 'white'
      word: this.pair.civil,
      spyWord: this.pair.spy,
      roles: this.players
        .filter((p) => p.role && p.role !== 'absent')
        .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, role: p.role, word: p.word })),
    };

    const label = winner === 'civils' ? 'Les civils gagnent !'
      : winner === 'white' ? 'Monsieur Blanc gagne seul !'
        : 'Les infiltrés gagnent !';
    this.system(`${label} Le mot était « ${this.pair.civil} », l’infiltré avait « ${this.pair.spy} ».`, 'end');
    this.broadcast();
    if (this.onEnd) this.onEnd(this);
    return { ok: true, result: this.result };
  }

  /** Qui a gagné, pour créditer le rang Party. */
  winners() {
    if (!this.result) return [];
    const w = this.result.winner;
    return this.players
      .filter((p) => p.role && p.role !== 'absent')
      .filter((p) => (w === 'civils' ? p.role === 'civil' : w === 'white' ? p.role === 'white' : p.role === 'spy' || p.role === 'white'))
      .map((p) => p.id);
  }

  /* ─── Minuterie ─── */

  setDeadline(ms, onTimeout) {
    clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { onTimeout(); } catch { /* une manche ratée ne doit pas tuer le serveur */ }
    }, ms);
  }

  /* ─── Diffusion ─── */

  /**
   * Chaque joueur reçoit sa propre vue : son mot, et rien de ce qu'il ne
   * doit pas savoir. Les rôles ne partent qu'à la fin de la partie.
   */
  stateFor(userId) {
    const me = this.playerOf(userId);
    const base = this.baseState();

    return {
      ...base,
      round: this.round,
      level: this.level,
      mrWhite: this.mrWhite,
      deadline: this.deadline,
      serverNow: Date.now(),
      speaker: this.phase === 'describing' ? this.currentSpeaker : null,
      order: this.order,
      guessBy: this.guessBy || null,
      you: me
        ? {
          id: me.id,
          role: this.phase === 'over' ? me.role : (me.role === 'white' ? 'white' : me.role ? 'known' : null),
          word: me.word,
          out: Boolean(me.out),
          voted: this.votes.get(userId) || null,
          isWhite: me.role === 'white',
        }
        : null,
      said: this.players
        .filter((p) => p.said)
        .map((p) => ({ id: p.id, name: p.name, text: p.said })),
      history: this.history,
      votes: this.phase === 'voting'
        ? [...this.votes.keys()].map((id) => id) // qui a voté, pas pour qui
        : [],
      reveal: this.phase === 'reveal' || this.phase === 'guess' ? this.lastReveal : null,
      result: this.result,
    };
  }

  broadcast() {
    for (const player of this.players) {
      const state = this.stateFor(player.id);
      for (const socketId of player.sockets) this.io.to(socketId).emit('uc:state', state);
    }
  }
}

module.exports = { Undercover, MIN, MAX, roleCount, normalize };
