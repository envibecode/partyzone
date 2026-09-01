'use strict';
/**
 * BLACKJACK — tables à sièges.
 *
 * Une table est un salon avec un code à 4 lettres : tu joues seul contre le
 * croupier, tu ajoutes des bots pour remplir, ou tu envoies le code à tes
 * potes. Le cycle tourne tout seul — mises, distribution, tour de chaque
 * joueur, croupier, paiements — et recommence.
 *
 * Règles : sabot de 6 jeux, blackjack payé 3 pour 2, le croupier tire
 * jusqu'à 17 et reste sur tous les 17 (y compris le 17 « souple »), double
 * autorisé sur les deux premières cartes, split une fois. Pas d'assurance :
 * c'est mathématiquement une mauvaise mise, autant ne pas la proposer.
 *
 * Le sabot est mélangé à partir d'une graine dont l'empreinte est publiée
 * avant la première main ; la graine est révélée à chaque nouveau mélange.
 */
const crypto = require('crypto');
const fair = require('./fair');
const sidebets = require('./sidebets');
const medals = require('./medals');

const DECKS = 6;
const SEATS = 5;
const BETTING_MS = 22000;
const WAKE_MS = 3000; // battement avant le premier tour de mises
const TURN_MS = 22000;
const PAYOUT_MS = 7000;
const DEAL_STEP_MS = 420;

const MIN_BET = 10;
const MAX_BET = 50000;
const BLACKJACK_PAYS = 1.5;
const RESHUFFLE_AT = 0.25;

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];


/* ─── Cartes ───────────────────────────────────────────── */

function cardValue(rank) {
  if (rank === 'A') return 11;
  if (['10', 'J', 'Q', 'K'].includes(rank)) return 10;
  return Number(rank);
}

/** Total d'une main, en comptant les as à 11 tant que ça ne dépasse pas 21. */
function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c.r);
    if (c.r === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards).total === 21;
}

/* ─── Le sabot ─────────────────────────────────────────── */

function buildShoe(seed) {
  const cards = [];
  for (let d = 0; d < DECKS; d++) {
    for (const s of SUITS) for (const r of RANKS) cards.push({ r, s });
  }
  // Mélange de Fisher-Yates piloté par la graine : reproductible, vérifiable.
  const values = fair.floats(seed, 'shoe', 1, cards.length);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(values[cards.length - 1 - i] * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/* ─── La table ─────────────────────────────────────────── */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const tables = new Map();

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * 24)]).join('');
  } while (tables.has(code));
  return code;
}

class Table {
  constructor(code, io, store) {
    this.code = code;
    this.io = io;
    this.store = store;
    this.hostId = null;
    this.seats = [];
    this.dealer = { cards: [] };
    this.phase = 'waiting';
    this.deadline = null;
    this.timer = null;
    this.stepTimer = null;
    this.activeSeat = -1;
    this.hand = 0;
    this.cycling = false; // le tour de table tourne-t-il déjà ? (voir wake)
    this.log = [];
    this.emptySince = Date.now();
    this.lastActivityAt = Date.now(); // dernière vraie mise posée à cette table
    /*
     * Les spectateurs.
     *
     * On peut regarder une table sans y jouer : c'est comme ça qu'on décide
     * si on a envie de s'asseoir, et c'est aussi ce qui permet de suivre la
     * partie d'un copain quand les cinq sièges sont pris. Un spectateur
     * reçoit exactement le même état que les joueurs — il n'y a rien de
     * secret à une table de blackjack, toutes les cartes visibles le sont
     * pour tout le monde.
     */
    this.watchers = new Map(); // userId → { id, name, avatar, socketId }
    this.newShoe();
  }

  newShoe() {
    if (this.shoeSeed) {
      this.previousShoe = { serverSeed: this.shoeSeed, serverSeedHash: this.shoeSeedHash };
    }
    this.shoeSeed = fair.newServerSeed();
    this.shoeSeedHash = fair.hashSeed(this.shoeSeed);
    this.shoe = buildShoe(this.shoeSeed);
    this.dealt = 0;
  }

  draw() {
    if (this.dealt >= this.shoe.length * (1 - RESHUFFLE_AT)) this.newShoe();
    return this.shoe[this.dealt++];
  }

  /* ── Sièges ── */

  seatOf(userId) {
    return this.seats.find((s) => s.id === userId);
  }

  addPlayer(user, profile, socketId) {
    let seat = this.seatOf(user.id);
    if (seat) {
      seat.socketId = socketId;
      seat.connected = true;
      seat.name = user.name;
      seat.avatar = user.avatar;
      seat.cosmetics = medals.publicCosmetics(profile);
      return seat;
    }
    if (this.seats.length >= SEATS) return null;
    seat = {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      // Les parures du joueur, pour que la table ait la même tête que le reste.
      cosmetics: profile ? medals.publicCosmetics(profile) : null,
      socketId,
      connected: true,
      bet: 0,
      hands: [],
      activeHand: 0,
      lastResult: null,
      chips: profile ? profile.vault.coins : 0,
    };
    this.seats.push(seat);
    if (!this.hostId) this.hostId = user.id;
    this.emptySince = null;
    this.wake();
    return seat;
  }

  /**
   * Mettre la table en mouvement.
   *
   * Une table qui attend qu'on mise pour ouvrir un tour n'affiche aucun
   * compte à rebours : on s'assoit devant un écran figé et on ne sait pas
   * quand il faut poser ses jetons. Dès que quelqu'un prend une place, le
   * cycle démarre donc tout seul et ne s'arrête plus tant que la table est
   * occupée — trois secondes de battement d'abord, le temps de voir où on
   * a atterri.
   *
   * `cycling` évite qu'un second joueur relance un second cycle en
   * parallèle : deux boucles sur la même table, c'est deux distributions
   * pour une seule mise.
   */
  wake() {
    if (this.cycling) return;
    this.cycling = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.startBetting(), WAKE_MS);
  }

  removePlayer(userId) {
    const seat = this.seatOf(userId);
    if (!seat) return;
    seat.connected = false;
    // Pendant une main on garde le siège (reconnexion possible).
    if (this.phase === 'waiting' || this.phase === 'betting') {
      this.seats = this.seats.filter((s) => s.id !== userId);
    }
    if (this.hostId === userId) {
      const next = this.seats.find((s) => s.connected);
      this.hostId = next ? next.id : null;
    }
    if (!this.humans().some((s) => s.connected)) this.emptySince = Date.now();
  }

  /** Tous les joueurs assis (il n'y a plus de bots). */
  humans() {
    return this.seats;
  }

  /* ── Spectateurs ── */

  addWatcher(user, socketId) {
    this.watchers.set(user.id, { id: user.id, name: user.name, avatar: user.avatar, socketId });
    clearTimeout(this.closeTimer);
    this.emptySince = null;
  }

  removeWatcher(userId) {
    this.watchers.delete(userId);
    if (!this.seats.some((s) => s.connected) && !this.watchers.size) {
      this.emptySince = Date.now();
    }
  }

  /**
   * Exclure quelqu'un de la table.
   *
   * Réservé à l'hôte, et impossible sur un joueur qui a une mise en cours :
   * on ne prend pas l'argent de quelqu'un pour le mettre dehors ensuite. Un
   * siège occupé par quelqu'un qui ne joue pas, en revanche, bloque une des
   * cinq places — d'où ce bouton.
   */
  kick(byId, targetId) {
    if (byId !== this.hostId) return { ok: false, message: 'Seul l’hôte de la table peut faire ça.' };
    if (byId === targetId) return { ok: false, message: 'Pour partir, utilise « Quitter ».' };

    const seat = this.seatOf(targetId);
    if (!seat) return { ok: false, message: 'Cette personne n’est pas à la table.' };
    if (seat.bet >= MIN_BET || (seat.hands && seat.hands.length)) {
      return { ok: false, message: `${seat.name} a une mise en jeu : attends la fin de la main.` };
    }

    this.seats = this.seats.filter((s) => s.id !== targetId);
    this.profiles.delete(targetId);
    this.say('Croupier', `${seat.name} a été retiré de la table.`);
    this.broadcast();
    return { ok: true, seat };
  }

  /* ── Cycle ── */

  /** Marque la table comme vivante : une mise vient d'être posée. */
  touch() {
    this.lastActivityAt = Date.now();
  }

  async setBet(profile, amount, rawSide) {
    if (this.phase !== 'betting' && this.phase !== 'waiting') {
      return { ok: false, message: 'La main est déjà lancée, attends la suivante.' };
    }
    const seat = this.seatOf(profile.id);
    if (!seat) return { ok: false, message: 'Tu n’es pas assis à cette table.' };

    // Si la table patientait, on ouvre le tour AVANT de poser la mise :
    // `startBetting` remet les sièges à zéro, et le faire après effacerait
    // ce qu'on vient d'enregistrer.
    if (this.phase === 'waiting') this.startBetting();

    const stake = Math.floor(Number(amount) || 0);
    if (stake < MIN_BET) return { ok: false, message: `Mise minimum : ${MIN_BET} pièces.` };
    if (stake > MAX_BET) return { ok: false, message: `Mise maximum : ${MAX_BET} pièces.` };

    // On rembourse tout ce qui était déjà posé avant de reposer la nouvelle
    // mise : principale et paris annexes partent et reviennent ensemble.
    const already = seat.bet + (seat.side ? seat.side.pairs + seat.side.trio : 0);
    profile.vault.coins += already;

    const side = sidebets.normalise(rawSide, Math.max(0, profile.vault.coins - stake));
    if (!side.ok) {
      profile.vault.coins -= already;
      return side;
    }

    const total = stake + side.total;
    if (profile.vault.coins < total) {
      const missing = total - profile.vault.coins;
      profile.vault.coins -= already;
      return { ok: false, message: `Il te manque ${missing} pièces.` };
    }

    profile.vault.coins -= total;
    seat.bet = stake;
    seat.side = side.side;
    seat.chips = profile.vault.coins;
    this.touch();

    this.broadcast();
    this.dealIfEveryoneIsIn();
    return { ok: true, coins: profile.vault.coins };
  }

  /** Active ou coupe la remise automatique de la même mise. */
  setAuto(userId, on) {
    const seat = this.seatOf(userId);
    if (!seat) return { ok: false, message: 'Tu n’es pas assis à cette table.' };
    seat.auto = Boolean(on);
    this.broadcast();
    return {
      ok: true,
      message: seat.auto
        ? 'Mode auto : ta mise est reposée à chaque tour.'
        : 'Mode auto coupé.',
    };
  }

  /**
   * Ouvre un tour de mises.
   *
   * La table tourne en continu dès sa création : on n'attend pas qu'un
   * joueur mise pour lancer le compte à rebours. Qui arrive en cours de
   * route n'a qu'à poser sa mise avant la fin du décompte.
   */
  startBetting() {
    clearTimeout(this.timer);
    this.phase = 'betting';
    this.deadline = Date.now() + BETTING_MS;
    this.dealer = { cards: [] };
    this.activeSeat = -1;

    for (const seat of this.seats) {
      seat.hands = [];
      seat.activeHand = 0;
      seat.lastResult = null;
      seat.side = null;
      seat.sideResult = null;
      // Mode auto : on repose la mise précédente tant qu'il y a de quoi.
      if (seat.auto && seat.lastBet) this.autoRebet(seat);
    }

    this.broadcast();
    this.timer = setTimeout(() => this.deal(), BETTING_MS);
    // Si tout le monde est en mode auto, les mises sont déjà posées.
    this.dealIfEveryoneIsIn();
  }

  /**
   * Tout le monde a misé : on distribue sans attendre la fin du décompte.
   *
   * Rester à regarder tourner vingt secondes de chronomètre à trois quand
   * les trois ont déjà posé leurs jetons, c'est la principale raison pour
   * laquelle on quitte une table. On laisse une seconde et demie pour que le
   * dernier voie sa mise s'afficher, puis on lance.
   */
  dealIfEveryoneIsIn() {
    if (this.phase !== 'betting') return false;

    const present = this.seats.filter((s) => s.connected);
    if (present.length < 1) return false;
    if (!present.every((s) => s.bet >= MIN_BET)) return false;

    clearTimeout(this.timer);
    this.deadline = Date.now() + 1500;
    this.say('Croupier', present.length > 1
      ? 'Tout le monde a misé — on distribue.'
      : 'Mise posée — on distribue.');
    this.broadcast();
    this.timer = setTimeout(() => this.deal(), 1500);
    return true;
  }

  /** Repose la mise du tour précédent, si le solde le permet. */
  autoRebet(seat) {
    const profile = this.profiles && this.profiles.get(seat.id);
    if (!profile) return;
    const total = seat.lastBet + (seat.lastSide ? seat.lastSide.pairs + seat.lastSide.trio : 0);
    if (profile.vault.coins < total) {
      seat.auto = false;
      this.say('Croupier', `${seat.name} n'a plus de quoi suivre : mode auto coupé.`);
      return;
    }
    profile.vault.coins -= total;
    seat.bet = seat.lastBet;
    seat.side = seat.lastSide ? { ...seat.lastSide } : null;
    seat.chips = profile.vault.coins;
    if (this.onProfile) this.onProfile(profile);
  }

  deal() {
    const playing = this.seats.filter((s) => s.bet >= MIN_BET);
    if (!playing.length) {
      // Personne n'a misé : on relance simplement un tour. La table ne
      // s'arrête jamais tant que quelqu'un la regarde ; le concierge la
      // ferme si elle reste vide dix minutes.
      this.phase = 'waiting';
      this.deadline = Date.now() + BETTING_MS;
      this.broadcast();
      // Plus personne d'assis : on arrête de tourner dans le vide. Le
      // concierge fermera la table, et `wake()` la relancera si quelqu'un
      // revient s'asseoir avant.
      if (!this.seats.some((s) => s.connected)) {
        this.cycling = false;
        return;
      }
      this.timer = setTimeout(() => this.startBetting(), 1500);
      return;
    }

    this.hand += 1;
    this.phase = 'dealing';
    this.deadline = null;
    for (const seat of playing) {
      seat.hands = [{ cards: [], bet: seat.bet, doubled: false, done: false, split: false }];
    }
    this.dealer = { cards: [] };
    this.broadcast();

    // Distribution carte par carte, pour que ça se voie à l'écran.
    const steps = [];
    for (let round = 0; round < 2; round++) {
      for (const seat of playing) steps.push(() => seat.hands[0].cards.push(this.draw()));
      steps.push(() => this.dealer.cards.push(this.draw()));
    }

    let i = 0;
    const next = () => {
      if (i >= steps.length) return this.afterDeal(playing);
      steps[i++]();
      this.broadcast();
      this.stepTimer = setTimeout(next, DEAL_STEP_MS);
    };
    next();
  }

  afterDeal(playing) {
    // Un blackjack se règle tout de suite.
    for (const seat of playing) {
      if (isBlackjack(seat.hands[0].cards)) seat.hands[0].done = true;
    }
    if (isBlackjack(this.dealer.cards)) return this.dealerTurn();

    // Les paris annexes ne dépendent que de la donne : on les règle tout de
    // suite, avant même que le premier joueur ne décide quoi que ce soit.
    this.settleSides();

    this.phase = 'playing';
    this.activeSeat = -1;
    this.nextSeat();
  }

  nextSeat() {
    clearTimeout(this.timer);
    const playing = this.seats.filter((s) => s.hands.length);

    for (let i = this.activeSeat + 1; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (!seat.hands.length) continue;
      const hand = seat.hands.find((h) => !h.done);
      if (!hand) continue;
      this.activeSeat = i;
      seat.activeHand = seat.hands.indexOf(hand);
      this.deadline = Date.now() + TURN_MS;
      this.broadcast();
      this.timer = setTimeout(() => this.act(seat.id, 'stand', true), TURN_MS);
      return;
    }

    this.dealerTurn();
  }

  applyMove(seat, move, profile) {
    const hand = seat.hands[seat.activeHand];
    if (!hand || hand.done) return { ok: false, message: 'Ce n’est pas le moment.' };

    if (move === 'hit') {
      hand.cards.push(this.draw());
      const { total } = handValue(hand.cards);
      if (total >= 21) hand.done = true;
      return { ok: true };
    }

    if (move === 'stand') {
      hand.done = true;
      return { ok: true };
    }

    if (move === 'double') {
      if (hand.cards.length !== 2 || hand.doubled) return { ok: false, message: 'Double impossible ici.' };
      if (profile) {
        if (profile.vault.coins < hand.bet) return { ok: false, message: 'Pas assez de pièces pour doubler.' };
        profile.vault.coins -= hand.bet;
        seat.chips = profile.vault.coins;
      }
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(this.draw());
      hand.done = true;
      return { ok: true };
    }

    if (move === 'split') {
      if (seat.hands.length > 1) return { ok: false, message: 'Un seul split par main.' };
      if (hand.cards.length !== 2) return { ok: false, message: 'Split impossible ici.' };
      if (cardValue(hand.cards[0].r) !== cardValue(hand.cards[1].r)) {
        return { ok: false, message: 'Il faut deux cartes de même valeur.' };
      }
      if (profile) {
        if (profile.vault.coins < hand.bet) return { ok: false, message: 'Pas assez de pièces pour splitter.' };
        profile.vault.coins -= hand.bet;
        seat.chips = profile.vault.coins;
      }
      const moved = hand.cards.pop();
      const second = { cards: [moved], bet: hand.bet, doubled: false, done: false, split: true };
      hand.split = true;
      hand.cards.push(this.draw());
      second.cards.push(this.draw());
      seat.hands.push(second);

      // Les as splittés ne reçoivent qu'une carte chacun.
      if (moved.r === 'A') {
        hand.done = true;
        second.done = true;
      }
      return { ok: true };
    }

    return { ok: false, message: 'Coup inconnu.' };
  }

  act(userId, move, auto = false) {
    if (this.phase !== 'playing') return { ok: false, message: 'Ce n’est pas le moment.' };
    const seat = this.seats[this.activeSeat];
    if (!seat || seat.id !== userId) return { ok: false, message: 'Ce n’est pas ton tour.' };

    const profile = this.profiles && this.profiles.get(userId);
    const result = this.applyMove(seat, move, profile || null);
    if (!result.ok) return result;

    if (auto) this.say('Croupier', `${seat.name} a laissé filer le temps.`);

    const hasMore = seat.hands.some((h) => !h.done);
    if (hasMore) {
      seat.activeHand = seat.hands.findIndex((h) => !h.done);
      clearTimeout(this.timer);
      this.deadline = Date.now() + TURN_MS;
      this.broadcast();
      this.timer = setTimeout(() => this.act(seat.id, 'stand', true), TURN_MS);
    } else {
      this.nextSeat();
    }
    return { ok: true };
  }

  dealerTurn() {
    clearTimeout(this.timer);
    clearTimeout(this.stepTimer);
    this.phase = 'dealer';
    this.activeSeat = -1;
    this.deadline = null;
    this.broadcast();

    const anyoneStanding = this.seats.some((s) =>
      s.hands.some((h) => handValue(h.cards).total <= 21 && !isBlackjack(h.cards))
    );

    const step = () => {
      const { total } = handValue(this.dealer.cards);
      // Le croupier reste sur tous les 17. S'il ne reste personne en lice,
      // inutile de tirer : on va au paiement.
      if (!anyoneStanding || total >= 17) return this.settle();
      this.dealer.cards.push(this.draw());
      this.broadcast();
      this.stepTimer = setTimeout(step, DEAL_STEP_MS + 200);
    };
    this.stepTimer = setTimeout(step, 700);
  }

  async settle() {
    this.phase = 'payout';
    this.deadline = Date.now() + PAYOUT_MS;

    const dealerTotal = handValue(this.dealer.cards).total;
    const dealerBJ = isBlackjack(this.dealer.cards);
    const dealerBust = dealerTotal > 21;

    for (const seat of this.seats) {
      if (!seat.hands.length) continue;
      let payout = 0;
      const results = [];

      for (const hand of seat.hands) {
        const total = handValue(hand.cards).total;
        const bj = isBlackjack(hand.cards) && seat.hands.length === 1;
        let outcome;
        let gain = 0;

        if (total > 21) {
          outcome = 'bust';
        } else if (bj && !dealerBJ) {
          outcome = 'blackjack';
          gain = Math.round(hand.bet * (1 + BLACKJACK_PAYS));
        } else if (dealerBJ && !bj) {
          outcome = 'lose';
        } else if (dealerBJ && bj) {
          outcome = 'push';
          gain = hand.bet;
        } else if (dealerBust || total > dealerTotal) {
          outcome = 'win';
          gain = hand.bet * 2;
        } else if (total === dealerTotal) {
          outcome = 'push';
          gain = hand.bet;
        } else {
          outcome = 'lose';
        }

        payout += gain;
        results.push({ outcome, total, bet: hand.bet, gain });
      }

      seat.lastResult = { payout, results, staked: seat.hands.reduce((s, h) => s + h.bet, 0) };

      if (payout > 0) {
        const profile = this.profiles && this.profiles.get(seat.id);
        if (profile) {
          profile.vault.coins += payout;
          seat.chips = profile.vault.coins;
          if (this.onProfile) this.onProfile(profile);
        }
      }
      // On retient la mise pour le bouton « remiser » et le mode auto.
      seat.lastBet = seat.bet || seat.lastBet;
      seat.lastSide = seat.side ? { ...seat.side } : seat.lastSide;
      seat.bet = 0;
    }

    if (this.onSettle) await this.onSettle(this);

    this.broadcast();
    this.timer = setTimeout(() => this.startBetting(), PAYOUT_MS);
  }

  /** Règle « paire » et « 21+3 » à partir de la donne. */
  settleSides() {
    const upCard = this.dealer.cards[0];
    for (const seat of this.seats) {
      if (!seat.side || !seat.hands.length) continue;
      const cards = seat.hands[0].cards;
      if (cards.length < 2) continue;

      const result = sidebets.settle(seat.side, cards, upCard);
      seat.sideResult = result;

      if (result.payout > 0) {
        const profile = this.profiles && this.profiles.get(seat.id);
        if (profile) {
          profile.vault.coins += result.payout;
          seat.chips = profile.vault.coins;
          if (this.onProfile) this.onProfile(profile);
        }
        const won = [result.pairs, result.trio].filter((r) => r && r.payout > 0);
        for (const w of won) this.say('Croupier', `${seat.name} touche ${w.name} : +${w.payout} ¤`);
      }
    }
  }

  /* ── Divers ── */

  say(name, text) {
    this.log.unshift({ at: Date.now(), name, text });
    this.log.length = Math.min(this.log.length, 30);
  }

  publicState(userId) {
    const seat = this.seatOf(userId);
    const dealerCards =
      this.phase === 'playing' || this.phase === 'dealing'
        ? this.dealer.cards.map((c, i) => (i === 1 ? { hidden: true } : c))
        : this.dealer.cards;

    return {
      code: this.code,
      phase: this.phase,
      deadline: this.deadline,
      serverNow: Date.now(),
      hand: this.hand,
      hostId: this.hostId,
      isHost: this.hostId === userId,
      // Assis ou simple spectateur : l'écran ne montre pas la même chose.
      seated: Boolean(seat),
      watching: !seat && this.watchers.has(userId),
      seatsFree: SEATS - this.seats.length,
      watchers: [...this.watchers.values()].map((w) => ({ id: w.id, name: w.name, avatar: w.avatar })),
      minBet: MIN_BET,
      maxBet: MAX_BET,
      seatsMax: SEATS,
      shoeSeedHash: this.shoeSeedHash,
      previousShoe: this.previousShoe || null,
      penetration: Math.round((this.dealt / this.shoe.length) * 100),
      dealer: {
        cards: dealerCards,
        value: this.phase === 'playing' || this.phase === 'dealing' ? null : handValue(this.dealer.cards),
      },
      activeSeat: this.activeSeat,
      seats: this.seats.map((s, i) => ({
        index: i,
        id: s.id,
        name: s.name,
        avatar: s.avatar,
        cosmetics: s.cosmetics || null,
        connected: s.connected,
        isYou: s.id === userId,
        bet: s.bet,
        side: s.side || null,
        sideResult: s.sideResult || null,
        auto: Boolean(s.auto),
        chips: s.chips,
        active: i === this.activeSeat,
        activeHand: s.activeHand,
        lastResult: s.lastResult,
        hands: s.hands.map((h) => ({
          cards: h.cards,
          bet: h.bet,
          doubled: h.doubled,
          done: h.done,
          value: handValue(h.cards),
          blackjack: isBlackjack(h.cards),
        })),
      })),
      sidebets: sidebets.view(),
      you: seat
        ? {
            seated: true,
            bet: seat.bet,
            side: seat.side || null,
            lastBet: seat.lastBet || 0,
            lastSide: seat.lastSide || null,
            auto: Boolean(seat.auto),
            canAct: this.phase === 'playing' && this.seats[this.activeSeat] === seat,
            moves: this.movesFor(seat),
          }
        : { seated: false },
      log: this.log.slice(0, 8),
    };
  }

  movesFor(seat) {
    if (this.phase !== 'playing' || this.seats[this.activeSeat] !== seat) return [];
    const hand = seat.hands[seat.activeHand];
    if (!hand || hand.done) return [];
    const moves = ['hit', 'stand'];
    if (hand.cards.length === 2 && !hand.doubled) moves.push('double');
    if (
      hand.cards.length === 2 &&
      seat.hands.length === 1 &&
      cardValue(hand.cards[0].r) === cardValue(hand.cards[1].r)
    ) {
      moves.push('split');
    }
    return moves;
  }

  broadcast() {
    const sockets = this.io.sockets.adapter.rooms.get('bj:' + this.code);
    if (!sockets) return;
    for (const socketId of sockets) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (!socket || !socket.data.user) continue;
      socket.emit('bj:state', this.publicState(socket.data.user.id));
    }
  }

  stop() {
    clearTimeout(this.timer);
    clearTimeout(this.stepTimer);
  }
}

/* ─── Registre ─────────────────────────────────────────── */

function createTable(io, store) {
  const code = makeCode();
  const table = new Table(code, io, store);
  table.profiles = new Map();
  tables.set(code, table);
  return table;
}

function getTable(code) {
  return tables.get(String(code || '').toUpperCase().trim());
}

function closeTable(code) {
  const table = getTable(code);
  if (!table) return false;
  table.stop();
  table.io.in('bj:' + table.code).socketsLeave('bj:' + table.code);
  tables.delete(table.code);
  return true;
}

const EMPTY_MS = 90 * 1000;      // plus personne de connecté
const IDLE_MS = 8 * 60 * 1000;   // du monde, mais plus une seule mise

/**
 * Ferme les tables qui ne servent plus.
 *
 * Deux cas, et le second compte autant que le premier : une table vide, et
 * une table où trois personnes sont restées connectées sans miser depuis huit
 * minutes. La seconde tournait en boucle pour rien — une manche toutes les
 * vingt secondes, indéfiniment — et encombrait la liste des salons ouverts
 * en faisant croire qu'il s'y passait quelque chose.
 */
function startJanitor() {
  setInterval(() => {
    const now = Date.now();
    for (const [code, table] of tables) {
      const empty = table.emptySince && now - table.emptySince > EMPTY_MS;
      const idle = !table.emptySince
        && table.lastActivityAt
        && now - table.lastActivityAt > IDLE_MS;

      if (empty || idle) {
        if (idle) {
          table.io.to('bj:' + code).emit('toast', {
            message: 'Table fermée : plus aucune mise depuis huit minutes.',
            kind: 'warn',
          });
        }
        table.stop();
        tables.delete(code);
      }
    }
  }, 30000).unref();
}

module.exports = {
  Table,
  createTable,
  getTable,
  closeTable,
  startJanitor,
  tables,
  handValue,
  isBlackjack,
  buildShoe,
  MIN_BET,
  MAX_BET,
  SEATS,
};
