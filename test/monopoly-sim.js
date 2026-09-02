'use strict';
/**
 * SIMULATEUR DE MONOPOLY.
 *
 * Pas de serveur, pas de navigateur : on instancie le moteur, on joue des
 * milliers de tours au hasard, et après CHAQUE action on vérifie que le jeu
 * tient debout. Un Monopoly qui se déséquilibre ne le montre pas tout de
 * suite — il faut deux heures de partie pour s'apercevoir qu'une maison
 * s'est évaporée. Une machine s'en aperçoit en trois secondes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES QUATRE INVARIANTS
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  1. LE STOCK DE LA BANQUE EST CONSTANT.
 *     32 maisons et 12 hôtels, toujours. Ce qui est sur le plateau plus ce
 *     qui reste à la banque doit faire exactement ça, à chaque instant. Un
 *     hôtel qui « oublie » de rendre ses quatre maisons casse la pénurie,
 *     qui est une des mécaniques les plus fines du jeu.
 *
 *  2. AUCUN COMPTE N'EST NÉGATIF.
 *     C'est la traduction de « on ne peut pas devoir de l'argent et
 *     continuer à jouer ». Si un solde passe sous zéro, c'est qu'un
 *     paiement a contourné la phase de dette.
 *
 *  3. CHAQUE CASE A AU PLUS UN PROPRIÉTAIRE, ET IL JOUE ENCORE.
 *     Une case qui appartient à un joueur en faillite, c'est un loyer
 *     versé à un fantôme.
 *
 *  4. LES CONSTRUCTIONS SONT LÉGALES.
 *     Rien de bâti hors d'un monopole, rien sur un groupe hypothéqué,
 *     jamais plus d'une maison d'écart à l'intérieur d'un groupe, et
 *     jamais de maison sur une gare ou un service.
 *
 * On vérifie en plus, à part, que les BARÈMES DE LOYER sont ceux du jeu :
 * un tableau recopié à la main est l'endroit le plus probable d'une faute
 * de frappe, et personne ne la verrait jamais en jouant.
 */

const { Monopoly } = require('../server/party/monopoly');
const B = require('../server/party/board');

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

/* ═══════════ Un salon factice ═══════════ */

/** Le moteur ne parle au monde extérieur que par `io` : on l'assourdit. */
const io = { to: () => ({ emit: () => {} }) };

function table(names) {
  const game = new Monopoly(io);
  names.forEach((name, i) => {
    game.join({ id: `j${i}`, name, avatar: null }, {}, `s${i}`);
  });
  return game;
}

/* ═══════════ Les invariants ═══════════ */

function invariants(game, where) {
  const errs = [];

  /* 1 — le stock de la banque */
  let houses = 0;
  let hotels = 0;
  for (let i = 0; i < 40; i++) {
    const s = game.cells[i];
    if (s.houses === 5) hotels += 1;
    else houses += s.houses;
  }
  if (houses + game.houses !== B.HOUSES) {
    errs.push(`maisons : ${houses} posées + ${game.houses} en banque = ${houses + game.houses} au lieu de ${B.HOUSES}`);
  }
  if (hotels + game.hotels !== B.HOTELS) {
    errs.push(`hôtels : ${hotels} posés + ${game.hotels} en banque = ${hotels + game.hotels} au lieu de ${B.HOTELS}`);
  }

  /* 2 — aucun compte négatif */
  for (const id of game.order) {
    if (game.cash(id) < 0) errs.push(`${game.nameOf(id)} est à ${game.cash(id)}`);
  }

  /* 3 — les propriétaires existent et jouent encore */
  for (let i = 0; i < 40; i++) {
    const owner = game.cells[i].ownerId;
    if (!owner) continue;
    const p = game.playerOf(owner);
    if (!p) errs.push(`${B.BOARD[i].name} appartient à un inconnu`);
    else if (p.out) errs.push(`${B.BOARD[i].name} appartient à ${p.name}, en faillite`);
    if (!B.BOARD[i].price) errs.push(`${B.BOARD[i].name} ne devrait appartenir à personne`);
  }

  /* 4 — les constructions sont légales */
  for (let i = 0; i < 40; i++) {
    const s = game.cells[i];
    if (!s.houses) continue;
    const cell = B.BOARD[i];
    if (cell.type !== 'terrain') { errs.push(`construction sur ${cell.name}`); continue; }
    if (!game.hasMonopoly(s.ownerId, cell.group)) {
      errs.push(`${cell.name} construite sans le groupe complet`);
    }
    const group = B.GROUP_CELLS[cell.group];
    if (group.some((k) => game.cells[k].mortgaged)) {
      errs.push(`${cell.name} construite sur un groupe hypothéqué`);
    }
    const hs = group.map((k) => game.cells[k].houses);
    if (Math.max(...hs) - Math.min(...hs) > 1) {
      errs.push(`groupe ${cell.group} bâti de travers : ${hs.join('/')}`);
    }
  }

  if (errs.length) {
    console.log(`  ✗ invariant rompu (${where}) : ${errs[0]}`);
    failures++;
    return false;
  }
  return true;
}

/* ═══════════ Une partie jouée au hasard ═══════════ */

/**
 * Un joueur automatique volontairement bête mais complet : il achète dès
 * qu'il peut, construit dès qu'il peut, hypothèque quand il doit, et se
 * déclare en faillite en dernier recours. Ce n'est pas une stratégie, et
 * ce n'est pas le but : le but est de passer par TOUS les chemins de code.
 */
function playOne(seed, { verbose = false } = {}) {
  const game = table(['Alice', 'Bruno', 'Chloé', 'David']);
  game.configure('j0', { laps: 60 });
  game.start('j0');
  if (!invariants(game, 'départ')) return null;

  let actions = 0;
  const seen = new Set();
  let rng = seed;
  const rand = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  };

  while (game.phase === 'play' && actions < 20000) {
    actions += 1;
    const id = game.currentId();
    if (!id) break;
    seen.add(game.step);

    if (game.step === 'debt') {
      const owed = game.debt.amount;
      const who = game.debt.playerId;
      // On vend, puis on hypothèque, jusqu'à pouvoir payer.
      let progress = true;
      while (game.cash(who) < owed && progress) {
        progress = false;
        for (let i = 0; i < 40 && game.cash(who) < owed; i++) {
          if (game.cells[i].ownerId !== who || !game.cells[i].houses) continue;
          if (game.sell(who, i).ok) progress = true;
        }
        for (let i = 0; i < 40 && game.cash(who) < owed; i++) {
          if (game.cells[i].ownerId !== who || game.cells[i].mortgaged) continue;
          if (game.mortgage(who, i).ok) progress = true;
        }
      }
      if (game.cash(who) >= owed) game.pay(who);
      else game.bankrupt(who);
      if (!invariants(game, 'dette')) return null;
      continue;
    }

    if (game.step === 'roll') {
      const jail = game.jail.get(id);
      if (jail.in && game.freeCards.get(id) > 0 && rand() < 0.6) game.useFreeCard(id);
      else if (jail.in && game.cash(id) > 400 && rand() < 0.4) game.payJail(id);
      game.roll(id);
      if (!invariants(game, 'lancer')) return null;
      continue;
    }

    if (game.step === 'decide') {
      // On achète presque toujours : c'est ce qui fait tourner la partie.
      if (rand() < 0.85) {
        const r = game.buy(id);
        if (!r.ok) game.pass(id);
      } else game.pass(id);
      if (!invariants(game, 'achat')) return null;
      continue;
    }

    if (game.step === 'end') {
      // On construit tant qu'on peut, une case au hasard à chaque fois.
      for (let k = 0; k < 6; k++) {
        const list = [];
        for (let i = 0; i < 40; i++) if (!game.whyNotBuild(id, i)) list.push(i);
        if (!list.length) break;
        const pick = list[Math.floor(rand() * list.length)];
        // On garde toujours de quoi payer un loyer : sinon on construit et
        // on fait faillite au tour suivant, ce qui est amusant mais court.
        if (game.cash(id) < 400) break;
        if (!game.build(id, pick).ok) break;
      }
      // De temps en temps, on lève une hypothèque.
      if (rand() < 0.15) {
        for (let i = 0; i < 40; i++) {
          if (game.cells[i].ownerId === id && game.cells[i].mortgaged) { game.unmortgage(id, i); break; }
        }
      }
      // Et de temps en temps, on propose un échange.
      if (rand() < 0.05) tryTrade(game, id, rand);
      if (!invariants(game, 'gestion')) return null;
      game.endTurn(id);
      if (!invariants(game, 'fin de tour')) return null;
      continue;
    }

    break;
  }

  if (verbose) console.log(`    ${actions} actions, ${game.laps} tours, fin par ${game.result && game.result.reason}`);
  return { game, actions, seen };
}

/** Une offre plausible : une case contre une autre, plus un peu d'argent. */
function tryTrade(game, id, rand) {
  const mine = [];
  for (let i = 0; i < 40; i++) if (game.cells[i].ownerId === id && !game.whyNotTradeable(i)) mine.push(i);
  if (!mine.length) return;
  const others = game.living().filter((x) => x !== id);
  if (!others.length) return;
  const toId = others[Math.floor(rand() * others.length)];
  const theirs = [];
  for (let i = 0; i < 40; i++) if (game.cells[i].ownerId === toId && !game.whyNotTradeable(i)) theirs.push(i);
  if (!theirs.length) return;

  const give = mine[Math.floor(rand() * mine.length)];
  const want = theirs[Math.floor(rand() * theirs.length)];
  const cash = Math.min(100, game.cash(id));
  const r = game.offer(id, { toId, giveCells: [give], giveMoney: cash, wantCells: [want] });
  if (r.ok) game.respondTrade(toId, rand() < 0.5);
}

/* ═══════════ Le banc d'essai ═══════════ */

(function main() {
  console.log('Simulateur de Monopoly — le plateau français\n');

  /* ── LE PLATEAU ── */
  section('Le plateau');
  check('quarante cases', B.BOARD.length === 40, `${B.BOARD.length}`);
  check('vingt-deux terrains',
    B.BOARD.filter((c) => c.type === 'terrain').length === 22,
    `${B.BOARD.filter((c) => c.type === 'terrain').length}`);
  check('quatre gares', B.GARES.length === 4, B.GARES.join(', '));
  check('deux services', B.SERVICES.length === 2, B.SERVICES.join(', '));
  check('huit groupes de couleur', Object.keys(B.GROUP_CELLS).length === 8);
  check('deux groupes de deux, six de trois',
    Object.values(B.GROUP_CELLS).filter((g) => g.length === 2).length === 2
    && Object.values(B.GROUP_CELLS).filter((g) => g.length === 3).length === 6);
  check('trois Chance et trois Caisse commune',
    B.BOARD.filter((c) => c.type === 'chance').length === 3
    && B.BOARD.filter((c) => c.type === 'caisse').length === 3);
  check('les quatre coins sont aux bons index',
    B.BOARD[0].type === 'depart' && B.BOARD[10].type === 'prison'
    && B.BOARD[20].type === 'parc' && B.BOARD[30].type === 'go-prison');

  // L'hypothèque vaut toujours la moitié du prix : c'est la règle, et
  // c'est le genre de chiffre qu'on recopie de travers.
  const badMortgage = B.BOARD.filter((c) => c.price && c.mortgage !== c.price / 2);
  check('l’hypothèque vaut la moitié du prix, partout',
    badMortgage.length === 0,
    badMortgage.length ? badMortgage[0].name : '28 cases vérifiées');

  // Les loyers montent : un barème qui redescend est une faute de frappe.
  const badRent = B.BOARD.filter((c) => c.rent
    && c.rent.some((v, i) => i > 0 && v <= c.rent[i - 1]));
  check('les loyers montent avec les constructions',
    badRent.length === 0,
    badRent.length ? badRent[0].name : '22 barèmes vérifiés');

  check('seize cartes Chance et seize Caisse commune',
    B.CHANCE.length === 16 && B.CAISSE.length === 16);
  check('une carte « libéré de prison » dans chaque paquet',
    B.CHANCE.filter((c) => c.do === 'liberte').length === 1
    && B.CAISSE.filter((c) => c.do === 'liberte').length === 1);

  /* ── LES LOYERS ── */
  section('Les loyers');
  {
    const g = table(['A', 'B']);
    g.start('j0');
    // Boulevard de Belleville (1) et rue Lecourbe (3) : le groupe brun.
    g.cells[1].ownerId = 'j0';
    check('terrain nu seul : loyer de base', g.rentFor(1, null) === 2, `${g.rentFor(1, null)}`);
    g.cells[3].ownerId = 'j0';
    check('groupe complet : loyer doublé', g.rentFor(1, null) === 4, `${g.rentFor(1, null)}`);
    g.cells[3].mortgaged = true;
    check('une case hypothéquée annule le doublement', g.rentFor(1, null) === 2, `${g.rentFor(1, null)}`);
    g.cells[3].mortgaged = false;
    g.cells[1].houses = 3;
    check('trois maisons : 90', g.rentFor(1, null) === 90, `${g.rentFor(1, null)}`);
    g.cells[1].houses = 5;
    check('hôtel : 250', g.rentFor(1, null) === 250, `${g.rentFor(1, null)}`);
    g.cells[1].houses = 0;
    check('une case hypothéquée ne rapporte rien',
      (g.cells[1].mortgaged = true, g.rentFor(1, null) === 0));
    g.cells[1].mortgaged = false;

    // Les gares : 25, 50, 100, 200.
    const rents = [];
    B.GARES.forEach((i, n) => {
      g.cells[i].ownerId = 'j0';
      rents.push(g.rentFor(B.GARES[0], null));
      void n;
    });
    check('les gares paient 25, 50, 100, 200', rents.join(',') === '25,50,100,200', rents.join(', '));

    // Les services : quatre fois les dés, dix fois avec les deux.
    g.cells[B.SERVICES[0]].ownerId = 'j0';
    check('un service : quatre fois les dés', g.rentFor(B.SERVICES[0], [3, 4]) === 28, `${g.rentFor(B.SERVICES[0], [3, 4])}`);
    g.cells[B.SERVICES[1]].ownerId = 'j0';
    check('les deux services : dix fois les dés', g.rentFor(B.SERVICES[0], [3, 4]) === 70, `${g.rentFor(B.SERVICES[0], [3, 4])}`);
  }

  /* ── LA CONSTRUCTION ── */
  section('La construction, et pourquoi elle est refusée');
  {
    const g = table(['A', 'B']);
    g.start('j0');
    g.money.set('j0', 10000);

    check('on ne construit pas sur la case d’un autre',
      /pas \u00e0 toi/.test(g.whyNotBuild('j0', 1) || ''), g.whyNotBuild('j0', 1));

    g.cells[1].ownerId = 'j0';
    check('ni sur un groupe incomplet',
      /manque/.test(g.whyNotBuild('j0', 1) || ''), g.whyNotBuild('j0', 1));

    g.cells[3].ownerId = 'j0';
    check('avec le groupe, c’est permis', g.whyNotBuild('j0', 1) === null, String(g.whyNotBuild('j0', 1)));

    g.build('j0', 1);
    check('la maison est posée', g.cells[1].houses === 1);
    check('la banque en a une de moins', g.houses === B.HOUSES - 1, `${g.houses}`);
    check('on ne pose pas la deuxième avant la première d’à côté',
      /répartissent/.test(g.whyNotBuild('j0', 1) || ''), g.whyNotBuild('j0', 1));

    g.build('j0', 3);
    g.build('j0', 1); g.build('j0', 3);
    g.build('j0', 1); g.build('j0', 3);
    g.build('j0', 1); g.build('j0', 3);
    check('quatre maisons chacune', g.cells[1].houses === 4 && g.cells[3].houses === 4);
    g.build('j0', 1);
    check('la cinquième construction est un hôtel', g.cells[1].houses === 5);
    check('l’hôtel rend ses quatre maisons à la banque',
      g.houses === B.HOUSES - 4, `${g.houses} maisons en banque`);
    check('la banque a un hôtel de moins', g.hotels === B.HOTELS - 1, `${g.hotels}`);

    check('on n’hypothèque pas un groupe construit',
      /constructions/.test((g.mortgage('j0', 1).message) || ''), g.mortgage('j0', 1).message);
    check('on n’échange pas un groupe construit',
      /constructions/.test(g.whyNotTradeable(1) || ''), g.whyNotTradeable(1));

    // On démolit, puis on hypothèque.
    while (g.cells[1].houses || g.cells[3].houses) {
      if (!g.sell('j0', 1).ok && !g.sell('j0', 3).ok) break;
    }
    check('tout se démolit', g.cells[1].houses === 0 && g.cells[3].houses === 0);
    check('la banque a récupéré son stock',
      g.houses === B.HOUSES && g.hotels === B.HOTELS, `${g.houses}/${g.hotels}`);

    const before = g.cash('j0');
    g.mortgage('j0', 1);
    check('l’hypothèque rapporte la moitié', g.cash('j0') === before + 30, `+${g.cash('j0') - before}`);
    g.unmortgage('j0', 1);
    check('la levée coûte 10 % de plus', g.cash('j0') === before - 3, `${g.cash('j0') - before}`);
  }

  /* ── LA PRISON ── */
  section('La prison');
  {
    const g = table(['A', 'B']);
    g.start('j0');
    g.pos.set('j0', 30);
    g.land('j0');
    check('la case « allez en prison » y envoie', g.jail.get('j0').in === true);
    check('et place le pion sur la case prison', g.pos.get('j0') === 10, `${g.pos.get('j0')}`);
    const cash = g.cash('j0');
    g.step = 'roll';
    g.turn = g.order.indexOf('j0');
    g.payJail('j0');
    check('payer 50 libère', g.jail.get('j0').in === false && g.cash('j0') === cash - 50);

    g.sendToJail('j0');
    g.freeCards.set('j0', 1);
    g.useFreeCard('j0');
    check('la carte de sortie libère aussi',
      g.jail.get('j0').in === false && g.freeCards.get('j0') === 0);
  }

  /* ── LA DETTE ── */
  section('La dette et la faillite');
  {
    const g = table(['A', 'B']);
    g.start('j0');
    g.money.set('j0', 10);
    g.cells[39].ownerId = 'j1';       // rue de la Paix à l'autre
    g.turn = g.order.indexOf('j0');
    g.pos.set('j0', 39);
    g.dice = [1, 2];
    g.land('j0');
    check('un loyer impayable met en dette', g.step === 'debt', g.step);
    check('la dette dit combien et à qui',
      g.debt && g.debt.amount === 50 && g.debt.toId === 'j1',
      g.debt ? `${g.debt.amount} à ${g.nameOf(g.debt.toId)}` : 'aucune');
    check('personne n’est à découvert', g.cash('j0') === 10, `${g.cash('j0')}`);
    check('on ne peut pas finir son tour en devant',
      g.endTurn('j0').ok === false, g.endTurn('j0').message);

    const richBefore = g.cash('j1');
    g.bankrupt('j0');
    check('la faillite met hors jeu', g.playerOf('j0').out === true);
    check('le créancier récupère la caisse', g.cash('j1') === richBefore + 10, `+${g.cash('j1') - richBefore}`);
    check('la partie s’arrête à un seul survivant', g.phase === 'over', g.phase);
    check('et il est déclaré vainqueur',
      g.result && g.result.winnerIds.length === 1 && g.result.winnerIds[0] === 'j1');
  }

  /* ── LES ÉCHANGES ── */
  section('Les échanges');
  {
    const g = table(['A', 'B']);
    g.start('j0');
    g.cells[1].ownerId = 'j0';
    g.cells[3].ownerId = 'j1';
    const r = g.offer('j0', { toId: 'j1', giveCells: [1], giveMoney: 100, wantCells: [3] });
    check('une offre part', r.ok === true, r.message || '');
    check('elle n’est visible que comme offre en cours', Boolean(g.trade));
    check('l’autre ne peut pas répondre à la place du premier',
      g.respondTrade('j0', true).ok === false);
    g.respondTrade('j1', true);
    check('les cases changent de main',
      g.cells[1].ownerId === 'j1' && g.cells[3].ownerId === 'j0');
    check('et l’argent avec',
      g.cash('j0') === B.START_MONEY - 100 && g.cash('j1') === B.START_MONEY + 100,
      `${g.cash('j0')} / ${g.cash('j1')}`);
    check('l’offre est retirée de la table', g.trade === null);
  }

  /* ── LES PARTIES COMPLÈTES ── */
  section('Des parties entières, jouées au hasard');
  {
    let played = 0;
    let byLaps = 0;
    let byBankrupt = 0;
    let totalActions = 0;
    const steps = new Set();

    for (let seed = 1; seed <= 40; seed++) {
      const out = playOne(seed * 7919);
      if (!out) break;
      played += 1;
      totalActions += out.actions;
      out.seen.forEach((s) => steps.add(s));
      if (out.game.result) {
        if (out.game.result.reason === 'tours') byLaps += 1; else byBankrupt += 1;
      }
    }

    check('quarante parties jouées jusqu’au bout', played === 40, `${played}`);
    check('les invariants tiennent à chaque action', failures === 0 || played === 40,
      `${totalActions} actions vérifiées`);
    check('toutes les phases du tour ont été traversées',
      ['roll', 'decide', 'end', 'debt'].every((s) => steps.has(s)),
      [...steps].join(', '));
    check('la limite de tours termine bien des parties', byLaps > 0, `${byLaps} par les tours`);
    check('et les faillites aussi', byBankrupt > 0, `${byBankrupt} par faillite`);
  }

  /* ── LES DÉS ── */
  section('Les dés');
  {
    const g = table(['A', 'B']);
    g.start('j0');
    const counts = new Array(13).fill(0);
    let doubles = 0;
    for (let i = 0; i < 12000; i++) {
      const [a, b] = g.rollDice();
      if (a < 1 || a > 6 || b < 1 || b > 6) { counts[0] += 1; continue; }
      counts[a + b] += 1;
      if (a === b) doubles += 1;
    }
    check('aucun dé hors de 1–6', counts[0] === 0, `${counts[0]} anomalie(s)`);
    check('le 7 est la somme la plus fréquente',
      counts[7] === Math.max(...counts.slice(2)), `${counts[7]} fois sur 12000`);
    const rate = doubles / 12000;
    check('environ un lancer sur six est un double',
      rate > 0.14 && rate < 0.19, `${(rate * 100).toFixed(1)} %`);
  }

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  process.exit(failures ? 1 : 0);
})();
