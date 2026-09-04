'use strict';
/**
 * MONOPOLY.
 *
 * Le plateau français : boulevard de Belleville d'un bout, rue de la Paix
 * de l'autre. Toutes les règles sont là — monopoles, maisons et hôtels,
 * gares, services, prison, hypothèques, échanges entre joueurs, faillites.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES CINQ DÉCISIONS QUI FONT LA PARTIE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  1. UNE PARTIE PEUT FINIR.
 *     Un Monopoly « jusqu'à la faillite » dure trois heures et se termine
 *     par deux personnes qui abandonnent. On propose donc une longueur :
 *     30 ou 60 tours de table, puis c'est le plus riche qui gagne — la
 *     fortune compte l'argent, les terrains et les constructions. Le mode
 *     illimité existe toujours, pour ceux qui veulent la vraie chose.
 *
 *  2. ON NE PEUT PAS DEVOIR DE L'ARGENT ET CONTINUER À JOUER.
 *     Quand on ne peut pas payer, la partie s'arrête sur soi : il faut
 *     vendre des maisons ou hypothéquer jusqu'à réunir la somme, ou se
 *     déclarer en faillite. Le tour de personne d'autre n'avance tant que
 *     la dette n'est pas réglée — sinon on finirait avec des joueurs à
 *     découvert, ce qui n'existe pas dans ce jeu.
 *
 *  3. ON NE CONSTRUIT JAMAIS DE TRAVERS.
 *     Maisons réparties uniformément sur le groupe (un écart d'une maison
 *     au maximum), rien sur un groupe incomplet, rien sur un groupe où une
 *     case est hypothéquée, et le stock de la banque est fini : 32 maisons
 *     et 12 hôtels. La pénurie de maisons est une vraie stratégie, pas un
 *     détail — on ne l'a donc pas simplifiée.
 *
 *  4. UN REFUS EST EXPLIQUÉ.
 *     Comme à la belote : chaque action refusée renvoie une phrase qui dit
 *     pourquoi. « Il te manque une case du groupe », « tu as déjà quatre
 *     maisons ici », « la banque n'a plus d'hôtel ». On n'apprend pas les
 *     règles d'un jeu en voyant un bouton grisé.
 *
 *  5. UNE DÉCONNEXION NE BLOQUE JAMAIS LA TABLE.
 *     Chaque tour a une limite. Passé le délai, le serveur lance les dés
 *     et termine le tour à la place de l'absent — il n'achète rien et ne
 *     construit rien pour lui, mais la partie avance.
 *
 * Les dés viennent de la même mécanique d'équité que le reste du site :
 * graine serveur dont l'empreinte est publiée avant la partie, révélée à
 * la fin. Il n'y a pas une pièce en jeu ici, mais un tirage reproductible
 * rend le banc d'essai déterministe, et c'est déjà une bonne raison.
 */

const { Room } = require('./rooms');
const fair = require('../fair');
const B = require('./board');

const MIN = 2;
const MAX = 6;

const TURN_MS = 90 * 1000;     // au-delà, le serveur joue à ta place
const DEBT_MS = 120 * 1000;    // le temps de vendre pour payer sa dette

/** Les pions, dans l'ordre d'attribution. */
const TOKENS = ['🎩', '🚗', '🐕', '🚢', '👢', '🎸'];

/* ═══════════ Mélange d'un paquet de cartes ═══════════ */

function shuffleFrom(list, serverSeed, clientSeed, nonce) {
  const out = [...list];
  const rolls = fair.floats(serverSeed, clientSeed, nonce, out.length);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rolls[out.length - 1 - i] * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ═══════════ La partie ═══════════ */

class Monopoly extends Room {
  constructor(io) {
    super(io, { game: 'monopoly', min: MIN, max: MAX, name: 'Monopoly' });

    /* Réglages de l'hôte. */
    this.lapsTarget = 30;      // 0 = illimité, sinon 30 ou 60 tours de table
    this.doubleGo = false;     // 400 au lieu de 200 en tombant pile sur Départ
    this.auctions = true;      // la case refusée part au plus offrant

    /* État de la partie. */
    this.cells = B.BOARD.map(() => ({ ownerId: null, houses: 0, mortgaged: false }));
    this.money = new Map();
    this.pos = new Map();
    this.jail = new Map();     // id → { in, turns }
    this.freeCards = new Map();// id → nombre de cartes « libéré de prison »
    this.tokens = new Map();   // id → pion
    this.order = [];
    this.turn = 0;
    this.laps = 0;             // tours de table complets
    this.step = 'roll';        // roll | decide | debt | end
    this.dice = null;          // [a, b]
    this.doubles = 0;          // doublés consécutifs dans ce tour
    this.again = false;        // ce joueur relance-t-il après cette case ?
    this.pendingBuy = null;    // { cellIndex, price }
    this.debt = null;          // { playerId, amount, toId | null, reason }
    this.rentBoost = null;     // { kind: 'gare-double' | 'service-dix' } posé par une carte
    this.trade = null;         // l'offre en cours d'examen
    this.auction = null;       // { cell, high, bidder, order, at, out:[] }
    this.houses = B.HOUSES;
    this.hotels = B.HOTELS;
    this.deadline = 0;
    this.timer = null;
    this.log = [];
    this.result = null;
    this.card = null;          // la carte qu'on vient de tirer, pour l'afficher

    /* Les deux paquets. */
    this.chanceDeck = [];
    this.chanceAt = 0;
    this.caisseDeck = [];
    this.caisseAt = 0;

    this.nonce = 0;
    this.serverSeed = fair.newServerSeed();
    this.serverSeedHash = fair.hashSeed(this.serverSeed);
    this.previousSeed = null;
  }

  /* ─── Petits utilitaires ───────────────────────────────────────────── */

  nameOf(id) {
    const p = this.playerOf(id);
    return p ? p.name : '—';
  }

  note(text) {
    this.log.unshift({ text, at: Date.now() });
    this.log.length = Math.min(this.log.length, 30);
  }

  /** Les joueurs encore en lice, dans l'ordre de jeu. */
  living() {
    return this.order.filter((id) => {
      const p = this.playerOf(id);
      return p && !p.out;
    });
  }

  currentId() {
    return this.order[this.turn] || null;
  }

  /**
   * L'ordre à afficher.
   *
   * `this.order` n'est rempli qu'au lancement : avant ça il est vide, et
   * le salon paraissait désert alors que trois personnes y attendaient.
   * On retombe donc sur la liste des joueurs tant que la partie n'a pas
   * commencé — le même piège que l'Uno et la belote avaient eu.
   */
  seating() {
    return this.order.length ? this.order : this.players.map((p) => p.id);
  }

  cash(id) {
    return this.money.get(id) || 0;
  }

  /* ─── Réglages ─────────────────────────────────────────────────────── */

  configure(userId, { laps, doubleGo, auctions } = {}) {
    if (userId !== this.hostId) return { ok: false, message: 'Seul l’hôte règle la partie.' };
    if (this.phase !== 'lobby') return { ok: false, message: 'La partie est en cours.' };
    if ([0, 30, 60].includes(Number(laps))) this.lapsTarget = Number(laps);
    if (typeof doubleGo === 'boolean') this.doubleGo = doubleGo;
    if (typeof auctions === 'boolean') this.auctions = auctions;
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

    this.phase = 'play';
    this.cells = B.BOARD.map(() => ({ ownerId: null, houses: 0, mortgaged: false }));
    this.houses = B.HOUSES;
    this.hotels = B.HOTELS;
    this.order = this.players.map((p) => p.id);
    this.players.forEach((p, i) => {
      p.out = false;
      this.money.set(p.id, B.START_MONEY);
      this.pos.set(p.id, B.GO);
      this.jail.set(p.id, { in: false, turns: 0 });
      this.freeCards.set(p.id, 0);
      this.tokens.set(p.id, TOKENS[i % TOKENS.length]);
    });

    this.chanceDeck = shuffleFrom(B.CHANCE.map((_, i) => i), this.serverSeed, this.code, 1);
    this.caisseDeck = shuffleFrom(B.CAISSE.map((_, i) => i), this.serverSeed, this.code, 2);
    this.chanceAt = 0;
    this.caisseAt = 0;

    this.turn = 0;
    this.laps = 0;
    this.doubles = 0;
    this.dice = null;
    this.card = null;
    this.debt = null;
    this.trade = null;
    this.auction = null;
    this.result = null;
    this.log = [];
    this.nonce = 10;

    this.note(`Partie lancée — ${B.START_MONEY} chacun.`);
    this.beginTurn();
    return { ok: true };
  }

  /* ─── Le tour ──────────────────────────────────────────────────────── */

  beginTurn() {
    clearTimeout(this.timer);
    this.doubles = 0;
    this.again = false;
    this.dice = null;
    this.card = null;
    this.pendingBuy = null;
    this.rentBoost = null;
    this.step = 'roll';
    this.armTimer();
    this.broadcast();
  }

  /**
   * Le minuteur du tour.
   *
   * Il ne « joue » pas vraiment à la place de l'absent : il lance les dés,
   * subit ce qui tombe, n'achète rien, et passe. C'est le minimum pour que
   * la table avance sans décider à la place de quelqu'un.
   */
  armTimer() {
    clearTimeout(this.timer);
    const ms = this.step === 'debt' ? DEBT_MS : TURN_MS;
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => this.autoPlay(), ms);
  }

  autoPlay() {
    if (this.phase !== 'play') return;

    if (this.step === 'debt' && this.debt) {
      // On a laissé le temps de vendre. À court d'idées, c'est la faillite.
      const id = this.debt.playerId;
      this.note(`${this.nameOf(id)} ne peut pas payer : faillite.`);
      return this.bankrupt(id, this.debt.toId);
    }

    const id = this.currentId();
    if (!id) return;

    if (this.step === 'roll') {
      const r = this.roll(id, { auto: true });
      if (!r.ok) return this.endTurn(id, { auto: true });
      // Après le lancer on reprend le fil : si un choix reste ouvert, on
      // le referme sans rien acheter.
      if (this.step === 'decide') this.pass(id, { auto: true });
      if (this.step === 'end') this.endTurn(id, { auto: true });
      return;
    }
    if (this.step === 'decide') { this.pass(id, { auto: true }); return; }
    // Une enchère qui traîne : celui qui ne répond pas passe, comme à une
    // vraie table où le commissaire-priseur n'attend pas.
    if (this.step === 'auction') {
      const who = this.auctionWho();
      if (who) this.passBid(who);
      return;
    }
    if (this.step === 'end') return this.endTurn(id, { auto: true });
  }

  /* ─── Les dés ──────────────────────────────────────────────────────── */

  rollDice() {
    this.nonce += 1;
    const [a, b] = fair.floats(this.serverSeed, this.code, this.nonce, 2);
    return [1 + Math.floor(a * 6), 1 + Math.floor(b * 6)];
  }

  roll(userId, { auto = false } = {}) {
    if (this.phase !== 'play') return { ok: false, message: 'La partie n’est pas en cours.' };
    if (userId !== this.currentId()) return { ok: false, message: 'Ce n’est pas ton tour.' };
    if (this.step !== 'roll') return { ok: false, message: 'Tu as déjà lancé.' };

    const dice = this.rollDice();
    this.dice = dice;
    const isDouble = dice[0] === dice[1];
    const total = dice[0] + dice[1];
    const jail = this.jail.get(userId);

    /* ── En prison ── */
    if (jail.in) {
      if (isDouble) {
        jail.in = false;
        jail.turns = 0;
        this.note(`${this.nameOf(userId)} fait un double ${dice[0]} et sort de prison.`);
        // Un double qui libère ne donne pas droit à un second lancer.
        this.again = false;
        this.advance(userId, total);
        return { ok: true };
      }
      jail.turns += 1;
      if (jail.turns >= B.JAIL_TURNS) {
        // Troisième échec : on paie l'amende et on avance quand même.
        this.note(`${this.nameOf(userId)} rate son troisième double : amende de ${B.JAIL_FINE}.`);
        if (!this.charge(userId, B.JAIL_FINE, null, 'amende de sortie de prison')) return { ok: true };
        jail.in = false;
        jail.turns = 0;
        this.again = false;
        this.advance(userId, total);
        return { ok: true };
      }
      this.note(`${this.nameOf(userId)} reste en prison (${dice[0]}+${dice[1]}).`);
      this.step = 'end';
      this.armTimer();
      this.broadcast();
      return { ok: true };
    }

    /* ── Trois doubles d'affilée : direction la prison ── */
    if (isDouble) {
      this.doubles += 1;
      if (this.doubles >= 3) {
        this.note(`${this.nameOf(userId)} fait un troisième double — en prison.`);
        this.sendToJail(userId);
        this.again = false;
        this.step = 'end';
        this.armTimer();
        this.broadcast();
        return { ok: true };
      }
    }
    // Un double rejoue ; un lancer simple met fin au tour après la case.
    this.again = isDouble;

    void auto;
    this.advance(userId, total);
    return { ok: true };
  }

  /* ─── Le déplacement ───────────────────────────────────────────────── */

  /** Avance de n cases, en encaissant le salaire au passage du Départ. */
  advance(userId, steps) {
    const from = this.pos.get(userId);
    const to = (from + steps) % 40;
    if (steps > 0 && to < from) this.passGo(userId);
    this.pos.set(userId, to);
    this.land(userId);
  }

  /** Va directement à une case, en encaissant le Départ si on le franchit. */
  goTo(userId, index, { salary = true } = {}) {
    const from = this.pos.get(userId);
    if (salary && index < from) this.passGo(userId);
    this.pos.set(userId, index);
    this.land(userId);
  }

  passGo(userId) {
    this.money.set(userId, this.cash(userId) + B.SALARY);
    this.note(`${this.nameOf(userId)} passe par la case Départ : +${B.SALARY}.`);
  }

  sendToJail(userId) {
    this.pos.set(userId, B.JAIL);
    this.jail.set(userId, { in: true, turns: 0 });
    // On ne relance pas depuis la prison, même après un double.
    this.again = false;
  }

  /* ─── Ce qui arrive quand on tombe sur une case ─────────────────────── */

  land(userId) {
    const index = this.pos.get(userId);
    const cell = B.BOARD[index];
    const state = this.cells[index];
    const name = this.nameOf(userId);

    switch (cell.type) {
      case 'depart':
        // On a déjà touché le salaire en franchissant la case ; tomber
        // pile dessus peut le doubler, si l'hôte l'a réglé ainsi.
        if (this.doubleGo) {
          this.money.set(userId, this.cash(userId) + B.SALARY);
          this.note(`${name} tombe pile sur le Départ : +${B.SALARY} de plus.`);
        }
        break;

      case 'prison':
      case 'parc':
        break;

      case 'go-prison':
        this.note(`${name} va en prison.`);
        this.sendToJail(userId);
        break;

      case 'impot':
      case 'taxe':
        this.note(`${name} paie ${cell.amount} — ${cell.name.toLowerCase()}.`);
        if (!this.charge(userId, cell.amount, null, cell.name.toLowerCase())) return;
        break;

      case 'chance':
      case 'caisse':
        this.drawCard(userId, cell.type);
        return;   // la carte enchaîne elle-même sur la suite

      default: {
        // Une case achetable : libre, à soi, ou à quelqu'un d'autre.
        if (!state.ownerId) {
          this.pendingBuy = { cellIndex: index, price: cell.price };
          this.step = 'decide';
          this.armTimer();
          this.broadcast();
          return;
        }
        if (state.ownerId === userId) break;
        if (state.mortgaged) {
          this.note(`${name} tombe sur ${cell.name}, hypothéquée : rien à payer.`);
          break;
        }
        const rent = this.rentFor(index, this.dice);
        this.note(`${name} paie ${rent} à ${this.nameOf(state.ownerId)} — ${cell.name}.`);
        if (!this.charge(userId, rent, state.ownerId, `loyer de ${cell.name}`)) return;
        break;
      }
    }

    this.afterLanding(userId);
  }

  /**
   * Fin de case : soit on rejoue (double), soit on passe en phase de
   * gestion. Cette fonction est appelée depuis plusieurs endroits — après
   * un loyer, après une carte — d'où son existence.
   */
  afterLanding(userId) {
    // On teste la dette, pas la phase : `pay()` vient de vider la dette
    // mais la phase est encore « debt », et se fier à elle laissait la
    // partie bloquée sur une dette déjà réglée.
    if (this.debt) return;
    const jail = this.jail.get(userId);
    // Le bonus d'une carte ne vaut que pour la case où l'on vient de tomber.
    this.rentBoost = null;
    this.step = (this.again && !jail.in) ? 'roll' : 'end';
    this.armTimer();
    this.broadcast();
  }

  /* ─── Les loyers ───────────────────────────────────────────────────── */

  /** Combien de cases de ce groupe appartiennent à ce joueur. */
  ownedInGroup(ownerId, group) {
    const list = group === 'gare' ? B.GARES : group === 'service' ? B.SERVICES : (B.GROUP_CELLS[group] || []);
    return list.filter((i) => this.cells[i].ownerId === ownerId).length;
  }

  /** Le joueur possède-t-il tout le groupe de couleur ? */
  hasMonopoly(ownerId, group) {
    const list = B.GROUP_CELLS[group];
    if (!list) return false;
    return list.every((i) => this.cells[i].ownerId === ownerId);
  }

  rentFor(index, dice) {
    const cell = B.BOARD[index];
    const state = this.cells[index];
    if (!state.ownerId || state.mortgaged) return 0;

    if (cell.type === 'gare') {
      const n = this.ownedInGroup(state.ownerId, 'gare');
      const base = 25 * Math.pow(2, Math.max(0, n - 1));
      // La carte Chance « la gare la plus proche » double le loyer.
      return this.rentBoost === 'gare-double' ? base * 2 : base;
    }

    if (cell.type === 'service') {
      const sum = dice ? dice[0] + dice[1] : 7;
      const n = this.ownedInGroup(state.ownerId, 'service');
      // La carte Chance impose dix fois, même avec un seul service.
      const mult = this.rentBoost === 'service-dix' ? 10 : (n >= 2 ? 10 : 4);
      return sum * mult;
    }

    if (state.houses > 0) return cell.rent[state.houses];
    // Terrain nu : loyer doublé si le groupe entier appartient au même
    // joueur et qu'aucune de ses cases n'est hypothéquée.
    const whole = this.hasMonopoly(state.ownerId, cell.group)
      && B.GROUP_CELLS[cell.group].every((i) => !this.cells[i].mortgaged);
    return whole ? cell.rent[0] * 2 : cell.rent[0];
  }

  /* ─── L'argent ─────────────────────────────────────────────────────── */

  /**
   * Prélève une somme. Renvoie `true` si elle est payée sur-le-champ.
   *
   * Si le joueur n'a pas de quoi, on n'invente pas de découvert : la
   * partie s'arrête sur lui, en phase `debt`, jusqu'à ce qu'il vende de
   * quoi payer ou se déclare en faillite.
   */
  charge(userId, amount, toId, reason) {
    const have = this.cash(userId);
    if (have >= amount) {
      this.money.set(userId, have - amount);
      if (toId) this.money.set(toId, this.cash(toId) + amount);
      return true;
    }
    this.debt = { playerId: userId, amount, toId: toId || null, reason };
    this.step = 'debt';
    this.note(`${this.nameOf(userId)} doit ${amount} et n’a que ${have} — il doit vendre.`);
    this.armTimer();
    this.broadcast();
    return false;
  }

  pay(userId) {
    if (!this.debt || this.debt.playerId !== userId) return { ok: false, message: 'Tu n’as rien à payer.' };
    const { amount, toId } = this.debt;
    if (this.cash(userId) < amount) {
      return { ok: false, message: `Il te manque encore ${amount - this.cash(userId)}. Vends ou hypothèque.` };
    }
    this.money.set(userId, this.cash(userId) - amount);
    if (toId) this.money.set(toId, this.cash(toId) + amount);
    this.note(`${this.nameOf(userId)} règle sa dette de ${amount}.`);
    this.debt = null;
    this.afterLanding(userId);
    return { ok: true };
  }

  /* ─── Les cartes ───────────────────────────────────────────────────── */

  drawCard(userId, kind) {
    const deck = kind === 'chance' ? this.chanceDeck : this.caisseDeck;
    const list = kind === 'chance' ? B.CHANCE : B.CAISSE;
    const at = kind === 'chance' ? this.chanceAt : this.caisseAt;
    const card = list[deck[at % deck.length]];
    if (kind === 'chance') this.chanceAt = (at + 1) % deck.length;
    else this.caisseAt = (at + 1) % deck.length;

    this.card = { kind, text: card.text };
    this.note(`${this.nameOf(userId)} — ${kind === 'chance' ? 'Chance' : 'Caisse commune'} : ${card.text}`);
    this.applyCard(userId, card);
  }

  applyCard(userId, card) {
    const name = this.nameOf(userId);

    switch (card.do) {
      case 'gain':
        this.money.set(userId, this.cash(userId) + card.amount);
        break;

      case 'perte':
        if (!this.charge(userId, card.amount, null, 'carte')) return;
        break;

      case 'go':
        return this.goTo(userId, card.to);

      case 'recule': {
        const from = this.pos.get(userId);
        // Reculer ne fait jamais repasser par le Départ.
        this.pos.set(userId, (from - card.steps + 40) % 40);
        return this.land(userId);
      }

      case 'prison':
        this.sendToJail(userId);
        break;

      case 'liberte':
        this.freeCards.set(userId, (this.freeCards.get(userId) || 0) + 1);
        break;

      case 'gare-proche': {
        const from = this.pos.get(userId);
        const target = B.GARES.find((i) => i > from) ?? B.GARES[0];
        this.rentBoost = 'gare-double';
        return this.goTo(userId, target);
      }

      case 'service-proche': {
        const from = this.pos.get(userId);
        const target = B.SERVICES.find((i) => i > from) ?? B.SERVICES[0];
        this.rentBoost = 'service-dix';
        // On relance les dés : c'est ce montant-là qui sert au calcul.
        this.dice = this.rollDice();
        return this.goTo(userId, target);
      }

      case 'reparations': {
        let due = 0;
        for (let i = 0; i < 40; i++) {
          const s = this.cells[i];
          if (s.ownerId !== userId || !s.houses) continue;
          due += s.houses === 5 ? card.hotel : s.houses * card.house;
        }
        if (due > 0) {
          this.note(`${name} paie ${due} de réparations.`);
          if (!this.charge(userId, due, null, 'réparations')) return;
        }
        break;
      }

      case 'anniversaire': {
        let got = 0;
        for (const id of this.living()) {
          if (id === userId) continue;
          const give = Math.min(card.amount, this.cash(id));
          this.money.set(id, this.cash(id) - give);
          got += give;
        }
        this.money.set(userId, this.cash(userId) + got);
        this.note(`${name} reçoit ${got} de ses camarades.`);
        break;
      }

      default:
        break;
    }

    this.afterLanding(userId);
  }

  /* ─── Acheter, ou passer ───────────────────────────────────────────── */

  buy(userId) {
    if (this.step !== 'decide' || !this.pendingBuy) return { ok: false, message: 'Rien à acheter ici.' };
    if (userId !== this.currentId()) return { ok: false, message: 'Ce n’est pas ton tour.' };

    const { cellIndex, price } = this.pendingBuy;
    if (this.cash(userId) < price) {
      return { ok: false, message: `Il te manque ${price - this.cash(userId)} pour cette case.` };
    }
    this.money.set(userId, this.cash(userId) - price);
    this.cells[cellIndex].ownerId = userId;
    this.note(`${this.nameOf(userId)} achète ${B.BOARD[cellIndex].name} pour ${price}.`);
    this.pendingBuy = null;
    this.afterLanding(userId);
    return { ok: true };
  }

  /**
   * Refuser d'acheter.
   *
   * Sans enchère, la case reste simplement libre : le joueur suivant qui
   * tombe dessus pourra la prendre. C'est la variante « maison » que tout
   * le monde joue, et elle évite un tour de table à chaque refus.
   */
  pass(userId, { auto = false } = {}) {
    if (this.step !== 'decide' || !this.pendingBuy) return { ok: false, message: 'Rien à refuser.' };
    if (userId !== this.currentId()) return { ok: false, message: 'Ce n’est pas ton tour.' };

    const cell = this.pendingBuy.cellIndex;
    this.pendingBuy = null;
    this.note(`${this.nameOf(userId)} laisse passer ${B.BOARD[cell].name}.`);
    void auto;

    // La règle officielle : la case part au plus offrant. C'est elle qui
    // empêche les parties de s'enliser en « personne n'a rien » — sans
    // enchère, un joueur peut refuser tout un groupe pour être sûr que
    // personne ne l'ait, et la partie ne décolle jamais.
    if (this.auctions && this.living().length > 1) return this.openAuction(cell);

    this.afterLanding(userId);
    return { ok: true };
  }

  /* ─── Les enchères ─────────────────────────────────────────────────── */

  /**
   * La case refusée part au plus offrant.
   *
   * Départ à 10, chacun son tour, on monte ou on passe. Passer est
   * définitif — sinon un tour d'enchère peut durer plus longtemps que la
   * partie. Le dernier debout emporte la case à son prix ; si tout le
   * monde passe sans miser, elle reste libre.
   */
  openAuction(cellIndex) {
    const order = this.living();
    this.auction = {
      cell: cellIndex,
      high: 0,
      bidder: null,
      order,
      at: 0,          // index dans `order`
      out: [],        // ceux qui ont passé
    };
    this.step = 'auction';
    this.note(`${B.BOARD[cellIndex].name} part aux enchères.`);
    this.armTimer();
    this.broadcast();
    return { ok: true };
  }

  /** Le prochain à parler, ou null si l'enchère est finie. */
  auctionNext() {
    const a = this.auction;
    if (!a) return null;
    const live = a.order.filter((id) => !a.out.includes(id) && this.living().includes(id));
    if (live.length <= 1) return null;
    for (let step = 1; step <= a.order.length; step++) {
      const id = a.order[(a.at + step) % a.order.length];
      if (!a.out.includes(id) && this.living().includes(id)) {
        a.at = a.order.indexOf(id);
        return id;
      }
    }
    return null;
  }

  auctionWho() {
    const a = this.auction;
    if (!a) return null;
    const id = a.order[a.at];
    return (id && !a.out.includes(id)) ? id : null;
  }

  bid(userId, amount) {
    const a = this.auction;
    if (!a || this.step !== 'auction') return { ok: false, message: 'Aucune enchère en cours.' };
    if (this.auctionWho() !== userId) return { ok: false, message: 'Ce n’est pas à toi d’enchérir.' };
    if (a.out.includes(userId)) return { ok: false, message: 'Tu as passé.' };

    const n = Math.floor(Number(amount) || 0);
    if (n <= a.high) return { ok: false, message: `Il faut dépasser ${a.high}.` };
    if (n > this.cash(userId)) return { ok: false, message: `Tu n’as que ${this.cash(userId)}.` };

    a.high = n;
    a.bidder = userId;
    this.note(`${this.nameOf(userId)} enchérit à ${n}.`);

    if (!this.auctionNext()) return this.closeAuction();
    this.armTimer();
    this.broadcast();
    return { ok: true };
  }

  passBid(userId) {
    const a = this.auction;
    if (!a || this.step !== 'auction') return { ok: false, message: 'Aucune enchère en cours.' };
    if (this.auctionWho() !== userId) return { ok: false, message: 'Ce n’est pas à toi d’enchérir.' };
    a.out.push(userId);
    this.note(`${this.nameOf(userId)} passe.`);

    if (!this.auctionNext()) return this.closeAuction();
    this.armTimer();
    this.broadcast();
    return { ok: true };
  }

  closeAuction() {
    const a = this.auction;
    if (!a) return { ok: true };
    const cell = B.BOARD[a.cell];

    if (a.bidder && a.high > 0 && this.cash(a.bidder) >= a.high) {
      this.money.set(a.bidder, this.cash(a.bidder) - a.high);
      this.cells[a.cell].ownerId = a.bidder;
      this.note(`${this.nameOf(a.bidder)} emporte ${cell.name} aux enchères pour ${a.high}.`);
    } else {
      // Personne n'a misé : la case reste libre, et le prochain qui tombe
      // dessus pourra l'acheter au prix affiché.
      this.note(`Personne n’a misé : ${cell.name} reste libre.`);
    }

    this.auction = null;
    this.afterLanding(this.currentId());
    return { ok: true };
  }

  /* ─── Construire ───────────────────────────────────────────────────── */

  /**
   * Pourquoi on ne peut pas bâtir ici — la phrase, pas juste le refus.
   * Chaque condition renvoie sa raison ; c'est ce qui apprend les règles.
   */
  whyNotBuild(userId, index) {
    const cell = B.BOARD[index];
    const state = this.cells[index];
    if (!cell || cell.type !== 'terrain') return 'On ne construit que sur les terrains.';
    if (state.ownerId !== userId) return 'Cette case n’est pas à toi.';
    if (!this.hasMonopoly(userId, cell.group)) {
      const list = B.GROUP_CELLS[cell.group];
      const missing = list.filter((i) => this.cells[i].ownerId !== userId).length;
      return `Il te manque ${missing} case${missing > 1 ? 's' : ''} du groupe ${B.GROUPS[cell.group].name.toLowerCase()}.`;
    }
    if (B.GROUP_CELLS[cell.group].some((i) => this.cells[i].mortgaged)) {
      return 'Une case du groupe est hypothéquée : lève l’hypothèque d’abord.';
    }
    if (state.houses >= 5) return 'Il y a déjà un hôtel ici.';

    // Construction uniforme : on ne peut pas poser une deuxième maison ici
    // tant qu'une case du groupe n'en a qu'une.
    const lowest = Math.min(...B.GROUP_CELLS[cell.group].map((i) => this.cells[i].houses));
    if (state.houses > lowest) {
      return 'Construis d’abord sur les autres cases du groupe : les maisons se répartissent.';
    }
    if (state.houses === 4 && this.hotels <= 0) return 'La banque n’a plus d’hôtel.';
    if (state.houses < 4 && this.houses <= 0) return 'La banque n’a plus de maison.';
    if (this.cash(userId) < B.GROUPS[cell.group].house) {
      return `Une maison coûte ${B.GROUPS[cell.group].house} ici, et tu as ${this.cash(userId)}.`;
    }
    return null;
  }

  build(userId, index) {
    if (this.phase !== 'play') return { ok: false, message: 'La partie n’est pas en cours.' };
    const why = this.whyNotBuild(userId, index);
    if (why) return { ok: false, message: why };

    const cell = B.BOARD[index];
    const state = this.cells[index];
    const price = B.GROUPS[cell.group].house;

    this.money.set(userId, this.cash(userId) - price);
    if (state.houses === 4) {
      // Un hôtel rend ses quatre maisons à la banque : c'est ce qui crée
      // la pénurie dont vivent les parties serrées.
      this.hotels -= 1;
      this.houses += 4;
      state.houses = 5;
      this.note(`${this.nameOf(userId)} bâtit un hôtel sur ${cell.name}.`);
    } else {
      this.houses -= 1;
      state.houses += 1;
      this.note(`${this.nameOf(userId)} bâtit une maison sur ${cell.name} (${state.houses}).`);
    }
    this.broadcast();
    return { ok: true };
  }

  sell(userId, index) {
    const cell = B.BOARD[index];
    const state = this.cells[index];
    if (!cell || cell.type !== 'terrain') return { ok: false, message: 'Rien à vendre ici.' };
    if (state.ownerId !== userId) return { ok: false, message: 'Cette case n’est pas à toi.' };
    if (!state.houses) return { ok: false, message: 'Il n’y a rien de bâti ici.' };

    // On démolit aussi uniformément qu'on bâtit.
    const highest = Math.max(...B.GROUP_CELLS[cell.group].map((i) => this.cells[i].houses));
    if (state.houses < highest) {
      return { ok: false, message: 'Démolis d’abord les cases les plus construites du groupe.' };
    }
    if (state.houses === 5 && this.houses < 4) {
      return { ok: false, message: 'La banque n’a pas assez de maisons pour reprendre l’hôtel.' };
    }

    const price = B.GROUPS[cell.group].house;
    if (state.houses === 5) {
      state.houses = 4;
      this.hotels += 1;
      this.houses -= 4;
    } else {
      state.houses -= 1;
      this.houses += 1;
    }
    // Une revente rapporte la moitié : c'est ce qui rend la construction
    // irréversible dans les faits, et donc une vraie décision.
    const back = Math.floor(price / 2);
    this.money.set(userId, this.cash(userId) + back);
    this.note(`${this.nameOf(userId)} revend une construction sur ${cell.name} : +${back}.`);
    this.broadcast();
    return { ok: true };
  }

  /* ─── Hypothèques ──────────────────────────────────────────────────── */

  mortgage(userId, index) {
    const cell = B.BOARD[index];
    const state = this.cells[index];
    if (!cell || !cell.mortgage) return { ok: false, message: 'Cette case ne s’hypothèque pas.' };
    if (state.ownerId !== userId) return { ok: false, message: 'Cette case n’est pas à toi.' };
    if (state.mortgaged) return { ok: false, message: 'Elle est déjà hypothéquée.' };
    if (cell.type === 'terrain' && B.GROUP_CELLS[cell.group].some((i) => this.cells[i].houses > 0)) {
      return { ok: false, message: 'Vends d’abord les constructions du groupe.' };
    }
    state.mortgaged = true;
    this.money.set(userId, this.cash(userId) + cell.mortgage);
    this.note(`${this.nameOf(userId)} hypothèque ${cell.name} : +${cell.mortgage}.`);
    this.broadcast();
    return { ok: true };
  }

  unmortgage(userId, index) {
    const cell = B.BOARD[index];
    const state = this.cells[index];
    if (!cell || !cell.mortgage) return { ok: false, message: 'Cette case ne s’hypothèque pas.' };
    if (state.ownerId !== userId) return { ok: false, message: 'Cette case n’est pas à toi.' };
    if (!state.mortgaged) return { ok: false, message: 'Elle n’est pas hypothéquée.' };
    // Les 10 % d'intérêt ne vont à personne : ils sortent du jeu, comme la
    // commission du marché du site.
    const due = Math.ceil(cell.mortgage * B.UNMORTGAGE_RATE);
    if (this.cash(userId) < due) return { ok: false, message: `Lever l’hypothèque coûte ${due}, et tu as ${this.cash(userId)}.` };
    this.money.set(userId, this.cash(userId) - due);
    state.mortgaged = false;
    this.note(`${this.nameOf(userId)} lève l’hypothèque de ${cell.name} pour ${due}.`);
    this.broadcast();
    return { ok: true };
  }

  /* ─── Prison ───────────────────────────────────────────────────────── */

  payJail(userId) {
    const jail = this.jail.get(userId);
    if (!jail || !jail.in) return { ok: false, message: 'Tu n’es pas en prison.' };
    if (userId !== this.currentId() || this.step !== 'roll') {
      return { ok: false, message: 'Attends ton tour.' };
    }
    if (this.cash(userId) < B.JAIL_FINE) return { ok: false, message: `Il te faut ${B.JAIL_FINE}.` };
    this.money.set(userId, this.cash(userId) - B.JAIL_FINE);
    jail.in = false;
    jail.turns = 0;
    this.note(`${this.nameOf(userId)} paie ${B.JAIL_FINE} et sort de prison.`);
    this.broadcast();
    return { ok: true };
  }

  useFreeCard(userId) {
    const jail = this.jail.get(userId);
    if (!jail || !jail.in) return { ok: false, message: 'Tu n’es pas en prison.' };
    if ((this.freeCards.get(userId) || 0) <= 0) return { ok: false, message: 'Tu n’as pas de carte de sortie.' };
    this.freeCards.set(userId, this.freeCards.get(userId) - 1);
    jail.in = false;
    jail.turns = 0;
    this.note(`${this.nameOf(userId)} utilise sa carte de sortie de prison.`);
    this.broadcast();
    return { ok: true };
  }

  /* ─── Échanges ─────────────────────────────────────────────────────── */

  /**
   * Une offre d'échange.
   *
   * On refuse d'échanger une case dont le groupe porte des constructions :
   * c'est la règle, et elle évite un tas de cas tordus où un joueur se
   * retrouve avec des maisons sur un groupe qu'il ne possède plus.
   */
  offer(userId, { toId, giveCells = [], giveMoney = 0, wantCells = [], wantMoney = 0 } = {}) {
    if (this.phase !== 'play') return { ok: false, message: 'La partie n’est pas en cours.' };
    if (this.trade) return { ok: false, message: 'Une offre est déjà sur la table.' };
    const other = this.playerOf(toId);
    if (!other || other.out || toId === userId) return { ok: false, message: 'Choisis quelqu’un qui joue encore.' };

    const give = giveCells.map(Number);
    const want = wantCells.map(Number);
    const gm = Math.max(0, Math.floor(Number(giveMoney) || 0));
    const wm = Math.max(0, Math.floor(Number(wantMoney) || 0));

    if (!give.length && !want.length && !gm && !wm) return { ok: false, message: 'Une offre vide n’a pas d’intérêt.' };
    if (gm > this.cash(userId)) return { ok: false, message: 'Tu n’as pas cette somme.' };
    if (wm > this.cash(toId)) return { ok: false, message: `${other.name} n’a pas cette somme.` };

    for (const i of give) {
      if (this.cells[i]?.ownerId !== userId) return { ok: false, message: `${B.BOARD[i]?.name || 'Cette case'} n’est pas à toi.` };
      const why = this.whyNotTradeable(i);
      if (why) return { ok: false, message: why };
    }
    for (const i of want) {
      if (this.cells[i]?.ownerId !== toId) return { ok: false, message: `${B.BOARD[i]?.name || 'Cette case'} n’est pas à ${other.name}.` };
      const why = this.whyNotTradeable(i);
      if (why) return { ok: false, message: why };
    }

    this.trade = { fromId: userId, toId, give, giveMoney: gm, want, wantMoney: wm, at: Date.now() };
    this.note(`${this.nameOf(userId)} propose un échange à ${other.name}.`);
    this.broadcast();
    return { ok: true };
  }

  whyNotTradeable(index) {
    const cell = B.BOARD[index];
    if (!cell || !cell.price) return 'Cette case ne s’échange pas.';
    if (cell.type === 'terrain' && B.GROUP_CELLS[cell.group].some((i) => this.cells[i].houses > 0)) {
      return `Il y a des constructions sur le groupe de ${cell.name} : vends-les d’abord.`;
    }
    return null;
  }

  respondTrade(userId, accept) {
    if (!this.trade) return { ok: false, message: 'Aucune offre en cours.' };
    if (this.trade.toId !== userId) return { ok: false, message: 'Cette offre ne t’est pas adressée.' };

    const t = this.trade;
    if (!accept) {
      this.trade = null;
      this.note(`${this.nameOf(userId)} refuse l’échange.`);
      this.broadcast();
      return { ok: true, message: 'Offre refusée.' };
    }

    // On revérifie tout au moment d'accepter : entre-temps, l'un des deux a
    // pu vendre, hypothéquer ou construire.
    if (t.giveMoney > this.cash(t.fromId) || t.wantMoney > this.cash(t.toId)) {
      this.trade = null;
      this.broadcast();
      return { ok: false, message: 'Les comptes ont bougé : l’offre n’est plus valable.' };
    }
    for (const i of t.give) if (this.cells[i].ownerId !== t.fromId || this.whyNotTradeable(i)) {
      this.trade = null; this.broadcast();
      return { ok: false, message: 'Une des cases a changé de main : l’offre n’est plus valable.' };
    }
    for (const i of t.want) if (this.cells[i].ownerId !== t.toId || this.whyNotTradeable(i)) {
      this.trade = null; this.broadcast();
      return { ok: false, message: 'Une des cases a changé de main : l’offre n’est plus valable.' };
    }

    for (const i of t.give) this.cells[i].ownerId = t.toId;
    for (const i of t.want) this.cells[i].ownerId = t.fromId;
    this.money.set(t.fromId, this.cash(t.fromId) - t.giveMoney + t.wantMoney);
    this.money.set(t.toId, this.cash(t.toId) + t.giveMoney - t.wantMoney);

    this.note(`Échange conclu entre ${this.nameOf(t.fromId)} et ${this.nameOf(t.toId)}.`);
    this.trade = null;
    this.broadcast();
    return { ok: true, message: 'Échange conclu.' };
  }

  /* ─── Faillite ─────────────────────────────────────────────────────── */

  /**
   * La faillite.
   *
   * Envers un joueur : tout lui revient, terrains hypothéqués compris, et
   * les constructions sont revendues à la banque au profit du créancier.
   * Envers la banque : les terrains redeviennent libres.
   */
  bankrupt(userId, toId = null) {
    const player = this.playerOf(userId);
    if (!player || player.out) return { ok: false, message: 'Déjà hors jeu.' };
    if (this.debt && this.debt.playerId === userId) toId = this.debt.toId;

    let refund = 0;
    for (let i = 0; i < 40; i++) {
      const s = this.cells[i];
      if (s.ownerId !== userId) continue;
      if (s.houses) {
        const price = B.GROUPS[B.BOARD[i].group].house;
        refund += (s.houses === 5 ? 5 : s.houses) * Math.floor(price / 2);
        if (s.houses === 5) { this.hotels += 1; } else { this.houses += s.houses; }
        s.houses = 0;
      }
      if (toId) {
        s.ownerId = toId;
      } else {
        s.ownerId = null;
        s.mortgaged = false;
      }
    }

    const purse = this.cash(userId) + refund;
    if (toId) this.money.set(toId, this.cash(toId) + purse);
    this.money.set(userId, 0);
    this.freeCards.set(userId, 0);
    player.out = true;
    this.debt = null;
    if (this.trade && (this.trade.fromId === userId || this.trade.toId === userId)) this.trade = null;

    this.note(toId
      ? `${player.name} fait faillite — tout revient à ${this.nameOf(toId)}.`
      : `${player.name} fait faillite — ses terrains repartent à la banque.`);

    const left = this.living();
    if (left.length <= 1) return this.finish('faillite');

    // Le débiteur est toujours celui dont c'est le tour : on passe au
    // suivant. (Une carte « anniversaire » ne peut pas ruiner un tiers :
    // elle est plafonnée à ce que chacun a en poche.)
    if (this.currentId() === userId) this.nextTurn();
    else { this.step = 'end'; this.broadcast(); }
    return { ok: true };
  }

  /* ─── Fin de tour, fin de partie ───────────────────────────────────── */

  endTurn(userId, { auto = false } = {}) {
    if (this.phase !== 'play') return { ok: false, message: 'La partie n’est pas en cours.' };
    if (userId !== this.currentId()) return { ok: false, message: 'Ce n’est pas ton tour.' };
    if (this.step === 'debt') return { ok: false, message: 'Règle d’abord ta dette.' };
    if (this.step === 'decide') return { ok: false, message: 'Achète cette case ou laisse-la.' };
    if (this.step === 'roll' && !auto) return { ok: false, message: 'Lance les dés d’abord.' };
    this.nextTurn();
    return { ok: true };
  }

  nextTurn() {
    const alive = this.living();
    if (alive.length <= 1) return this.finish('faillite');

    // On avance dans l'ordre en sautant ceux qui sont sortis, et on compte
    // un tour de table à chaque fois qu'on repasse par le premier joueur
    // encore en lice.
    const before = this.turn;
    let guard = 0;
    do {
      this.turn = (this.turn + 1) % this.order.length;
      guard += 1;
    } while (guard < 50 && !alive.includes(this.currentId()));

    if (this.turn <= before) {
      this.laps += 1;
      if (this.lapsTarget && this.laps >= this.lapsTarget) return this.finish('tours');
    }
    this.beginTurn();
  }

  /** La fortune d'un joueur : argent, terrains et constructions. */
  worth(id) {
    let total = this.cash(id);
    for (let i = 0; i < 40; i++) {
      const s = this.cells[i];
      if (s.ownerId !== id) continue;
      const cell = B.BOARD[i];
      // Une case hypothéquée ne vaut plus que sa valeur d'hypothèque :
      // sinon on serait riche en empruntant.
      total += s.mortgaged ? cell.mortgage : cell.price;
      if (s.houses) total += (s.houses === 5 ? 5 : s.houses) * B.GROUPS[cell.group].house;
    }
    return total;
  }

  finish(reason = 'tours') {
    clearTimeout(this.timer);
    this.phase = 'over';

    const table = this.seating()
      .map((id) => ({
        id,
        name: this.nameOf(id),
        out: Boolean(this.playerOf(id) && this.playerOf(id).out),
        money: this.cash(id),
        worth: this.worth(id),
      }))
      .sort((a, b) => Number(a.out) - Number(b.out) || b.worth - a.worth);

    const inPlay = table.filter((t) => !t.out);
    const best = inPlay.length ? inPlay[0].worth : 0;
    this.result = {
      table,
      winnerIds: inPlay.filter((t) => t.worth === best).map((t) => t.id),
      laps: this.laps,
      reason,   // 'tours' ou 'faillite'
    };
    this.previousSeed = { serverSeed: this.serverSeed, serverSeedHash: this.serverSeedHash };
    this.note(reason === 'tours'
      ? `Fin des ${this.laps} tours — le plus riche l’emporte.`
      : 'Il ne reste qu’un joueur debout.');
    this.note(`Vainqueur : ${this.result.winnerIds.map((id) => this.nameOf(id)).join(' et ')}.`);
    this.broadcast();
    if (this.onEnd) this.onEnd(this);
    return { ok: true };
  }

  winners() {
    return this.result ? this.result.winnerIds : [];
  }

  /**
   * Pour la soirée : la fortune finale départage. Un joueur ruiné compte
   * zéro même s'il lui restait des hypothèques : il est sorti, c'est tout.
   */
  ranking() {
    if (!this.result) return super.ranking();
    return this.result.table.map((t) => ({ id: t.id, score: t.out ? 0 : t.worth }));
  }

  /* ─── État envoyé au client ────────────────────────────────────────── */

  /**
   * Au Monopoly, tout est public : les fortunes, les propriétés, les
   * constructions. La seule chose cachée est l'ordre des deux paquets de
   * cartes — et le client n'en a pas besoin. On envoie donc presque le
   * même objet à tout le monde ; seul `you` change.
   */
  stateFor(playerId) {
    const base = this.baseState();
    const me = this.playerOf(playerId);
    const currentId = this.currentId();
    const jail = this.jail.get(playerId) || { in: false, turns: 0 };

    const cells = this.cells.map((s, i) => ({
      i,
      ownerId: s.ownerId,
      houses: s.houses,
      mortgaged: s.mortgaged,
      // Le loyer courant, calculé par le serveur : le client n'a aucune
      // règle à connaître, il affiche.
      rent: s.ownerId ? this.rentFor(i, null) : 0,
    }));

    const players = this.seating().map((id) => {
      const p = this.playerOf(id);
      return {
        id,
        name: p ? p.name : '—',
        avatar: p ? p.avatar : null,
        cosmetics: p ? p.cosmetics : null,
        connected: p ? p.connected : false,
        out: Boolean(p && p.out),
        token: this.tokens.get(id) || '•',
        money: this.cash(id),
        worth: this.worth(id),
        pos: this.pos.get(id) ?? 0,
        jail: (this.jail.get(id) || {}).in === true,
        freeCards: this.freeCards.get(id) || 0,
        cells: this.cells.reduce((acc, s, i) => (s.ownerId === id ? [...acc, i] : acc), []),
        current: id === currentId,
        you: id === playerId,
      };
    });

    // Ce que CE joueur peut faire, décidé par le serveur.
    const yours = playerId === currentId;
    const buildable = [];
    if (me && !me.out && this.phase === 'play') {
      for (let i = 0; i < 40; i++) {
        if (this.cells[i].ownerId !== playerId) continue;
        if (!this.whyNotBuild(playerId, i)) buildable.push(i);
      }
    }

    return {
      ...base,
      board: B.BOARD,
      groups: B.GROUPS,
      cells,
      players,
      currentId,
      step: this.step,
      dice: this.dice,
      doubles: this.doubles,
      card: this.card,
      laps: this.laps,
      lapsTarget: this.lapsTarget,
      doubleGo: this.doubleGo,
      stock: { houses: this.houses, hotels: this.hotels },
      deadline: this.deadline,
      serverNow: Date.now(),
      buy: this.step === 'decide' && yours ? this.pendingBuy : null,
      auctions: this.auctions,
      auction: this.auction ? {
        cell: this.auction.cell,
        name: B.BOARD[this.auction.cell].name,
        price: B.BOARD[this.auction.cell].price,
        high: this.auction.high,
        bidder: this.auction.bidder,
        bidderName: this.auction.bidder ? this.nameOf(this.auction.bidder) : null,
        who: this.auctionWho(),
        whoName: this.auctionWho() ? this.nameOf(this.auctionWho()) : null,
        mine: this.auctionWho() === playerId,
        out: this.auction.out,
      } : null,
      debt: this.debt && this.debt.playerId === playerId
        ? { ...this.debt, toName: this.debt.toId ? this.nameOf(this.debt.toId) : 'la banque' }
        : (this.debt ? { playerId: this.debt.playerId, waiting: true, name: this.nameOf(this.debt.playerId) } : null),
      trade: this.trade
        ? { ...this.trade, fromName: this.nameOf(this.trade.fromId), toName: this.nameOf(this.trade.toId), mine: this.trade.toId === playerId }
        : null,
      you: {
        id: playerId,
        yourTurn: yours,
        jail: jail.in,
        jailTurns: jail.turns,
        freeCards: this.freeCards.get(playerId) || 0,
        money: this.cash(playerId),
        buildable,
        out: Boolean(me && me.out),
      },
      log: this.log,
      result: this.result,
      fair: { serverSeedHash: this.serverSeedHash, previous: this.previousSeed },
    };
  }

  /**
   * Reprendre après un redémarrage du serveur.
   *
   * Le minuteur repart à zéro : personne ne doit être joué d'office parce
   * qu'un déploiement a mangé son temps de réflexion.
   */
  resume() {
    if (this.phase !== 'play') return;
    this.armTimer();
    this.note('Le serveur a redémarré — la partie reprend où elle en était.');
    this.broadcast();
  }

  broadcast() {
    for (const player of this.players) {
      const state = this.stateFor(player.id);
      for (const socketId of player.sockets) this.io.to(socketId).emit('mono:state', state);
    }
    this.broadcastWatchers('mono:state');
  }

  destroy() {
    clearTimeout(this.timer);
    super.destroy();
  }
}

module.exports = { Monopoly, MIN, MAX, TOKENS, shuffleFrom };
