'use strict';
/**
 * POKER — TEXAS HOLD'EM, EN TOURNOI.
 *
 * On ne mise PAS les pièces du casino ici. Chacun reçoit le même tapis de
 * jetons de tournoi en s'asseyant, et la partie s'arrête quand une seule
 * personne les a tous. C'est un choix de fond : la section Party se joue
 * entre amis, et le poker à l'argent du site rendrait la table hostile à
 * celui qui n'a pas farmé.
 *
 * Le reste, en revanche, ce sont les vraies règles :
 *
 *  • blindes qui montent, bouton qui tourne, relance minimum égale à la
 *    dernière relance ;
 *  • tapis partiels et POTS SECONDAIRES — sans eux, un joueur à court de
 *    jetons gagnerait des jetons que personne n'a misés ;
 *  • égalité parfaite gérée : le pot se partage, et le reste indivisible va
 *    au premier joueur à gauche du bouton, comme dans un vrai club.
 */

const { Room } = require('./rooms');
const { freshDeck, evaluate, cardLabel } = require('./holdem');

const MIN = 2;
const MAX = 8;
const START_STACK = 5000;
const ACTION_MS = 30 * 1000;
const SHOWDOWN_MS = 9 * 1000;
const STREET_MS = 1400;      // petite pause entre deux cartes du tableau
const HANDS_PER_LEVEL = 8;

/** Les paliers de blindes. Au dernier, une main suffit à tout emporter. */
const BLINDS = [
  [25, 50], [50, 100], [75, 150], [100, 200], [150, 300],
  [200, 400], [300, 600], [500, 1000], [800, 1600], [1200, 2400],
];

function shuffle(deck) {
  const out = [...deck];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

class Poker extends Room {
  constructor(io) {
    super(io, { game: 'poker', name: 'Poker', min: MIN, max: MAX });

    this.hand = 0;
    this.button = 0;
    this.deck = [];
    this.board = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = 0;
    this.toAct = null;
    this.street = null;      // 'preflop' | 'flop' | 'turn' | 'river'
    this.lastAction = null;
    this.showdown = null;
    this.result = null;
    this.deadline = 0;
    this.timer = null;
  }

  get blinds() {
    // On borne des deux côtés : avant la première main `hand` vaut zéro, et
    // sans le plancher on irait chercher BLINDS[-1] — c'est-à-dire rien.
    const raw = Math.floor((this.hand - 1) / HANDS_PER_LEVEL);
    const level = Math.max(0, Math.min(BLINDS.length - 1, raw));
    return { level, small: BLINDS[level][0], big: BLINDS[level][1] };
  }

  /** Les joueurs encore en tournoi, dans l'ordre de la table. */
  get alive() {
    return this.players.filter((p) => !p.busted);
  }

  /** Ceux qui participent encore à la main en cours. */
  get inHand() {
    return this.players.filter((p) => p.inHand && !p.folded);
  }

  /* ─── Lancement du tournoi ─── */

  start(userId) {
    if (userId !== this.hostId) return { ok: false, message: 'Seul l’hôte lance la partie.' };
    if (this.phase !== 'lobby' && this.phase !== 'over') {
      return { ok: false, message: 'La partie est déjà lancée.' };
    }
    const ready = this.players.filter((p) => p.connected);
    if (ready.length < MIN) {
      return { ok: false, message: `Il faut au moins ${MIN} joueurs. Vous êtes ${ready.length}.` };
    }

    this.players.forEach((p) => {
      p.chips = p.connected ? START_STACK : 0;
      p.busted = !p.connected;
      p.out = !p.connected;
      p.cards = [];
      p.folded = false;
      p.allIn = false;
      p.bet = 0;
      p.committed = 0;
      p.inHand = false;
      p.acted = false;
    });

    this.hand = 0;
    this.button = Math.floor(Math.random() * ready.length);
    this.result = null;
    this.system(`Tournoi lancé : ${START_STACK} jetons chacun, blindes ${BLINDS[0][0]}/${BLINDS[0][1]}.`, 'start');
    this.nextHand();
    return { ok: true };
  }

  /* ─── Une main ─── */

  nextHand() {
    const alive = this.alive;
    if (alive.length <= 1) return this.finish(alive[0]);

    this.hand++;
    this.board = [];
    this.pot = 0;
    this.showdown = null;
    this.lastAction = null;
    this.deck = shuffle(freshDeck());

    alive.forEach((p) => {
      p.cards = [this.deck.pop(), this.deck.pop()];
      p.folded = false;
      p.allIn = false;
      p.bet = 0;
      p.committed = 0;
      p.inHand = true;
      p.acted = false;
      p.lastMove = null;
    });
    // Les éliminés aussi sont remis à zéro. Sans ça, leur `committed` de la
    // main où ils ont sauté resterait là, et le calcul des pots secondaires
    // le recompterait à chaque main suivante — donc créerait des jetons.
    this.players.filter((p) => p.busted).forEach((p) => {
      p.inHand = false;
      p.cards = [];
      p.bet = 0;
      p.committed = 0;
      p.folded = false;
      p.allIn = false;
    });

    // Le bouton avance jusqu'au prochain joueur encore en tournoi.
    this.button = this.nextAliveIndex(this.button);

    const { small, big, level } = this.blinds;
    if (this.hand > 1 && (this.hand - 1) % HANDS_PER_LEVEL === 0) {
      this.system(`Les blindes montent : ${small} / ${big} (palier ${level + 1}).`, 'warn');
    }

    // En tête-à-tête, le bouton est petite blinde et parle en premier avant
    // le flop — c'est la règle officielle, et elle surprend toujours.
    const order = this.seatOrder();
    const heads = order.length === 2;
    const sbIndex = heads ? 0 : 1;
    const bbIndex = heads ? 1 : 2;

    const sb = order[sbIndex % order.length];
    const bb = order[bbIndex % order.length];
    this.postBlind(sb, small);
    this.postBlind(bb, big);

    this.currentBet = big;
    this.minRaise = big;
    this.street = 'preflop';
    this.phase = 'playing';

    // Les blindes sont des mises forcées, pas des décisions : elles doivent
    // pouvoir reparler même si personne ne relance.
    sb.acted = false;
    bb.acted = false;

    // Le premier à parler : celui après la grosse blinde — mais en sautant
    // ceux qui sont DÉJÀ à tapis. Une petite blinde plus grosse que le tapis
    // d'un joueur le met à tapis avant même qu'il ait parlé ; le désigner
    // quand même bloquerait la table pour de bon, puisqu'il ne peut plus rien
    // faire et que le chrono relancerait indéfiniment sur lui.
    const firstIndex = heads ? 0 : (bbIndex + 1) % order.length;
    const actor = this.findActor(order, firstIndex);

    if (!actor) {
      // Tout le monde est à tapis dès la distribution : on déroule le tableau.
      this.toAct = null;
      this.broadcast();
      return this.runOut();
    }

    this.toAct = actor.id;
    this.armAction();
    this.broadcast();
  }

  /** Le premier joueur capable d'agir, à partir d'une position dans l'ordre. */
  findActor(order, from) {
    for (let step = 0; step < order.length; step++) {
      const p = order[(from + step) % order.length];
      if (p.inHand && !p.folded && !p.allIn) return p;
    }
    return null;
  }

  /** L'ordre de parole d'une main, en partant du bouton. */
  seatOrder() {
    const alive = this.alive;
    const start = alive.findIndex((p) => p === this.players[this.button]) ;
    const from = start >= 0 ? start : 0;
    return [...alive.slice(from), ...alive.slice(0, from)];
  }

  nextAliveIndex(from) {
    const n = this.players.length;
    for (let step = 1; step <= n; step++) {
      const i = (from + step) % n;
      if (!this.players[i].busted) return i;
    }
    return from;
  }

  postBlind(player, amount) {
    const paid = Math.min(player.chips, amount);
    player.chips -= paid;
    player.bet = paid;
    player.committed = paid;
    this.pot += paid;
    if (player.chips === 0) player.allIn = true;
    player.lastMove = amount === this.blinds.small ? 'petite blinde' : 'grosse blinde';
  }

  /* ─── Les actions ─── */

  act(userId, move, rawAmount) {
    if (this.phase !== 'playing') return { ok: false, message: 'La main n’est pas en cours.' };
    if (this.toAct !== userId) return { ok: false, message: 'Ce n’est pas ton tour.' };

    const p = this.playerOf(userId);
    if (!p || p.folded || p.allIn || !p.inHand) return { ok: false, message: 'Tu ne peux pas agir.' };

    const toCall = this.currentBet - p.bet;

    switch (move) {
      case 'fold':
        p.folded = true;
        p.lastMove = 'se couche';
        break;

      case 'check':
        if (toCall > 0) return { ok: false, message: `Il faut suivre ${toCall} ou se coucher.` };
        p.lastMove = 'parole';
        break;

      case 'call': {
        if (toCall <= 0) return { ok: false, message: 'Il n’y a rien à suivre.' };
        const paid = Math.min(toCall, p.chips);
        p.chips -= paid;
        p.bet += paid;
        p.committed += paid;
        this.pot += paid;
        if (p.chips === 0) { p.allIn = true; p.lastMove = `tapis (${p.bet})`; }
        else p.lastMove = `suit ${paid}`;
        break;
      }

      case 'raise': {
        const target = Math.floor(Number(rawAmount) || 0); // montant TOTAL visé sur la rue
        const maxTotal = p.bet + p.chips;

        // Un tapis inférieur à la relance minimale reste permis : c'est tout
        // ce qu'il reste au joueur, on ne va pas le lui refuser.
        const allIn = target >= maxTotal;
        const total = allIn ? maxTotal : target;

        if (!allIn && total < this.currentBet + this.minRaise) {
          return {
            ok: false,
            message: `Relance minimum : ${this.currentBet + this.minRaise} au total.`,
          };
        }
        if (total <= p.bet) return { ok: false, message: 'Il faut relancer plus que ta mise actuelle.' };

        const paid = total - p.bet;
        p.chips -= paid;
        this.pot += paid;

        // Une relance rouvre la parole à tout le monde — mais un tapis trop
        // petit pour être une vraie relance ne la rouvre pas.
        const isRealRaise = total >= this.currentBet + this.minRaise;
        if (isRealRaise) {
          this.minRaise = total - this.currentBet;
          this.inHand.forEach((other) => { if (other !== p && !other.allIn) other.acted = false; });
        }
        if (total > this.currentBet) this.currentBet = total;

        p.bet = total;
        p.committed += paid;
        if (p.chips === 0) { p.allIn = true; p.lastMove = `tapis (${total})`; }
        else p.lastMove = `relance à ${total}`;
        break;
      }

      default:
        return { ok: false, message: 'Action inconnue.' };
    }

    p.acted = true;
    this.lastAction = { id: p.id, name: p.name, move: p.lastMove };
    this.advance();
    return { ok: true };
  }

  /** Passe la main au joueur suivant, ou à la rue suivante. */
  advance() {
    const contenders = this.inHand;

    // Tout le monde s'est couché sauf un : la main est finie, sans montrer.
    if (contenders.length === 1) return this.awardUncontested(contenders[0]);

    const canAct = contenders.filter((p) => !p.allIn);
    const settled = canAct.every((p) => p.acted && p.bet === this.currentBet);

    if (settled) {
      // Plus personne ne peut miser : on déroule le tableau d'un coup.
      if (canAct.length <= 1) return this.runOut();
      return this.nextStreet();
    }

    const order = this.seatOrder();
    const fromIndex = order.findIndex((p) => p.id === this.toAct);
    for (let step = 1; step <= order.length; step++) {
      const candidate = order[(fromIndex + step) % order.length];
      if (candidate.inHand && !candidate.folded && !candidate.allIn) {
        this.toAct = candidate.id;
        this.armAction();
        this.broadcast();
        return;
      }
    }
    this.nextStreet();
  }

  nextStreet() {
    this.inHand.forEach((p) => { p.bet = 0; p.acted = false; });
    this.currentBet = 0;
    this.minRaise = this.blinds.big;

    if (this.street === 'preflop') {
      this.deck.pop(); // la carte brûlée, comme à la vraie table
      this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
      this.street = 'flop';
    } else if (this.street === 'flop') {
      this.deck.pop();
      this.board.push(this.deck.pop());
      this.street = 'turn';
    } else if (this.street === 'turn') {
      this.deck.pop();
      this.board.push(this.deck.pop());
      this.street = 'river';
    } else {
      return this.doShowdown();
    }

    // Après le flop, c'est le premier joueur à gauche du bouton qui parle.
    const order = this.seatOrder();
    const first = order.find((p) => p.inHand && !p.folded && !p.allIn);
    if (!first) return this.runOut();

    this.toAct = first.id;
    this.armAction();
    this.broadcast();
  }

  /** Plus personne ne peut miser : on retourne le reste du tableau. */
  runOut() {
    clearTimeout(this.timer);
    this.toAct = null;
    this.broadcast();

    const step = () => {
      if (this.board.length >= 5) return this.doShowdown();
      this.deck.pop();
      this.board.push(this.deck.pop());
      this.street = this.board.length === 3 ? 'flop' : this.board.length === 4 ? 'turn' : 'river';
      this.broadcast();
      this.timer = setTimeout(step, STREET_MS);
    };
    this.timer = setTimeout(step, STREET_MS);
  }

  /* ─── Fin de main ─── */

  awardUncontested(winner) {
    clearTimeout(this.timer);
    const won = this.pot;
    winner.chips += won;
    // Le pot est VIDÉ en même temps qu'il est payé. Le laisser affiché après
    // coup reviendrait à compter deux fois les mêmes jetons — ce qui masque
    // exactement le genre de bug qu'on ne veut pas dans un jeu d'argent, même
    // en jetons de tournoi. Le récapitulatif garde le montant pour l'écran.
    this.pot = 0;
    this.showdown = {
      uncontested: true,
      winners: [{ id: winner.id, name: winner.name, won }],
      pot: won,
    };
    this.system(`${winner.name} remporte ${won} jetons — tout le monde s’est couché.`, 'info');
    this.endHand();
  }

  doShowdown() {
    clearTimeout(this.timer);
    this.toAct = null;

    const potTotal = this.pot;
    this.pot = 0; // payé ci-dessous, jeton par jeton

    const contenders = this.inHand;
    const shown = contenders.map((p) => {
      const hand = evaluate([...p.cards, ...this.board]);
      return { player: p, hand };
    });

    /*
     * Les pots secondaires.
     *
     * On empile les joueurs par ce qu'ils ont réellement engagé. Chaque
     * palier forme un pot auquel seuls ceux qui l'ont atteint peuvent
     * prétendre. Sans ça, un joueur à tapis pour 100 jetons ramasserait la
     * relance à 3000 des deux autres — ce qui est le bug classique des
     * pokers maison.
     */
    // Seuls ceux qui ont reçu des cartes cette main comptent — y compris
    // ceux qui se sont couchés, dont les jetons restent bien dans le pot.
    const contributions = this.players
      .filter((p) => p.inHand && p.committed > 0)
      .map((p) => ({ p, left: p.committed }));

    const pots = [];
    let guard = 0;
    while (contributions.some((c) => c.left > 0) && guard++ < 32) {
      const active = contributions.filter((c) => c.left > 0);
      const layer = Math.min(...active.map((c) => c.left));
      let amount = 0;
      for (const c of active) { c.left -= layer; amount += layer; }
      pots.push({
        amount,
        eligible: active.filter((c) => c.p.inHand && !c.p.folded).map((c) => c.p.id),
      });
    }

    const wins = new Map();
    const details = [];

    pots.forEach((pot, index) => {
      const runners = shown.filter((s) => pot.eligible.includes(s.player.id));
      if (!runners.length) return;
      const best = Math.max(...runners.map((r) => r.hand.score));
      const winners = runners.filter((r) => r.hand.score === best);

      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;

      // Le reste indivisible va au premier à gauche du bouton, comme au club.
      const order = this.seatOrder();
      const sorted = [...winners].sort(
        (a, b) => order.findIndex((p) => p.id === a.player.id) - order.findIndex((p) => p.id === b.player.id)
      );

      sorted.forEach((w) => {
        let amount = share;
        if (remainder > 0) { amount += 1; remainder--; }
        w.player.chips += amount;
        wins.set(w.player.id, (wins.get(w.player.id) || 0) + amount);
      });

      details.push({
        label: index === 0 ? 'Pot principal' : `Pot secondaire ${index}`,
        amount: pot.amount,
        winners: sorted.map((w) => ({ id: w.player.id, name: w.player.name, hand: w.hand.detail })),
      });
    });

    this.showdown = {
      pot: potTotal,
      pots: details,
      hands: shown.map((s) => ({
        id: s.player.id,
        name: s.player.name,
        cards: s.player.cards.map(cardLabel),
        detail: s.hand.detail,
        best: s.hand.best.map(cardLabel),
        won: wins.get(s.player.id) || 0,
      })).sort((a, b) => b.won - a.won),
      winners: [...wins.entries()].map(([id, won]) => ({
        id,
        name: (this.playerOf(id) || {}).name || '?',
        won,
      })),
    };

    const best = this.showdown.hands[0];
    if (best && best.won > 0) {
      this.system(`${best.name} remporte ${best.won} jetons avec ${best.detail.toLowerCase()}.`, 'good');
    }
    this.endHand();
  }

  endHand() {
    this.phase = 'showdown';
    this.street = null;

    // Les tapis vides quittent le tournoi.
    const busted = this.alive.filter((p) => p.chips <= 0);
    busted.forEach((p) => {
      p.busted = true;
      p.out = true;
      p.inHand = false;
      this.system(`${p.name} est éliminé.`, 'bad');
    });

    this.broadcast();
    this.setDeadline(SHOWDOWN_MS, () => {
      if (this.alive.length <= 1) return this.finish(this.alive[0]);
      this.nextHand();
    });
  }

  finish(winner) {
    clearTimeout(this.timer);
    this.phase = 'over';
    this.toAct = null;
    this.result = {
      winnerId: winner ? winner.id : null,
      winner: winner ? winner.name : '—',
      hands: this.hand,
      standings: [...this.players]
        .filter((p) => p.chips > 0 || p.busted)
        .sort((a, b) => b.chips - a.chips)
        .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, chips: p.chips })),
    };
    if (winner) this.system(`${winner.name} rafle tous les jetons après ${this.hand} mains. Bien joué.`, 'end');
    this.broadcast();
    if (this.onEnd) this.onEnd(this);
    return { ok: true, result: this.result };
  }

  winners() {
    return this.result && this.result.winnerId ? [this.result.winnerId] : [];
  }

  /* ─── Minuterie ─── */

  armAction() {
    this.setDeadline(ACTION_MS, () => this.autoAct());
  }

  /** Temps écoulé : on parle si c'est gratuit, sinon on se couche. */
  autoAct() {
    if (this.phase !== 'playing' || !this.toAct) return;
    const p = this.playerOf(this.toAct);
    if (!p) return;
    const toCall = this.currentBet - p.bet;
    this.act(p.id, toCall > 0 ? 'fold' : 'check');
    this.system(`${p.name} n’a pas répondu à temps : ${toCall > 0 ? 'couché' : 'parole'}.`, 'warn');
  }

  setDeadline(ms, onTimeout) {
    clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { onTimeout(); } catch { /* une main ratée ne doit pas tuer le serveur */ }
    }, ms);
  }

  /* ─── Diffusion ─── */

  stateFor(userId) {
    const base = this.baseState();
    const me = this.playerOf(userId);
    const { small, big, level } = this.blinds;
    const buttonId = this.players[this.button] ? this.players[this.button].id : null;

    const toCall = me && me.inHand && !me.folded ? Math.max(0, this.currentBet - me.bet) : 0;

    return {
      ...base,
      hand: this.hand,
      street: this.street,
      board: this.board.map(cardLabel),
      pot: this.pot,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      blinds: { small, big, level: level + 1, levels: BLINDS.length },
      buttonId,
      toAct: this.toAct,
      deadline: this.deadline,
      serverNow: Date.now(),
      lastAction: this.lastAction,
      startStack: START_STACK,
      seats: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        cosmetics: p.cosmetics,
        connected: p.connected,
        chips: p.chips || 0,
        bet: p.bet || 0,
        folded: Boolean(p.folded),
        allIn: Boolean(p.allIn),
        busted: Boolean(p.busted),
        inHand: Boolean(p.inHand),
        lastMove: p.lastMove || null,
        button: p.id === buttonId,
        // Les cartes ne partent qu'à leur propriétaire — ou à tout le monde
        // à l'abattage. C'est la seule règle qui compte vraiment ici.
        cards: p.id === userId
          ? (p.cards || []).map(cardLabel)
          : this.phase === 'showdown' && this.showdown && !this.showdown.uncontested && p.inHand && !p.folded
            ? (p.cards || []).map(cardLabel)
            : (p.cards || []).map(() => null),
      })),
      you: me
        ? {
          id: me.id,
          chips: me.chips || 0,
          bet: me.bet || 0,
          toCall,
          canCheck: toCall === 0,
          minRaiseTo: Math.min(me.bet + me.chips, this.currentBet + this.minRaise),
          maxRaiseTo: me.bet + me.chips,
          turn: this.toAct === me.id,
          folded: Boolean(me.folded),
          allIn: Boolean(me.allIn),
          busted: Boolean(me.busted),
        }
        : null,
      showdown: this.showdown,
      result: this.result,
    };
  }

  broadcast() {
    for (const player of this.players) {
      const state = this.stateFor(player.id);
      for (const socketId of player.sockets) this.io.to(socketId).emit('pk:state', state);
    }
  }
}

module.exports = { Poker, MIN, MAX, START_STACK, BLINDS };
