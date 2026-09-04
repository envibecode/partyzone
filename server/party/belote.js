'use strict';
/**
 * BELOTE.
 *
 * Trente-deux cartes, quatre joueurs, deux équipes en face à face. C'est le
 * jeu le plus exigeant des trois, et pas parce qu'il serait compliqué à
 * comprendre : parce que TOUT y est réglé. À l'Uno on peut se tromper de
 * carte, la partie continue. À la belote, jouer une carte qu'on n'avait pas
 * le droit de jouer, c'est refaire la donne.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES CINQ CHOSES QU'IL FAUT ABSOLUMENT NE PAS RATER
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  1. L'ORDRE DES CARTES CHANGE SELON L'ATOUT.
 *     À l'atout : Valet, 9, As, 10, Roi, Dame, 8, 7.
 *     Ailleurs  : As, 10, Roi, Dame, Valet, 9, 8, 7.
 *     Le Valet passe de cinquième à premier, le 9 de sixième à deuxième.
 *     C'est LA particularité du jeu, et c'est aussi la première chose qu'on
 *     casse en écrivant le code, parce qu'on n'a qu'un tableau d'ordre en
 *     tête. Il y en a deux ici, et ils ne se croisent jamais.
 *
 *  2. LES OBLIGATIONS SONT DES OBLIGATIONS.
 *     Fournir à la couleur demandée. Sinon couper. Si un adversaire a déjà
 *     coupé, surcouper si on peut. À l'atout, monter. Et une seule
 *     exception à tout ça : quand le PARTENAIRE est maître du pli, on se
 *     défausse librement. Le serveur calcule la liste des cartes jouables et
 *     l'envoie avec la main — l'interface n'a aucune règle à connaître.
 *
 *  3. LES 162 POINTS SONT UN INVARIANT.
 *     Une donne distribue exactement 152 points de cartes plus 10 de der.
 *     Pas 161, pas 163. C'est ce que vérifie le simulateur après chaque
 *     donne, et c'est ce qui attrape les vraies erreurs de comptage — celles
 *     qui ne se voient pas en jouant parce que les scores restent
 *     plausibles.
 *
 *  4. LE PRENEUR DOIT FAIRE MIEUX QUE MOITIÉ.
 *     82 points sur 162. À 81 partout il est dedans : « autant » ne suffit
 *     pas quand on a choisi l'atout. Chuté, il ne marque rien et l'adversaire
 *     ramasse les 162 — plus le capot à 252 si l'on a fait les huit plis.
 *
 *  5. BELOTE-REBELOTE SE COMPTE MÊME QUAND ON CHUTE.
 *     Les 20 points du Roi et de la Dame d'atout appartiennent à qui les a
 *     joués, quoi qu'il arrive ensuite. C'est l'exception qui surprend tout
 *     le monde, et elle est vraie.
 *
 * Ce qui n'est PAS ici : les annonces de séquences (tierce, cinquante, cent,
 * carré). Beaucoup de tables jouent sans, elles doublent la complexité de
 * l'écran, et elles se rajouteront proprement plus tard si l'envie vient.
 */

const { Room } = require('./rooms');
const fair = require('../fair');

const MIN = 4;
const MAX = 4;

const BID_MS = 25 * 1000;     // temps pour prendre ou passer
const TURN_MS = 40 * 1000;    // temps pour jouer une carte
const TRICK_MS = 1800;        // le pli reste visible avant d'être ramassé
const DEAL_END_MS = 9000;     // le temps de lire le décompte

const SUITS = ['s', 'h', 'd', 'c'];
const SUIT_NAME = { s: 'pique', h: 'cœur', d: 'carreau', c: 'trèfle' };
const SUIT_SIGN = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_SAY = { J: 'valet', Q: 'dame', K: 'roi', A: 'as' };

/*
 * Les deux barèmes.
 *
 * `ORDER` dit qui bat qui, `POINTS` dit ce que ça vaut. Les deux changent
 * entre l'atout et le reste, et il faut toujours passer par une fonction qui
 * prend l'atout en paramètre — jamais lire un de ces tableaux directement.
 */
const ORDER_TRUMP = { J: 8, '9': 7, A: 6, '10': 5, K: 4, Q: 3, '8': 2, '7': 1 };
const ORDER_PLAIN = { A: 8, '10': 7, K: 6, Q: 5, J: 4, '9': 3, '8': 2, '7': 1 };
const POINTS_TRUMP = { J: 20, '9': 14, A: 11, '10': 10, K: 4, Q: 3, '8': 0, '7': 0 };
const POINTS_PLAIN = { A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 };

const TOTAL_POINTS = 162;     // 152 de cartes + 10 de der
const CAPOT_POINTS = 252;
const CONTRACT = 82;          // il faut faire PLUS que la moitié

/* ─── Les cartes ───────────────────────────────────────────────────────── */

function buildDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ id: `${r}${s}`, s, r });
  return deck;
}

const isTrump = (card, trump) => card.s === trump;
const orderOf = (card, trump) => (isTrump(card, trump) ? ORDER_TRUMP : ORDER_PLAIN)[card.r];

/* ═══════════ LES ANNONCES ═══════════
 *
 * Tierce, cinquante, cent, et les carrés. Trois pièges, et ce sont eux qui
 * font que la moitié des implémentations sont fausses :
 *
 *  1. LES SÉQUENCES SUIVENT L'ORDRE DES CARTES, PAS CELUI DE L'ATOUT.
 *     7-8-9 est une tierce même à l'atout, où le 9 vaut pourtant plus que
 *     le roi. L'atout change la force et les points, jamais la SUITE.
 *
 *  2. SEULE LA MEILLEURE ÉQUIPE MARQUE.
 *     On compare la plus forte annonce des deux camps ; le perdant ne
 *     marque rien du tout, même s'il avait trois tierces. Le gagnant, lui,
 *     marque TOUTES les siennes. C'est ce qui rend l'annonce risquée : la
 *     montrer révèle son jeu, et peut ne rien rapporter.
 *
 *  3. LES CARRÉS DE 8 ET DE 7 NE VALENT RIEN.
 *     Ils existent, ils ne comptent pas. Les oublier fait marquer cent
 *     points à quelqu'un qui n'a rien.
 */

/** L'ordre des séquences : A K Q J 10 9 8 7, quel que soit l'atout. */
const SEQ_ORDER = { A: 8, K: 7, Q: 6, J: 5, '10': 4, '9': 3, '8': 2, '7': 1 };

const SEQ_POINTS = { 3: 20, 4: 50, 5: 100, 6: 100, 7: 100, 8: 100 };
const SEQ_NAME = { 3: 'tierce', 4: 'cinquante', 5: 'cent', 6: 'cent', 7: 'cent', 8: 'cent' };

/** Les carrés qui comptent. Le 8 et le 7 n'y sont pas, et c'est la règle. */
const FOUR_POINTS = { J: 200, '9': 150, A: 100, '10': 100, K: 100, Q: 100 };

/**
 * Toutes les annonces d'une main.
 *
 * Renvoie une liste triée de la plus forte à la plus faible, avec de quoi
 * les comparer entre équipes : `points`, puis `rank` (la hauteur de la
 * séquence) pour départager deux annonces de même valeur.
 */
function announcementsOf(hand) {
  const out = [];

  /* ── Les carrés ── */
  for (const rank of Object.keys(FOUR_POINTS)) {
    const four = hand.filter((c) => c.r === rank);
    if (four.length === 4) {
      out.push({
        kind: 'carre', rank, points: FOUR_POINTS[rank],
        // Un carré bat toujours n'importe quelle séquence, même un cent :
        // on le hisse au-dessus par sa hauteur de comparaison.
        rank2: 100 + SEQ_ORDER[rank],
        label: `carré de ${{ J: 'valets', A: 'as', K: 'rois', Q: 'dames', '10': 'dix', '9': 'neuf' }[rank] || rank}`,
        cards: four.map((c) => c.id),
      });
    }
  }

  /* ── Les séquences ── */
  for (const suit of SUITS) {
    const ranked = hand
      .filter((c) => c.s === suit)
      .sort((a, b) => SEQ_ORDER[a.r] - SEQ_ORDER[b.r]);
    let run = [];
    for (let i = 0; i < ranked.length; i++) {
      if (!run.length || SEQ_ORDER[ranked[i].r] === SEQ_ORDER[run[run.length - 1].r] + 1) {
        run.push(ranked[i]);
      } else {
        if (run.length >= 3) out.push(seqFrom(run, suit));
        run = [ranked[i]];
      }
    }
    if (run.length >= 3) out.push(seqFrom(run, suit));
  }

  return out.sort((a, b) => b.points - a.points || b.rank2 - a.rank2);
}

function seqFrom(run, suit) {
  const n = Math.min(8, run.length);
  const top = run[run.length - 1];
  return {
    kind: 'suite', points: SEQ_POINTS[n], rank2: SEQ_ORDER[top.r], length: n, suit,
    label: `${SEQ_NAME[n]} à ${top.r} de ${SUIT_NAME[suit]}`,
    cards: run.map((c) => c.id),
  };
}

/** Vraie si `a` bat `b` : d'abord la valeur, puis la hauteur. */
function beats(a, b) {
  if (!b) return true;
  if (!a) return false;
  if (a.points !== b.points) return a.points > b.points;
  return a.rank2 > b.rank2;
}
const pointsOf = (card, trump) => (isTrump(card, trump) ? POINTS_TRUMP : POINTS_PLAIN)[card.r];

function cardLabel(card) {
  return `${RANK_SAY[card.r] || card.r} de ${SUIT_NAME[card.s]}`;
}

function shuffleFrom(deck, serverSeed, clientSeed, nonce) {
  const out = [...deck];
  const rolls = fair.floats(serverSeed, clientSeed, nonce, out.length);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rolls[out.length - 1 - i] * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Qui remporte un pli.
 *
 * L'atout bat tout ; entre atouts, le plus fort dans l'ordre atout. Sans
 * atout, seule compte la couleur demandée — une carte d'une autre couleur
 * posée par quelqu'un qui ne pouvait ni fournir ni couper ne gagne jamais,
 * même si c'est un as.
 */
function trickWinner(trick, trump) {
  const lead = trick[0].card.s;
  let best = trick[0];
  for (const play of trick.slice(1)) {
    const c = play.card;
    const b = best.card;
    const cT = isTrump(c, trump);
    const bT = isTrump(b, trump);
    if (cT && !bT) { best = play; continue; }
    if (!cT && bT) continue;
    if (cT && bT) { if (orderOf(c, trump) > orderOf(b, trump)) best = play; continue; }
    if (c.s === lead && b.s === lead && orderOf(c, trump) > orderOf(b, trump)) best = play;
  }
  return best;
}

/**
 * Les cartes qu'on a le DROIT de jouer.
 *
 * Sortie en fonction pure et exportée : c'est elle que le simulateur
 * interroge des milliers de fois, et c'est elle qui décide de la légalité
 * d'un coup côté serveur. Une seule implémentation, pas deux.
 */
function legalCards(hand, trick, trump, partnerOf) {
  if (!trick.length) return [...hand];   // on entame : tout est permis

  const lead = trick[0].card.s;
  const following = hand.filter((c) => c.s === lead);

  /* ── On a la couleur demandée ── */
  if (following.length) {
    // Si la couleur demandée EST l'atout, il faut monter quand on le peut.
    if (lead === trump) {
      const highest = Math.max(...trick
        .filter((p) => isTrump(p.card, trump))
        .map((p) => orderOf(p.card, trump)), 0);
      const higher = following.filter((c) => orderOf(c, trump) > highest);
      return higher.length ? higher : following;
    }
    return following;
  }

  /* ── On n'a pas la couleur ── */

  // Le partenaire est maître : on se défausse librement. C'est la seule
  // exception aux obligations, et elle est capitale — sans elle on serait
  // forcé de couper le pli de son propre camp.
  const master = trickWinner(trick, trump);
  if (partnerOf && master.by === partnerOf) return [...hand];

  const trumps = hand.filter((c) => isTrump(c, trump));
  if (!trumps.length) return [...hand];   // pas d'atout : on jette ce qu'on veut

  // Il faut couper. Et si un adversaire a déjà coupé, il faut surcouper —
  // sauf si on ne peut pas, auquel cas on met quand même un atout.
  const already = trick.filter((p) => isTrump(p.card, trump));
  if (!already.length) return trumps;

  const highest = Math.max(...already.map((p) => orderOf(p.card, trump)));
  const over = trumps.filter((c) => orderOf(c, trump) > highest);
  return over.length ? over : trumps;
}

/* ─── La table ─────────────────────────────────────────────────────────── */

class Belote extends Room {
  constructor(io) {
    super(io, { game: 'belote', name: 'Belote', min: MIN, max: MAX });

    /* Réglages de l'hôte. */
    this.target = 501;          // score de fin de partie
    this.dealerMustTake = false; // « le donneur est chuté » au second tour

    /* La partie. */
    this.deal = 0;
    this.order = [];            // ids dans l'ordre de table
    this.dealerIndex = 0;
    this.scores = [0, 0];       // par équipe
    this.result = null;

    /* La donne en cours. */
    this.hands = new Map();
    this.trump = null;
    this.taker = null;
    this.declared = {};
    this.announceTeam = null;
    this.announcePoints = [0, 0];
    this.announceList = [];          // id du preneur
    this.turned = null;         // la retourne
    this.bidTurn = 0;
    this.bidRound = 1;
    this.passes = 0;
    this.trick = [];            // [{ by, card }]
    this.tricks = [];           // plis terminés
    this.won = [[], []];        // cartes gagnées par équipe
    this.dealPoints = [0, 0];
    this.beloteBy = null;       // équipe qui a annoncé belote
    this.beloteShown = 0;       // 1 = belote dite, 2 = rebelote dite
    this.turnIndex = 0;
    this.deadline = 0;
    this.timer = null;
    this.log = [];
    this.summary = null;

    this.serverSeed = fair.newServerSeed();
    this.serverSeedHash = fair.hashSeed(this.serverSeed);
    this.previousSeed = null;
  }

  /* ─── Repères ──────────────────────────────────────────────────────── */

  /**
   * L'ordre de table.
   *
   * `this.order` n'est rempli qu'au lancement. Avant, il est vide — et s'en
   * contenter laissait un salon d'attente sans équipes ni joueurs affichés,
   * alors que c'est exactement ce qu'on regarde en attendant le quatrième.
   * On retombe donc sur l'ordre d'arrivée, qui sera de toute façon celui de
   * la table.
   */
  seating() {
    return this.order.length ? this.order : this.players.map((p) => p.id);
  }

  teamOf(id) {
    const i = this.seating().indexOf(id);
    return i < 0 ? -1 : i % 2;
  }

  /** Le partenaire : celui d'en face, deux crans plus loin. */
  partnerOf(id) {
    const seats = this.seating();
    const i = seats.indexOf(id);
    return i < 0 || seats.length < 4 ? null : seats[(i + 2) % 4];
  }

  get current() {
    return this.order[this.turnIndex] || null;
  }

  get bidder() {
    return this.order[this.bidTurn] || null;
  }

  handOf(id) { return this.hands.get(id) || []; }

  nameOf(id) {
    const p = this.playerOf(id);
    return p ? p.name : '—';
  }

  note(text) {
    this.log.unshift({ text, at: Date.now() });
    if (this.log.length > 14) this.log.pop();
  }

  /* ─── Réglages ─────────────────────────────────────────────────────── */

  configure(userId, { target, dealerMustTake } = {}) {
    if (userId !== this.hostId) return { ok: false, message: 'Seul l’hôte règle la partie.' };
    if (this.phase !== 'lobby') return { ok: false, message: 'La partie est en cours.' };
    if ([301, 501, 1000].includes(Number(target))) this.target = Number(target);
    if (typeof dealerMustTake === 'boolean') this.dealerMustTake = dealerMustTake;
    this.broadcast();
    return { ok: true };
  }

  /* ─── Démarrage ────────────────────────────────────────────────────── */

  start(userId) {
    if (userId !== this.hostId) return { ok: false, message: 'Seul l’hôte lance la partie.' };
    if (this.phase !== 'lobby' && this.phase !== 'over') {
      return { ok: false, message: 'La partie est déjà lancée.' };
    }
    if (this.players.length !== 4) {
      return { ok: false, message: 'La belote se joue à quatre, ni plus ni moins.' };
    }

    this.order = this.players.map((p) => p.id);
    this.scores = [0, 0];
    this.deal = 0;
    this.dealerIndex = 0;
    this.result = null;
    this.note(`${this.nameOf(this.order[0])} et ${this.nameOf(this.order[2])} contre ${this.nameOf(this.order[1])} et ${this.nameOf(this.order[3])}.`);
    this.beginDeal();
    return { ok: true };
  }

  /**
   * Une donne.
   *
   * Trois cartes, puis deux, puis la retourne : ce n'est pas du folklore.
   * Distribuer une par une donnerait exactement le même hasard, mais la
   * belote se joue comme ça, et les joueurs comptent leurs paquets.
   */
  beginDeal() {
    clearTimeout(this.timer);
    this.deal += 1;

    if (this.deal > 1) {
      this.previousSeed = { serverSeed: this.serverSeed, serverSeedHash: this.serverSeedHash };
      this.serverSeed = fair.newServerSeed();
      this.serverSeedHash = fair.hashSeed(this.serverSeed);
    }

    const deck = shuffleFrom(buildDeck(), this.serverSeed, this.code, this.deal);
    this.hands = new Map();
    let cursor = 0;
    // Trois à chacun, puis deux à chacun, en partant de la gauche du donneur.
    for (const step of [3, 2]) {
      for (let k = 1; k <= 4; k++) {
        const id = this.order[(this.dealerIndex + k) % 4];
        const hand = this.hands.get(id) || [];
        hand.push(...deck.slice(cursor, cursor + step));
        cursor += step;
        this.hands.set(id, hand);
      }
    }
    this.rest = deck.slice(cursor + 1);     // ce qui reste après la retourne
    this.turned = deck[cursor];

    this.trump = null;
    this.taker = null;
    this.trick = [];
    this.tricks = [];
    this.won = [[], []];
    this.dealPoints = [0, 0];
    this.beloteBy = null;
    this.beloteShown = 0;
    this.summary = null;
    this.bidRound = 1;
    this.passes = 0;
    this.bidTurn = (this.dealerIndex + 1) % 4;

    this.phase = 'bidding';
    this.note(`Donne ${this.deal} — ${this.nameOf(this.order[this.dealerIndex])} distribue, retourne : ${cardLabel(this.turned)}.`);
    this.armBid();
    this.broadcast();
  }

  /* ─── Les enchères ─────────────────────────────────────────────────── */

  armBid() {
    clearTimeout(this.timer);
    this.deadline = Date.now() + BID_MS;
    const who = this.bidder;
    const p = this.playerOf(who);
    const delay = p && p.connected ? BID_MS : 800;
    // Qui ne répond pas passe : c'est le choix qui ne décide rien à la
    // place du joueur absent.
    this.timer = setTimeout(() => {
      if (this.phase === 'bidding' && this.bidder === who) this.bid(who, { take: false });
    }, delay);
  }

  bid(userId, { take, suit } = {}) {
    if (this.phase !== 'bidding') return { ok: false, message: 'Ce n’est pas le moment d’annoncer.' };
    if (userId !== this.bidder) return { ok: false, message: 'Ce n’est pas à toi d’annoncer.' };

    if (!take) {
      // Le donneur peut être obligé de prendre au second tour, si l'hôte a
      // activé la règle. Il choisit alors la couleur, mais pas de passer.
      const isDealer = this.bidTurn === this.dealerIndex;
      if (this.bidRound === 2 && isDealer && this.dealerMustTake && this.passes >= 3) {
        return { ok: false, message: 'Tu es le donneur : au second tour, tu dois prendre.' };
      }
      this.passes += 1;
      this.note(`${this.nameOf(userId)} passe.`);
      this.bidTurn = (this.bidTurn + 1) % 4;

      if (this.passes === 4 && this.bidRound === 1) {
        this.bidRound = 2;
        this.passes = 0;
        this.note('Second tour : on peut prendre à une autre couleur.');
      } else if (this.passes === 4) {
        // Personne ne veut : on redonne, donneur suivant.
        this.note('Personne ne prend — on redistribue.');
        this.dealerIndex = (this.dealerIndex + 1) % 4;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.beginDeal(), 2200);
        this.broadcast();
        return { ok: true };
      }
      this.armBid();
      this.broadcast();
      return { ok: true };
    }

    /* ── Quelqu'un prend ── */
    const trump = this.bidRound === 1 ? this.turned.s : suit;
    if (!SUITS.includes(trump)) return { ok: false, message: 'Choisis une couleur d’atout.' };
    if (this.bidRound === 2 && trump === this.turned.s) {
      return { ok: false, message: 'Au second tour, il faut choisir une AUTRE couleur.' };
    }

    this.trump = trump;
    this.taker = userId;
    this.note(`${this.nameOf(userId)} prend à ${SUIT_NAME[trump]}.`);

    /*
     * La distribution du reste.
     *
     * Le preneur ramasse la retourne — même au second tour, où il a pourtant
     * choisi une autre couleur. Il a donc six cartes et n'en reçoit que
     * deux ; les trois autres joueurs en reçoivent trois. Tout le monde
     * termine à huit.
     */
    this.handOf(userId).push(this.turned);
    let cursor = 0;
    for (let k = 1; k <= 4; k++) {
      const id = this.order[(this.dealerIndex + k) % 4];
      const need = id === userId ? 2 : 3;
      this.handOf(id).push(...this.rest.slice(cursor, cursor + need));
      cursor += need;
    }

    // Qui a le Roi ET la Dame d'atout marquera 20 points en les jouant.
    for (const id of this.order) {
      const hand = this.handOf(id);
      const hasK = hand.some((c) => c.s === trump && c.r === 'K');
      const hasQ = hand.some((c) => c.s === trump && c.r === 'Q');
      if (hasK && hasQ) this.beloteBy = this.teamOf(id);
    }

    /*
     * LES ANNONCES.
     *
     * Le serveur les calcule pour tout le monde, comme belote-rebelote.
     * À une vraie table on les annonce au premier pli et on les montre au
     * deuxième ; ici il n'y a personne à qui mentir, donc autant les
     * compter juste — et surtout, ça évite qu'on perde cent points parce
     * qu'on n'a pas vu sa propre tierce.
     *
     * Seule la meilleure équipe marque, et elle marque TOUTES ses annonces.
     */
    this.declared = {};
    let best = null;
    let bestTeam = null;
    for (const id of this.order) {
      const list = announcementsOf(this.handOf(id));
      if (!list.length) continue;
      this.declared[id] = list;
      if (beats(list[0], best)) { best = list[0]; bestTeam = this.teamOf(id); }
    }

    this.announceTeam = bestTeam;
    this.announcePoints = [0, 0];
    this.announceList = [];
    if (bestTeam !== null) {
      for (const id of this.order) {
        if (this.teamOf(id) !== bestTeam) continue;
        for (const a of this.declared[id] || []) {
          this.announcePoints[bestTeam] += a.points;
          this.announceList.push({ by: this.nameOf(id), label: a.label, points: a.points });
        }
      }
      if (this.announcePoints[bestTeam] > 0) {
        this.note(`Annonces : ${this.announceList.map((a) => `${a.label} (${a.by})`).join(', ')} — ${this.announcePoints[bestTeam]} points.`);
      }
    }

    this.phase = 'playing';
    this.turnIndex = (this.dealerIndex + 1) % 4;   // la gauche du donneur entame
    this.armTurn();
    this.broadcast();
    return { ok: true };
  }

  /* ─── Le jeu de la carte ───────────────────────────────────────────── */

  armTurn() {
    clearTimeout(this.timer);
    if (this.phase !== 'playing') return;
    this.deadline = Date.now() + TURN_MS;
    const who = this.current;
    const p = this.playerOf(who);
    const delay = p && p.connected ? TURN_MS : 700;
    this.timer = setTimeout(() => this.autoPlay(who), delay);
  }

  /**
   * Le serveur joue à la place de qui ne joue pas.
   *
   * Il prend la première carte légale, sans réfléchir. Ce n'est ni bon ni
   * mauvais — c'est neutre, et c'est ce qu'on veut : le remplaçant ne doit
   * ni sauver ni saborder l'équipe de l'absent.
   */
  autoPlay(expectedId) {
    if (this.phase !== 'playing' || this.current !== expectedId) return;
    const legal = this.legalFor(expectedId);
    if (!legal.length) return;
    this.playCard(expectedId, legal[0], { auto: true });
    this.broadcast();
  }

  legalFor(id) {
    return legalCards(this.handOf(id), this.trick, this.trump, this.partnerOf(id));
  }

  play(userId, { cardId } = {}) {
    if (this.phase !== 'playing') return { ok: false, message: 'La donne n’est pas en cours.' };
    if (userId !== this.current) return { ok: false, message: 'Ce n’est pas ton tour.' };

    const card = this.handOf(userId).find((c) => c.id === cardId);
    if (!card) return { ok: false, message: 'Tu n’as pas cette carte.' };

    const legal = this.legalFor(userId);
    if (!legal.some((c) => c.id === card.id)) {
      return { ok: false, message: this.whyNot(userId, card) };
    }

    this.playCard(userId, card);
    this.broadcast();
    return { ok: true };
  }

  /**
   * Pourquoi ce coup est refusé, en français.
   *
   * « Coup interdit » ne sert à personne : à la belote on refuse un coup
   * pour quatre raisons différentes, et on apprend le jeu en comprenant
   * laquelle.
   */
  whyNot(id, card) {
    const lead = this.trick.length ? this.trick[0].card.s : null;
    if (!lead) return 'Coup impossible.';
    const hand = this.handOf(id);

    if (hand.some((c) => c.s === lead) && card.s !== lead) {
      return `Il faut fournir à ${SUIT_NAME[lead]}.`;
    }
    if (lead === this.trump && card.s === this.trump) {
      return 'À l’atout, il faut monter si tu peux.';
    }
    if (!hand.some((c) => c.s === lead)) {
      const already = this.trick.filter((p) => isTrump(p.card, this.trump));
      if (already.length && card.s === this.trump) return 'Il faut surcouper si tu peux.';
      if (hand.some((c) => c.s === this.trump)) return 'Tu dois couper : tu as de l’atout.';
    }
    return 'Ce coup n’est pas permis.';
  }

  playCard(userId, card, { auto = false } = {}) {
    const hand = this.handOf(userId);
    const at = hand.findIndex((c) => c.id === card.id);
    if (at < 0) return;
    hand.splice(at, 1);
    this.trick.push({ by: userId, card });

    // Belote et rebelote : le serveur les annonce à la place du joueur.
    // Les oublier est une erreur classique qui coûte vingt points, et
    // personne n'a envie de perdre une partie sur un oubli de formalité.
    if (card.s === this.trump && (card.r === 'K' || card.r === 'Q')
        && this.beloteBy === this.teamOf(userId)) {
      this.beloteShown += 1;
      this.note(`${this.nameOf(userId)} annonce ${this.beloteShown === 1 ? 'belote' : 'rebelote'} !`);
    }

    this.note(`${this.nameOf(userId)} joue ${cardLabel(card)}${auto ? ' (automatique)' : ''}.`);

    if (this.trick.length < 4) {
      this.turnIndex = (this.turnIndex + 1) % 4;
      this.armTurn();
      return;
    }

    // Le pli est complet : on le laisse visible un instant avant de le
    // ramasser. Sans cette pause, la quatrième carte apparaît et disparaît
    // dans le même souffle, et personne ne voit qui a pris le pli.
    clearTimeout(this.timer);
    this.deadline = Date.now() + TRICK_MS;
    this.timer = setTimeout(() => this.closeTrick(), TRICK_MS);
  }

  closeTrick() {
    const winner = trickWinner(this.trick, this.trump);
    const team = this.teamOf(winner.by);
    const cards = this.trick.map((p) => p.card);

    this.won[team].push(...cards);
    this.tricks.push({ cards, by: winner.by, team });
    this.note(`${this.nameOf(winner.by)} remporte le pli.`);

    this.trick = [];
    this.turnIndex = this.order.indexOf(winner.by);

    if (this.tricks.length === 8) return this.endDeal(team);
    this.armTurn();
    this.broadcast();
  }

  /* ─── Le décompte ──────────────────────────────────────────────────── */

  /**
   * La fin de donne, et c'est là que tout se joue.
   *
   * On compte les cartes de chaque camp, on ajoute les dix de der à qui a
   * pris le dernier pli, on regarde si le preneur a fait ses 82, et on
   * ajuste. Les vingt de belote restent à qui les a joués, même si son camp
   * chute — c'est l'exception qui surprend tout le monde, et elle est vraie.
   */
  endDeal(lastTrickTeam) {
    clearTimeout(this.timer);
    this.phase = 'deal-end';

    const raw = [0, 1].map((t) => this.won[t].reduce((s, c) => s + pointsOf(c, this.trump), 0));
    raw[lastTrickTeam] += 10;   // dix de der

    const takerTeam = this.teamOf(this.taker);
    const other = 1 - takerTeam;
    const capot = this.won[takerTeam].length === 32 ? takerTeam
      : this.won[other].length === 32 ? other : null;

    const belote = [0, 0];
    // Il faut avoir joué LES DEUX cartes pour marquer les vingt points.
    if (this.beloteBy !== null && this.beloteShown >= 2) belote[this.beloteBy] = 20;

    // Les annonces comptent comme la belote : à part du pli, acquises même
    // quand l'équipe chute.
    const announce = [this.announcePoints[0] || 0, this.announcePoints[1] || 0];
    const bonus = [belote[0] + announce[0], belote[1] + announce[1]];

    let final = [0, 0];
    let verdict;

    if (capot !== null) {
      final[capot] = CAPOT_POINTS;
      verdict = capot === takerTeam ? 'capot' : 'capot-contre';
    } else if (raw[takerTeam] + bonus[takerTeam] >= CONTRACT) {
      final = [raw[0] + bonus[0], raw[1] + bonus[1]];
      verdict = 'rempli';
    } else {
      // Dedans : l'adversaire ramasse tout. Les belotes et les annonces
      // restent à leur propriétaire, y compris quand c'est le camp qui
      // chute — c'est la règle, et elle console un peu.
      final[other] = TOTAL_POINTS + bonus[other];
      final[takerTeam] = bonus[takerTeam];
      verdict = 'dedans';
    }

    this.dealPoints = final;
    this.scores[0] += final[0];
    this.scores[1] += final[1];

    this.summary = {
      deal: this.deal,
      trump: this.trump,
      trumpName: SUIT_NAME[this.trump],
      takerId: this.taker,
      taker: this.nameOf(this.taker),
      takerTeam,
      raw,
      belote,
      beloteTeam: this.beloteShown >= 2 ? this.beloteBy : null,
      announce,
      announceTeam: this.announceTeam,
      announceList: this.announceList,
      lastTrickTeam,
      final,
      verdict,
      scores: [...this.scores],
      teams: [
        [this.nameOf(this.order[0]), this.nameOf(this.order[2])],
        [this.nameOf(this.order[1]), this.nameOf(this.order[3])],
      ],
    };

    const said = {
      rempli: `Contrat rempli : ${raw[takerTeam]} points.`,
      dedans: `Dedans ! ${raw[takerTeam]} points seulement, il en fallait ${CONTRACT}.`,
      capot: 'CAPOT — les huit plis !',
      'capot-contre': 'Capot contre le preneur : les huit plis pour l’adversaire.',
    }[verdict];
    this.note(said);

    this.broadcast();

    const over = this.scores[0] >= this.target || this.scores[1] >= this.target;
    this.timer = setTimeout(() => {
      if (over) this.finish();
      else { this.dealerIndex = (this.dealerIndex + 1) % 4; this.beginDeal(); }
    }, DEAL_END_MS);
  }

  finish() {
    clearTimeout(this.timer);
    this.phase = 'over';
    const winTeam = this.scores[0] === this.scores[1]
      ? null
      : (this.scores[0] > this.scores[1] ? 0 : 1);

    this.result = {
      scores: [...this.scores],
      winnerTeam: winTeam,
      // Une égalité pile au but ferait deux équipes gagnantes : on préfère
      // ça à départager au hasard une partie que personne n'a perdue.
      winnerIds: winTeam === null
        ? [...this.order]
        : [this.order[winTeam], this.order[winTeam + 2]],
      deals: this.deal,
      target: this.target,
    };
    this.previousSeed = { serverSeed: this.serverSeed, serverSeedHash: this.serverSeedHash };
    this.note(winTeam === null
      ? `Égalité parfaite à ${this.scores[0]} — personne ne perd.`
      : `Partie terminée : ${this.nameOf(this.order[winTeam])} et ${this.nameOf(this.order[winTeam + 2])} l’emportent ${this.scores[winTeam]} à ${this.scores[1 - winTeam]}.`);
    this.broadcast();
    if (this.onEnd) this.onEnd(this);
  }

  winners() {
    return this.result ? this.result.winnerIds : [];
  }

  /**
   * Pour la soirée : les deux coéquipiers finissent au même rang. La belote
   * se gagne à deux — on ne va pas inventer un vainqueur individuel.
   */
  ranking() {
    if (!this.result) return super.ranking();
    return this.order.map((id, i) => ({ id, score: this.result.scores[i % 2] }));
  }

  /* ─── L'état envoyé ────────────────────────────────────────────────── */

  /**
   * Chacun voit sa main et rien d'autre.
   *
   * Les autres joueurs ne sont qu'un nombre de cartes. Comme à l'Uno, le
   * secret est tenu ici et pas dans l'interface : une main envoyée à tout le
   * monde et masquée en CSS se lit dans la console du navigateur.
   */
  stateFor(playerId) {
    const base = this.baseState();
    const mine = this.handOf(playerId);
    const legal = this.phase === 'playing' && this.current === playerId
      ? new Set(this.legalFor(playerId).map((c) => c.id))
      : null;

    // La main est triée pour être lisible : par couleur, l'atout d'abord,
    // et dans l'ordre de force de la couleur. On ne trie jamais la main
    // côté serveur pour le jeu — seulement pour l'affichage.
    const sorted = [...mine].sort((a, b) => {
      const at = isTrump(a, this.trump) ? 0 : 1;
      const bt = isTrump(b, this.trump) ? 0 : 1;
      if (at !== bt) return at - bt;
      if (a.s !== b.s) return SUITS.indexOf(a.s) - SUITS.indexOf(b.s);
      return orderOf(b, this.trump) - orderOf(a, this.trump);
    });

    return {
      ...base,
      deal: this.deal,
      target: this.target,
      dealerMustTake: this.dealerMustTake,
      trump: this.trump,
      trumpSign: this.trump ? SUIT_SIGN[this.trump] : null,
      trumpName: this.trump ? SUIT_NAME[this.trump] : null,
      takerId: this.taker,
      turned: this.phase === 'bidding' ? this.turned : null,
      bidRound: this.bidRound,
      bidderId: this.bidder,
      yourBid: this.phase === 'bidding' && this.bidder === playerId,
      currentId: this.current,
      yourTurn: this.phase === 'playing' && this.current === playerId,
      deadline: this.deadline,
      serverNow: Date.now(),

      hand: sorted.map((c) => ({
        ...c,
        trump: isTrump(c, this.trump),
        points: this.trump ? pointsOf(c, this.trump) : null,
        legal: legal ? legal.has(c.id) : false,
      })),

      trick: this.trick.map((p) => ({ by: p.by, name: this.nameOf(p.by), card: p.card })),
      tricksDone: this.tricks.length,
      lastTrick: this.tricks.length ? this.tricks[this.tricks.length - 1] : null,

      seats: this.seating().map((id, i) => {
        const p = this.playerOf(id);
        return {
          id,
          name: p ? p.name : '—',
          avatar: p ? p.avatar : null,
          cosmetics: p ? p.cosmetics : null,
          connected: p ? p.connected : false,
          team: i % 2,
          cards: this.handOf(id).length,
          dealer: i === this.dealerIndex,
          taker: id === this.taker,
          current: id === this.current,
          bidding: this.phase === 'bidding' && id === this.bidder,
          you: id === playerId,
          partner: id === this.partnerOf(playerId),
        };
      }),

      yourTeam: this.teamOf(playerId),
      scores: [...this.scores],
      // Les points ramassés dans la donne en cours, sans le dix de der ni
      // les belotes : c'est ce qu'on compte de tête en jouant.
      running: [0, 1].map((t) => this.won[t].reduce((s, c) => s + pointsOf(c, this.trump), 0)),
      belote: { team: this.beloteBy, shown: this.beloteShown },
      // On voit ses propres annonces, et on sait quelle équipe marque —
      // mais pas le détail de celles des autres avant la fin de la donne.
      announces: {
        mine: this.declared && this.declared[playerId] ? this.declared[playerId] : [],
        team: this.announceTeam,
        points: this.announcePoints || [0, 0],
        list: this.phase === 'deal-end' ? this.announceList : [],
      },

      log: this.log,
      summary: this.phase === 'deal-end' ? this.summary : null,
      result: this.result,
      fair: { serverSeedHash: this.serverSeedHash, previous: this.previousSeed },
    };
  }

  /** Reprendre après un redémarrage du serveur, chronomètre à neuf. */
  resume() {
    if (this.phase === 'playing') this.armTurn();
    else if (this.phase === 'bidding') this.armBid();
    else return;
    this.note('Le serveur a redémarré — la donne reprend.');
    this.broadcast();
  }

  broadcast() {
    for (const player of this.players) {
      const state = this.stateFor(player.id);
      for (const socketId of player.sockets) this.io.to(socketId).emit('bl:state', state);
    }
    this.broadcastWatchers('bl:state');
  }

  destroy() {
    clearTimeout(this.timer);
    super.destroy();
  }
}

module.exports = {
  Belote, MIN, MAX,
  buildDeck, legalCards, trickWinner, pointsOf, orderOf, isTrump, cardLabel,
  SUITS, RANKS, SUIT_NAME, SUIT_SIGN, TOTAL_POINTS, CAPOT_POINTS, CONTRACT,
  announcementsOf, beats, SEQ_ORDER, FOUR_POINTS,
};
