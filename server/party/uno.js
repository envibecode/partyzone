'use strict';
/**
 * UNO.
 *
 * Sept cartes chacun, une pile au milieu, et le premier qui se débarrasse
 * de sa main remporte la manche. Tout le monde connaît les règles — c'est
 * précisément pour ça que celles qu'on écrit ici doivent être les bonnes :
 * un Uno où le +4 n'est pas contestable, où les +2 ne se cumulent pas et où
 * personne ne peut se faire prendre à ne pas avoir dit « Uno », c'est un
 * jeu de bataille avec des couleurs.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES QUATRE DÉCISIONS QUI FONT LA PARTIE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  1. LE +4 EST CONTESTABLE, ET LE SERVEUR CONNAÎT LA VÉRITÉ.
 *     La règle officielle interdit de poser un +4 si l'on a une carte de la
 *     couleur en cours. Personne ne la respecte, parce que dans la vraie vie
 *     personne ne peut vérifier. Ici le serveur, lui, voit la main : on peut
 *     donc poser le +4 en bluffant, et le joueur suivant peut contester. Si
 *     le bluff est avéré, c'est le menteur qui prend les quatre cartes ; si
 *     la contestation est infondée, le contestataire en prend six. C'est ce
 *     qui rend la carte intéressante au lieu d'être une massue.
 *
 *  2. ON NE SE FAIT PUNIR DE NE PAS AVOIR DIT « UNO » QUE SI QUELQU'UN LE
 *     REMARQUE.
 *     Un minuteur qui distribue automatiquement la pénalité transforme une
 *     règle sociale en formalité administrative : on finit par cliquer
 *     « Uno » machinalement, et plus personne ne regarde les mains des
 *     autres. Ici il faut qu'un joueur dénonce, dans la fenêtre de quelques
 *     secondes qui suit. Ça récompense l'attention, qui est tout le sel de
 *     ce moment-là.
 *
 *  3. UNE DÉCONNEXION NE BLOQUE JAMAIS LA TABLE.
 *     Chaque tour a une limite de temps. Passé le délai — ou dès qu'un
 *     joueur est déconnecté — le serveur pioche pour lui et passe la main.
 *     Personne n'attend trois minutes que le copain revienne des toilettes.
 *
 *  4. LE MÉLANGE VIENT D'UNE GRAINE PUBLIÉE.
 *     Il n'y a pas un centime en jeu dans la section Party, donc ce n'est
 *     pas une question d'argent : c'est que le reste du site fonctionne
 *     ainsi, et qu'un mélange reproductible rend les bancs d'essai
 *     déterministes. On publie l'empreinte avant, on révèle la graine après.
 */

const { Room } = require('./rooms');
const fair = require('../fair');

const MIN = 2;
const MAX = 10;

const HAND = 7;                    // cartes distribuées à chacun
const TURN_MS = 45 * 1000;         // au-delà, le serveur joue à ta place
const UNO_WINDOW_MS = 4000;        // fenêtre pour dénoncer un « Uno » non dit
const ROUND_END_MS = 6000;         // le temps de lire le décompte des points

const COLORS = ['r', 'y', 'g', 'b'];
const COLOR_NAMES = { r: 'rouge', y: 'jaune', g: 'vert', b: 'bleu' };
const VALUE_NAMES = {
  skip: 'passe-tour', rev: 'sens inverse', d2: '+2', wild: 'joker', d4: '+4',
};

/* ─── Le paquet ────────────────────────────────────────────────────────── */

/**
 * Les 108 cartes, dans l'ordre canonique.
 *
 * Par couleur : un seul 0, mais DEUX exemplaires de chaque carte de 1 à 9 et
 * de chaque effet. C'est le détail que tout le monde se rappelle de travers,
 * et il change les probabilités du jeu : un 0 est deux fois plus rare qu'un 7.
 */
function buildDeck() {
  const deck = [];
  let n = 0;
  const add = (c, v) => deck.push({ id: `${c}${v}-${n++}`, c, v });

  for (const c of COLORS) {
    add(c, '0');
    for (let i = 1; i <= 9; i++) { add(c, String(i)); add(c, String(i)); }
    for (const v of ['skip', 'rev', 'd2']) { add(c, v); add(c, v); }
  }
  for (let i = 0; i < 4; i++) { add('w', 'wild'); add('w', 'd4'); }
  return deck;
}

/** Ce que vaut une carte restée en main, pour le décompte de fin de manche. */
function cardPoints(card) {
  if (card.v === 'wild' || card.v === 'd4') return 50;
  if (card.v === 'skip' || card.v === 'rev' || card.v === 'd2') return 20;
  return Number(card.v);
}

function cardLabel(card) {
  const value = VALUE_NAMES[card.v] || card.v;
  return card.c === 'w' ? value : `${value} ${COLOR_NAMES[card.c]}`;
}

/**
 * Mélange de Fisher-Yates alimenté par la graine.
 *
 * Le nonce permet de tirer un mélange différent à chaque manche à partir de
 * la même graine, exactement comme le sabot du blackjack.
 */
function shuffleFrom(deck, serverSeed, clientSeed, nonce) {
  const out = [...deck];
  const rolls = fair.floats(serverSeed, clientSeed, nonce, out.length);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rolls[out.length - 1 - i] * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ─── La table ─────────────────────────────────────────────────────────── */

class Uno extends Room {
  constructor(io) {
    super(io, { game: 'uno', name: 'Uno', min: MIN, max: MAX });

    /* Réglages de l'hôte. */
    this.stacking = true;    // les +2 se cumulent
    this.jumpIn = false;     // réservé : poser hors de son tour, plus tard
    this.roundsTarget = 3;

    /* État de la partie. */
    this.round = 0;
    this.order = [];         // ids dans l'ordre de jeu
    this.dir = 1;            // 1 : sens horaire, -1 : sens inverse
    this.turn = 0;           // index dans this.order
    this.draw = [];          // la pioche
    this.discard = [];       // la défausse, dernier en tête de liste
    this.color = null;       // la couleur en cours (un joker en impose une)
    this.pending = 0;        // cartes à piocher accumulées par les +2 / +4
    this.pendingKind = null; // 'd2' ou 'd4' : on ne cumule pas n'importe quoi
    this.hands = new Map();  // playerId → [cartes]
    this.scores = new Map(); // playerId → points cumulés
    this.deadline = 0;
    this.timer = null;

    /* Le +4 tout juste posé, tant qu'il peut être contesté. */
    this.lastD4 = null;      // { byId, hadColor, color }

    /* La fenêtre « Uno ! ». */
    this.unoAt = null;       // { playerId, until, said }

    /* La carte qu'on vient de piocher et qu'on peut encore jouer. */
    this.drawn = null;       // { playerId, cardId }

    this.log = [];           // les derniers coups, pour le bandeau
    this.result = null;

    this.serverSeed = fair.newServerSeed();
    this.serverSeedHash = fair.hashSeed(this.serverSeed);
    this.previousSeed = null;
  }

  /* ─── Réglages ─────────────────────────────────────────────────────── */

  configure(userId, { stacking, rounds } = {}) {
    if (userId !== this.hostId) return { ok: false, message: 'Seul l’hôte règle la partie.' };
    if (this.phase !== 'lobby') return { ok: false, message: 'La partie est en cours.' };
    if (typeof stacking === 'boolean') this.stacking = stacking;
    if ([1, 3, 5].includes(Number(rounds))) this.roundsTarget = Number(rounds);
    this.broadcast();
    return { ok: true };
  }

  /* ─── Démarrage ────────────────────────────────────────────────────── */

  start(userId) {
    if (userId !== this.hostId) return { ok: false, message: 'Seul l’hôte lance la partie.' };
    if (this.phase !== 'lobby' && this.phase !== 'over') {
      return { ok: false, message: 'La partie est déjà lancée.' };
    }
    const present = this.players.filter((p) => p.connected);
    if (present.length < MIN) return { ok: false, message: `Il faut au moins ${MIN} joueurs.` };

    this.round = 0;
    this.scores = new Map(this.players.map((p) => [p.id, 0]));
    this.result = null;
    this.beginRound();
    return { ok: true };
  }

  beginRound() {
    clearTimeout(this.timer);
    this.round += 1;

    // Une nouvelle graine à chaque manche, l'ancienne révélée : c'est le
    // même contrat que partout ailleurs sur le site.
    if (this.round > 1) {
      this.previousSeed = { serverSeed: this.serverSeed, serverSeedHash: this.serverSeedHash };
      this.serverSeed = fair.newServerSeed();
      this.serverSeedHash = fair.hashSeed(this.serverSeed);
    }

    const deck = shuffleFrom(buildDeck(), this.serverSeed, this.code, this.round);
    this.order = this.players.map((p) => p.id);
    this.dir = 1;
    this.turn = 0;
    this.pending = 0;
    this.pendingKind = null;
    this.lastD4 = null;
    this.unoAt = null;
    this.drawn = null;
    this.log = [];
    this.hands = new Map();

    let cursor = 0;
    for (const id of this.order) {
      this.hands.set(id, deck.slice(cursor, cursor + HAND));
      cursor += HAND;
    }

    /*
     * La première carte retournée.
     *
     * Un +4 en première carte est remis dans le paquet et on retourne la
     * suivante : sinon le premier joueur ramasse quatre cartes avant d'avoir
     * eu le droit de jouer, ce qui est la pire entrée en matière possible.
     */
    let first = deck[cursor++];
    while (first.v === 'd4') {
      deck.push(first);
      first = deck[cursor++];
    }
    this.discard = [first];
    this.draw = deck.slice(cursor);
    this.color = first.c === 'w' ? null : first.c;

    this.phase = 'playing';
    this.note(`Manche ${this.round} — première carte : ${cardLabel(first)}.`);

    // Les effets de la première carte s'appliquent au premier joueur.
    this.applyFirstCard(first);
    this.armTurn();
    this.broadcast();
  }

  /**
   * Les effets de la carte de départ.
   *
   * Un joker de départ laisse le premier joueur choisir la couleur ; les
   * autres effets frappent le premier joueur comme s'ils venaient d'être
   * posés par un adversaire imaginaire.
   */
  applyFirstCard(card) {
    if (card.v === 'skip') {
      this.note(`${this.nameOf(this.current)} passe son tour d’entrée.`);
      this.advance();
    } else if (card.v === 'rev') {
      this.dir = -1;
      // À deux, l'inversion revient à passer : la main reste au même joueur.
      if (this.order.length > 2) {
        this.turn = (this.order.length - 1) % this.order.length;
      }
      this.note('Le sens de jeu est inversé dès le départ.');
    } else if (card.v === 'd2') {
      this.pending = 2;
      this.pendingKind = 'd2';
      this.note(`${this.nameOf(this.current)} démarre sous un +2.`);
    }
  }

  /* ─── Repères ──────────────────────────────────────────────────────── */

  get current() {
    return this.order[this.turn] || null;
  }

  get top() {
    return this.discard[0] || null;
  }

  nameOf(id) {
    const p = this.playerOf(id);
    return p ? p.name : '—';
  }

  handOf(id) {
    return this.hands.get(id) || [];
  }

  note(text) {
    this.log.unshift({ text, at: Date.now() });
    if (this.log.length > 12) this.log.pop();
  }

  /**
   * Une carte est-elle jouable en l'état ?
   *
   * L'ordre des tests compte : quand une pioche est en attente, la seule
   * chose qui puisse la relancer est une carte du même genre. Un 7 rouge sur
   * un +2 rouge ne fait pas passer la pioche à personne — elle est déjà en
   * l'air.
   */
  playable(card) {
    const top = this.top;
    if (!top) return false;

    if (this.pending > 0) {
      if (!this.stacking) return false;
      // On ne cumule qu'entre cartes de même famille : un +4 n'annule pas
      // un +2 et réciproquement. Deux familles qui se répondent feraient
      // grimper la pioche à des hauteurs qui cassent la partie.
      return card.v === this.pendingKind;
    }

    if (card.c === 'w') return true;
    if (this.color && card.c === this.color) return true;
    if (top.c !== 'w' && card.v === top.v) return true;
    return false;
  }

  /** A-t-on au moins un coup jouable ? */
  canPlayAnything(id) {
    return this.handOf(id).some((c) => this.playable(c));
  }

  /* ─── Le tour ──────────────────────────────────────────────────────── */

  armTurn() {
    clearTimeout(this.timer);
    if (this.phase !== 'playing') return;

    this.deadline = Date.now() + TURN_MS;
    const who = this.current;

    // Un joueur déconnecté ne fait pas attendre la table : on joue pour lui
    // tout de suite, sans user le chronomètre.
    const player = this.playerOf(who);
    const delay = player && player.connected ? TURN_MS : 900;

    this.timer = setTimeout(() => this.autoPlay(who), delay);
  }

  /**
   * Le serveur joue à la place de qui ne joue pas.
   *
   * Il ne triche pas et ne cherche pas à bien jouer : il pioche, et joue la
   * carte piochée si elle est jouable. C'est le comportement le plus neutre
   * possible — il ne fait ni gagner ni perdre celui qu'il remplace.
   */
  autoPlay(expectedId) {
    if (this.phase !== 'playing' || this.current !== expectedId) return;

    if (this.pending > 0) {
      this.eatPending(expectedId, 'délai dépassé');
      return;
    }
    const result = this.drawCard(expectedId, { auto: true });
    if (result.ok && result.playable) {
      this.playCard(expectedId, result.card, null, { auto: true });
    } else {
      this.note(`${this.nameOf(expectedId)} pioche et passe.`);
      this.advance();
      this.armTurn();
    }
    this.broadcast();
  }

  advance(steps = 1) {
    const n = this.order.length;
    if (!n) return;
    this.turn = (((this.turn + this.dir * steps) % n) + n) % n;
  }

  /** Qui jouerait après le joueur courant, sans changer le tour. */
  peekNext(steps = 1) {
    const n = this.order.length;
    return this.order[(((this.turn + this.dir * steps) % n) + n) % n];
  }

  /* ─── Poser une carte ──────────────────────────────────────────────── */

  play(userId, { cardId, color } = {}) {
    if (this.phase !== 'playing') return { ok: false, message: 'La manche n’est pas en cours.' };
    if (userId !== this.current) return { ok: false, message: 'Ce n’est pas ton tour.' };

    const hand = this.handOf(userId);
    const card = hand.find((c) => c.id === cardId);
    if (!card) return { ok: false, message: 'Tu n’as pas cette carte.' };
    if (!this.playable(card)) {
      return {
        ok: false,
        message: this.pending > 0
          ? `Il faut poser un ${VALUE_NAMES[this.pendingKind]} ou ramasser.`
          : 'Cette carte ne va pas sur la pile.',
      };
    }
    if (card.c === 'w' && !COLORS.includes(color)) {
      return { ok: false, message: 'Choisis une couleur.' };
    }

    this.playCard(userId, card, color);
    this.broadcast();
    return { ok: true };
  }

  playCard(userId, card, color, { auto = false } = {}) {
    const hand = this.handOf(userId);
    const at = hand.findIndex((c) => c.id === card.id);
    if (at < 0) return;
    hand.splice(at, 1);
    this.discard.unshift(card);
    this.drawn = null;

    /*
     * Le +4 : on retient l'état de la main AVANT de poser, parce que c'est
     * lui qui départage une contestation. Si le joueur avait une carte de la
     * couleur en cours, il a bluffé — même s'il s'en est débarrassé depuis.
     */
    if (card.v === 'd4') {
      const had = this.color ? hand.some((c) => c.c === this.color) : false;
      this.lastD4 = { byId: userId, hadColor: had, color: this.color, target: null };
    } else {
      this.lastD4 = null;
    }

    this.color = card.c === 'w' ? color : card.c;

    const label = card.c === 'w'
      ? `${VALUE_NAMES[card.v]} (${COLOR_NAMES[this.color]})`
      : cardLabel(card);
    this.note(`${this.nameOf(userId)} pose ${label}${auto ? ' (automatique)' : ''}.`);

    // Main vide : la manche est finie, on ne va pas plus loin.
    if (hand.length === 0) {
      this.endRound(userId);
      return;
    }

    // Il reste une carte : la fenêtre pour dénoncer s'ouvre.
    if (hand.length === 1) {
      this.unoAt = { playerId: userId, until: Date.now() + UNO_WINDOW_MS, said: false };
    }

    this.applyEffect(card, userId);
    this.armTurn();
  }

  /** Ce que fait la carte une fois posée. */
  applyEffect(card, byId) {
    switch (card.v) {
      case 'skip': {
        this.advance();
        this.note(`${this.nameOf(this.current)} passe son tour.`);
        this.advance();
        break;
      }
      case 'rev': {
        this.dir *= -1;
        // À deux joueurs, l'inversion est un passe-tour : celui qui l'a
        // posée rejoue. C'est la règle officielle, et elle surprend toujours.
        if (this.order.length === 2) {
          this.note('Sens inversé — à deux, ça revient à rejouer.');
        } else {
          this.note('Sens de jeu inversé.');
          this.advance();
        }
        break;
      }
      case 'd2': {
        this.pending += 2;
        this.pendingKind = 'd2';
        this.advance();
        break;
      }
      case 'd4': {
        this.pending += 4;
        this.pendingKind = 'd4';
        this.advance();
        if (this.lastD4) this.lastD4.target = this.current;
        break;
      }
      default:
        this.advance();
    }
  }

  /* ─── Piocher ──────────────────────────────────────────────────────── */

  /**
   * Prend une carte au sommet de la pioche.
   *
   * Quand la pioche est vide, on remet la défausse dedans — sauf la carte du
   * dessus, qui reste en jeu — et on remélange. Sans ça une partie à six
   * joueurs s'arrête au bout de vingt tours.
   */
  takeCard() {
    if (!this.draw.length) {
      if (this.discard.length <= 1) return null;
      const top = this.discard.shift();
      const recycled = this.discard.map((c) => (c.c === 'w' ? { ...c, c: 'w' } : c));
      this.draw = shuffleFrom(recycled, this.serverSeed, this.code, 1000 + this.round * 7 + this.log.length);
      this.discard = [top];
      this.note('La pioche était vide : la défausse est remélangée.');
    }
    return this.draw.shift() || null;
  }

  drawCard(userId, { auto = false } = {}) {
    const card = this.takeCard();
    if (!card) return { ok: false, message: 'Plus une seule carte à piocher.' };
    this.handOf(userId).push(card);
    // Piocher fait perdre le droit de se taire : on n'est plus à une carte.
    if (this.unoAt && this.unoAt.playerId === userId) this.unoAt = null;
    return { ok: true, card, playable: this.playable(card), auto };
  }

  /** Le joueur clique « piocher ». */
  pick(userId) {
    if (this.phase !== 'playing') return { ok: false, message: 'La manche n’est pas en cours.' };
    if (userId !== this.current) return { ok: false, message: 'Ce n’est pas ton tour.' };
    if (this.drawn) return { ok: false, message: 'Joue ou garde la carte piochée.' };

    // Une pioche en attente se ramasse d'un bloc.
    if (this.pending > 0) {
      this.eatPending(userId);
      this.broadcast();
      return { ok: true };
    }

    const result = this.drawCard(userId);
    if (!result.ok) return result;

    this.note(`${this.nameOf(userId)} pioche.`);
    if (result.playable) {
      // On laisse le choix : jouer la carte tout de suite, ou la garder.
      this.drawn = { playerId: userId, cardId: result.card.id };
      this.deadline = Date.now() + 15000;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (this.drawn && this.drawn.playerId === userId) this.keep(userId);
      }, 15000);
    } else {
      this.advance();
      this.armTurn();
    }
    this.broadcast();
    return { ok: true, drawn: result.card };
  }

  /** Garder la carte piochée et passer la main. */
  keep(userId) {
    if (!this.drawn || this.drawn.playerId !== userId) {
      return { ok: false, message: 'Rien à garder.' };
    }
    this.drawn = null;
    this.note(`${this.nameOf(userId)} garde sa carte et passe.`);
    this.advance();
    this.armTurn();
    this.broadcast();
    return { ok: true };
  }

  /** Ramasser la pioche accumulée par les +2 / +4. */
  eatPending(userId, reason = null) {
    const count = this.pending;
    for (let i = 0; i < count; i++) this.drawCard(userId);
    this.pending = 0;
    this.pendingKind = null;
    this.lastD4 = null;
    this.note(`${this.nameOf(userId)} ramasse ${count} cartes${reason ? ` (${reason})` : ''}.`);
    this.advance();
    this.armTurn();
  }

  /* ─── Contester un +4 ──────────────────────────────────────────────── */

  /**
   * « Tu bluffes. »
   *
   * Seul celui qui va ramasser peut contester, et seulement tant qu'il n'a
   * pas joué. Le serveur sait si le +4 était légal : il avait noté, au
   * moment de la pose, si le poseur détenait encore une carte de la couleur
   * en cours.
   */
  challenge(userId) {
    if (this.phase !== 'playing') return { ok: false, message: 'La manche n’est pas en cours.' };
    if (!this.lastD4 || this.pending <= 0) return { ok: false, message: 'Il n’y a rien à contester.' };
    if (this.lastD4.target !== userId) return { ok: false, message: 'Ce n’est pas à toi de contester.' };

    const { byId, hadColor, color } = this.lastD4;
    const stake = this.pending;
    this.pending = 0;
    this.pendingKind = null;
    this.lastD4 = null;

    if (hadColor) {
      // Bluff confirmé : le poseur ramasse ce qu'il voulait donner.
      for (let i = 0; i < stake; i++) this.drawCard(byId);
      this.note(`${this.nameOf(userId)} conteste et a raison : ${this.nameOf(byId)} avait du ${COLOR_NAMES[color]} et ramasse ${stake} cartes.`);
      // La main reste au contestataire : il n'a rien fait de mal.
      this.armTurn();
    } else {
      // Contestation infondée : deux cartes de plus que prévu.
      const punish = stake + 2;
      for (let i = 0; i < punish; i++) this.drawCard(userId);
      this.note(`${this.nameOf(userId)} conteste à tort : il ramasse ${punish} cartes.`);
      this.advance();
      this.armTurn();
    }
    this.broadcast();
    return { ok: true };
  }

  /* ─── « Uno ! » ────────────────────────────────────────────────────── */

  sayUno(userId) {
    if (!this.unoAt || this.unoAt.playerId !== userId) {
      return { ok: false, message: 'Tu n’as pas une seule carte.' };
    }
    this.unoAt.said = true;
    this.note(`${this.nameOf(userId)} annonce Uno !`);
    this.broadcast();
    return { ok: true };
  }

  /**
   * Dénoncer quelqu'un qui n'a pas annoncé.
   *
   * On ne peut dénoncer que pendant la fenêtre, et que quelqu'un d'autre que
   * soi. Passé le délai, c'est raté : la règle récompense l'attention, pas
   * la réclamation tardive.
   */
  catchUno(byId, targetId) {
    if (!this.unoAt) return { ok: false, message: 'Personne à dénoncer.' };
    if (this.unoAt.playerId !== targetId) return { ok: false, message: 'Ce joueur n’est pas concerné.' };
    if (byId === targetId) return { ok: false, message: 'On ne se dénonce pas soi-même.' };
    if (this.unoAt.said) return { ok: false, message: 'Il l’a annoncé à temps.' };
    if (Date.now() > this.unoAt.until) return { ok: false, message: 'Trop tard — la fenêtre est passée.' };

    for (let i = 0; i < 2; i++) this.drawCard(targetId);
    this.note(`${this.nameOf(byId)} prend ${this.nameOf(targetId)} sans Uno : +2 cartes.`);
    this.unoAt = null;
    this.broadcast();
    return { ok: true };
  }

  /* ─── Fin de manche ────────────────────────────────────────────────── */

  endRound(winnerId) {
    clearTimeout(this.timer);
    this.phase = 'round-end';
    this.unoAt = null;
    this.drawn = null;
    this.pending = 0;

    // Le gagnant encaisse la valeur des mains adverses.
    let gained = 0;
    const tally = [];
    for (const id of this.order) {
      if (id === winnerId) continue;
      const points = this.handOf(id).reduce((sum, c) => sum + cardPoints(c), 0);
      gained += points;
      tally.push({ id, name: this.nameOf(id), cards: this.handOf(id).length, points });
    }
    this.scores.set(winnerId, (this.scores.get(winnerId) || 0) + gained);

    this.roundSummary = {
      winnerId,
      winner: this.nameOf(winnerId),
      gained,
      tally: tally.sort((a, b) => b.points - a.points),
      round: this.round,
      last: this.round >= this.roundsTarget,
    };
    this.note(`${this.nameOf(winnerId)} termine la manche et marque ${gained} points.`);
    this.broadcast();

    this.timer = setTimeout(() => {
      if (this.round >= this.roundsTarget) this.finish();
      else this.beginRound();
    }, ROUND_END_MS);
  }

  finish() {
    clearTimeout(this.timer);
    this.phase = 'over';

    const table = this.order
      .map((id) => ({ id, name: this.nameOf(id), points: this.scores.get(id) || 0 }))
      .sort((a, b) => b.points - a.points);

    const best = table.length ? table[0].points : 0;
    this.result = {
      table,
      // Une égalité en tête fait deux vainqueurs : on ne départage pas au
      // hasard une partie que deux personnes ont gagnée.
      winnerIds: table.filter((t) => t.points === best).map((t) => t.id),
      rounds: this.round,
    };
    this.previousSeed = { serverSeed: this.serverSeed, serverSeedHash: this.serverSeedHash };
    this.note(`Partie terminée — ${this.result.winnerIds.map((id) => this.nameOf(id)).join(' et ')} l’emporte.`);
    this.broadcast();
    if (this.onEnd) this.onEnd(this);
  }

  winners() {
    return this.result ? this.result.winnerIds : [];
  }

  /* ─── État envoyé au client ────────────────────────────────────────── */

  /**
   * Chacun voit sa main, et seulement le NOMBRE de cartes des autres.
   *
   * C'est la règle la plus importante du fichier : tout ce qui est secret
   * doit l'être ici, pas dans l'interface. Une main envoyée à tout le monde
   * et cachée en CSS se lit en trois secondes dans la console du navigateur.
   */
  stateFor(playerId) {
    const base = this.baseState();
    const hand = this.handOf(playerId);

    return {
      ...base,
      round: this.round,
      roundsTarget: this.roundsTarget,
      stacking: this.stacking,
      dir: this.dir,
      color: this.color,
      pending: this.pending,
      pendingKind: this.pendingKind,
      top: this.top,
      drawLeft: this.draw.length,
      deadline: this.deadline,
      serverNow: Date.now(),
      currentId: this.current,
      yourTurn: this.current === playerId && this.phase === 'playing',

      // Ta main, avec l'information « jouable » calculée par le serveur :
      // l'interface n'a pas à réimplémenter les règles pour griser une carte.
      hand: hand.map((c) => ({ ...c, playable: this.playable(c) })),

      /*
       * Avant la première manche, `order` est vide : il n'est rempli qu'à
       * la distribution. Se contenter de lui laissait donc un salon
       * d'attente sans personne dedans — on ne voyait pas ses copains
       * arriver, ce qui est précisément ce qu'on regarde en attendant.
       * On retombe sur la liste des joueurs du salon.
       */
      seats: (this.order.length ? this.order : this.players.map((p) => p.id)).map((id) => {
        const p = this.playerOf(id);
        return {
          id,
          name: p ? p.name : '—',
          avatar: p ? p.avatar : null,
          cosmetics: p ? p.cosmetics : null,
          connected: p ? p.connected : false,
          cards: this.handOf(id).length,
          score: this.scores.get(id) || 0,
          current: id === this.current,
          you: id === playerId,
        };
      }),

      // La carte qu'on vient de piocher et qu'on peut encore poser.
      drawn: this.drawn && this.drawn.playerId === playerId ? this.drawn.cardId : null,

      // Peut-on contester le +4 en cours ?
      canChallenge: Boolean(this.lastD4 && this.lastD4.target === playerId && this.pending > 0),

      // La fenêtre « Uno ! », vue de ce joueur.
      uno: this.unoAt ? {
        playerId: this.unoAt.playerId,
        name: this.nameOf(this.unoAt.playerId),
        said: this.unoAt.said,
        until: this.unoAt.until,
        mine: this.unoAt.playerId === playerId,
      } : null,

      log: this.log,
      roundSummary: this.phase === 'round-end' ? this.roundSummary : null,
      result: this.result,
      fair: { serverSeedHash: this.serverSeedHash, previous: this.previousSeed },
    };
  }

  /** Reprendre après un redémarrage du serveur, chronomètre à neuf. */
  resume() {
    if (this.phase !== 'playing') return;
    this.armTurn();
    this.note('Le serveur a redémarré — la manche reprend.');
    this.broadcast();
  }

  broadcast() {
    for (const player of this.players) {
      const state = this.stateFor(player.id);
      for (const socketId of player.sockets) this.io.to(socketId).emit('uno:state', state);
    }
    this.broadcastWatchers('uno:state');
  }

  destroy() {
    clearTimeout(this.timer);
    super.destroy();
  }
}

module.exports = { Uno, MIN, MAX, buildDeck, cardPoints, cardLabel, shuffleFrom, COLORS };
