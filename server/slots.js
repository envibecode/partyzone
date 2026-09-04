'use strict';
/**
 * LA MACHINE À SOUS — « HORSE HOUSE ».
 *
 * Cinq rouleaux, trois rangées, vingt lignes fixes, dans un ranch. Les
 * symboles qui paient le plus sont quatre chevaux : le cowboy, la princesse,
 * le poulain et l'étalon. Derrière eux, les objets du ranch, puis les
 * cartes à jouer habillées en western.
 *
 * DEUX MÉCANIQUES, ET C'EST TOUT
 * ──────────────────────────────
 * Une machine à sous n'a pas besoin de dix idées. Elle en a besoin de deux,
 * qui se répondent :
 *
 *  1. LE WILD MULTIPLICATEUR. La porte d'écurie ne tombe que sur les
 *     rouleaux 2, 3 et 4, et elle arrive avec un ×2 ou un ×3. Elle remplace
 *     n'importe quel symbole sauf le fer à cheval. Quand plusieurs portes
 *     participent à la même ligne, leurs multiplicateurs S'ADDITIONNENT —
 *     ×2 et ×3 sur la même ligne font ×5, pas ×6. C'est ce qui rend une
 *     ligne moyenne soudainement intéressante.
 *
 *  2. LES TOURS OFFERTS. Trois fers à cheval — un sur le rouleau 1, un sur
 *     le 3, un sur le 5 — ouvrent dix tours. Pendant ces tours, chaque
 *     porte d'écurie qui tombe RESTE EN PLACE jusqu'à la fin, multiplicateur
 *     compris. Les tours s'enchaînent donc sur une grille qui se remplit :
 *     les premiers ne valent rien, les derniers valent le voyage. Trois
 *     nouveaux fers à cheval rajoutent dix tours, autant de fois qu'il le
 *     faut.
 *
 * C'est là toute la tension du jeu, et elle vient d'une seule chose : le
 * bonus s'améliore tout seul au fur et à mesure qu'il se déroule.
 *
 * CE QU'ON NE FAIT PAS
 * ────────────────────
 * Le résultat vient de la graine publiée d'avance, comme partout ailleurs
 * sur le site. Les rouleaux ne sont pas « ajustés » selon ce qu'on a misé,
 * ni selon ce qu'on a gagné avant.
 *
 * Et le taux de redistribution n'est pas une promesse marketing : il est
 * MESURÉ au démarrage sur des centaines de milliers de tours simulés,
 * tours offerts et multiplicateurs compris, et c'est ce chiffre-là qui
 * s'affiche à l'écran.
 */

const fair = require('./fair');

const REELS = 5;
const ROWS = 3;

const MIN_BET = 10;        // par ligne  →  200 pièces la mise totale
const MAX_BET = 1000;      // par ligne  →  20 000 pièces la mise totale
const LINES = 20;

/**
 * LE PLAFOND DE GAIN.
 *
 * Toute machine du marché en a un, et pour une bonne raison : la queue de
 * distribution d'un bonus à portes collantes est très longue. Sans plafond,
 * un tour sur quelques millions peut créer plus de pièces que le site n'en
 * détruit en un mois — et sur un site où les pièces ne s'achètent pas,
 * c'est toute l'économie qui bascule d'un coup.
 *
 * Deux mille cinq cents fois la mise totale, bonus compris. Le gain observé
 * le plus élevé sur nos simulations tourne autour de deux mille fois : le
 * plafond ne rogne donc quasiment jamais rien, il empêche seulement le cas
 * extrême. Il est annoncé à l'écran, pas caché.
 */
const MAX_WIN_X = 2500;

/* ─── Les symboles ─────────────────────────────────────── */

/**
 * `pay` : ce que rapportent 3, 4 et 5 symboles alignés, en multiples de la
 * mise PAR LIGNE. `weight` : la fréquence sur les rouleaux ordinaires.
 *
 * Les cinq cartes partagent le même barème : c'est le fond du jeu, celui
 * qu'on voit tomber sans y penser.
 *
 * Les poids sont exprimés au dixième près (un ruban de ~2500 cases plutôt
 * que 250) parce que la porte d'écurie est un levier très raide : une seule
 * case de plus sur le ruban déplaçait la redistribution de dix points. À
 * cette échelle-là, on la règle au dixième de point.
 */
/*
 * LE BARÈME.
 *
 * Les proportions viennent du document d'origine — le cowboy vaut dix fois
 * la carte la plus basse, la princesse un cran en dessous, et ainsi de
 * suite. Les VALEURS, elles, ont été recalibrées pour l'économie du site :
 * ici les pièces ne s'achètent pas, elles se gagnent, et une machine calée
 * sur les chiffres d'un vrai casino créerait en un gros gain plus de pièces
 * que le site n'en détruit en une semaine.
 *
 * Le facteur est le même pour tous les symboles : la hiérarchie du document
 * est intacte, seule l'échelle a changé. Cinq cowboys valent 350 fois la
 * mise d'une ligne, soit 17,5 fois la mise totale.
 */
const SYMBOLS = [
  { id: 'cowboy',    name: 'Cheval cowboy',     tier: 'high', weight: 70,  pay: [14, 70, 350] },
  { id: 'princess',  name: 'Jument princesse',  tier: 'high', weight: 90,  pay: [10, 55, 280] },
  { id: 'foal',      name: 'Poulain farceur',   tier: 'high', weight: 110, pay: [7, 42, 210] },
  { id: 'stallion',  name: 'Étalon musclé',     tier: 'high', weight: 130, pay: [7, 35, 175] },
  { id: 'hay',       name: 'Botte de foin',     tier: 'mid',  weight: 170, pay: [5.5, 21, 105] },
  { id: 'shoe',      name: 'Fer à cheval doré', tier: 'mid',  weight: 190, pay: [4, 17, 84] },
  { id: 'oats',      name: 'Seau d’avoine',     tier: 'mid',  weight: 210, pay: [3.5, 14, 70] },
  { id: 'A',         name: 'As',                tier: 'low',  weight: 300, pay: [2, 10, 35] },
  { id: 'K',         name: 'Roi',               tier: 'low',  weight: 310, pay: [2, 10, 35] },
  { id: 'Q',         name: 'Dame',              tier: 'low',  weight: 320, pay: [2, 10, 35] },
  { id: 'J',         name: 'Valet',             tier: 'low',  weight: 330, pay: [2, 10, 35] },
  { id: '10',        name: 'Dix',               tier: 'low',  weight: 340, pay: [2, 10, 35] },
];

/**
 * La porte d'écurie. Elle ne paie rien toute seule : elle remplace.
 * Elle ne tombe que sur les rouleaux du milieu, ce qui garantit qu'une
 * ligne entièrement composée de wilds est impossible — et évite d'avoir à
 * inventer un barème pour un cas qui n'arrive jamais.
 */
const WILD = { id: 'wild', name: 'Porte d’écurie', weight: 135, wild: true };
const WILD_REELS = [1, 2, 3];          // rouleaux 2, 3 et 4, comptés à partir de zéro
const WILD_MULTIPLIERS = [2, 3];
const WILD_X3_CHANCE = 0.34;           // un tiers des portes arrivent en ×3

/**
 * Le fer à cheval porte-bonheur. Il ne paie rien non plus — il ouvre les
 * tours offerts, et c'est bien assez.
 */
const SCATTER = { id: 'scatter', name: 'Fer à cheval porte-bonheur', weight: 220, scatter: true };
const SCATTER_REELS = [0, 2, 4];       // rouleaux 1, 3 et 5

const ALL = [...SYMBOLS, WILD, SCATTER];
const BY_ID = new Map(ALL.map((s) => [s.id, s]));

/**
 * UN RUBAN PAR ROULEAU.
 *
 * Le wild et le fer à cheval n'existent pas sur tous les rouleaux : il faut
 * donc cinq rubans, et pas un seul partagé. C'est aussi ce qui permet de
 * durcir légèrement les rouleaux 1 et 5 sur les gros symboles, comme le
 * fait n'importe quelle machine du marché — sans quoi les cinq-de-suite
 * tomberaient bien trop souvent.
 */
const STRIPS = [];
for (let reel = 0; reel < REELS; reel++) {
  const strip = [];
  for (const s of SYMBOLS) {
    // Les rouleaux du bord sont un peu plus avares en gros symboles : c'est
    // là que se joue la fréquence des lignes de cinq.
    const edge = (reel === 0 || reel === REELS - 1) && s.tier === 'high';
    const n = edge ? Math.round(s.weight * 0.7) : s.weight;
    for (let i = 0; i < n; i++) strip.push(s.id);
  }
  if (WILD_REELS.includes(reel)) {
    for (let i = 0; i < WILD.weight; i++) strip.push(WILD.id);
  }
  if (SCATTER_REELS.includes(reel)) {
    for (let i = 0; i < SCATTER.weight; i++) strip.push(SCATTER.id);
  }
  STRIPS.push(strip);
}

/* ─── Les lignes de paiement ───────────────────────────── */

/**
 * Vingt lignes fixes, décrites par la rangée touchée sur chaque rouleau.
 * L'ordre compte : les premières sont les plus lisibles, et c'est celles-là
 * qu'on met en avant quand on explique le jeu.
 */
const PAYLINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 0, 0],
  [2, 2, 1, 2, 2],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 2],
  [2, 1, 1, 1, 0],
  [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [1, 0, 1, 0, 1],
  [1, 2, 1, 2, 1],
  [0, 0, 2, 0, 0],
  [2, 2, 0, 2, 2],
  [0, 2, 0, 2, 0],
];

/* ─── Les tours offerts ────────────────────────────────── */

const FREE_SPINS = 10;
const RETRIGGER_SPINS = 10;
const MAX_FREE_SPINS = 200;   // garde-fou : un retrigger illimité doit quand même finir

/* ─── Tirage ───────────────────────────────────────────── */

/**
 * Une grille de 5 × 3 à partir de nombres déjà fournis.
 *
 * Chaque case porte son identifiant de symbole et, pour une porte
 * d'écurie, son multiplicateur. On tire le multiplicateur du même flux de
 * nombres que le reste : il est donc vérifiable comme tout le reste.
 */
function drawGrid(values) {
  const grid = [];
  let cursor = REELS * ROWS;
  for (let reel = 0; reel < REELS; reel++) {
    const column = [];
    const strip = STRIPS[reel];
    for (let row = 0; row < ROWS; row++) {
      const v = values[reel * ROWS + row];
      const id = strip[Math.min(strip.length - 1, Math.floor(v * strip.length))];
      const cell = { id };
      if (id === WILD.id) {
        const m = values[cursor++];
        cell.mult = (m === undefined ? 0.5 : m) < WILD_X3_CHANCE
          ? WILD_MULTIPLIERS[1] : WILD_MULTIPLIERS[0];
      }
      column.push(cell);
    }
    grid.push(column);
  }
  return grid;
}

/** Combien de nombres il faut tirer pour une grille : la grille, plus de quoi
 *  donner un multiplicateur à chaque porte d'écurie possible. */
const DRAW_SIZE = REELS * ROWS + WILD_REELS.length * ROWS;

/* ─── Évaluation ───────────────────────────────────────── */

/**
 * Évalue une grille.
 *
 * Les lignes se lisent de gauche à droite : il faut au moins trois symboles
 * identiques d'affilée en partant du premier rouleau. La porte d'écurie
 * remplace n'importe quoi sauf le fer à cheval.
 *
 * LES MULTIPLICATEURS S'ADDITIONNENT, ILS NE SE MULTIPLIENT PAS. Deux
 * portes ×2 et ×3 sur la même ligne donnent ×5. C'est la règle du document
 * d'origine, et c'est aussi la plus lisible pour le joueur : il lui suffit
 * d'additionner ce qu'il voit.
 */
function evaluate(grid, perLine) {
  const wins = [];
  let total = 0;

  PAYLINES.forEach((line, index) => {
    const cells = line.map((row, reel) => grid[reel][row]);

    // Le symbole de référence : le premier qui n'est ni une porte ni un fer.
    let ref = null;
    for (const cell of cells) {
      if (cell.id === SCATTER.id) break;
      if (cell.id !== WILD.id) { ref = cell.id; break; }
    }
    if (!ref) return;   // une ligne qui commence par des portes puis un fer

    let run = 0;
    let mult = 0;
    for (const cell of cells) {
      if (cell.id === ref) { run++; continue; }
      if (cell.id === WILD.id) { run++; mult += cell.mult || 0; continue; }
      break;
    }
    if (run < 3) return;

    const symbol = BY_ID.get(ref);
    if (!symbol || !symbol.pay) return;

    const base = perLine * symbol.pay[run - 3];
    const gain = Math.round(base * (mult || 1));
    if (gain <= 0) return;

    total += gain;
    wins.push({
      line: index,
      rows: line.slice(0, run),
      symbol: ref,
      name: symbol.name,
      count: run,
      mult: mult || 1,
      base: Math.round(base),
      gain,
    });
  });

  /*
   * Les fers à cheval. Ils ne paient pas : ils ouvrent.
   *
   * On exige un fer sur CHACUN des rouleaux 1, 3 et 5, et pas simplement
   * trois fers quelque part. Sans ça, deux fers empilés sur le rouleau 1 et
   * un sur le 3 déclencheraient le bonus — ce qui n'est pas ce que promet
   * l'écran, et un joueur qui compte ses fers en travers de la grille a
   * raison de crier au scandale.
   */
  const scatters = [];
  grid.forEach((column, reel) => {
    column.forEach((cell, row) => {
      if (cell.id === SCATTER.id) scatters.push({ reel, row });
    });
  });
  const reelsHit = new Set(scatters.map((s) => s.reel));
  const trigger = SCATTER_REELS.every((r) => reelsHit.has(r));

  return { wins, total, scatters, trigger };
}

/* ─── Un tour ──────────────────────────────────────────── */

function spinOnce(profile, perLine, sticky = null) {
  const { nonce, values } = fair.draw(profile.fair, DRAW_SIZE);
  const grid = drawGrid(values);
  if (sticky) applySticky(grid, sticky);
  return { nonce, grid, ...evaluate(grid, perLine) };
}

/**
 * Les portes collantes des tours offerts.
 *
 * `sticky` est une carte « rouleau,rangée → multiplicateur ». On écrase la
 * case tirée : une porte posée reste posée, et le symbole qui serait tombé
 * là n'existe simplement pas. C'est ce qui fait que la grille se remplit au
 * fil du bonus.
 */
function applySticky(grid, sticky) {
  for (const [key, mult] of sticky) {
    const [reel, row] = key.split(',').map(Number);
    grid[reel][row] = { id: WILD.id, mult, sticky: true };
  }
}

/** Ajoute à la mémoire collante les portes tombées pendant ce tour. */
function collectSticky(grid, sticky) {
  grid.forEach((column, reel) => {
    column.forEach((cell, row) => {
      if (cell.id !== WILD.id) return;
      const key = `${reel},${row}`;
      if (!sticky.has(key)) sticky.set(key, cell.mult || WILD_MULTIPLIERS[0]);
    });
  });
}

function play(profile, { bet } = {}) {
  const perLine = Math.floor(Number(bet) || 0);
  if (!Number.isFinite(perLine) || perLine < MIN_BET) {
    return { ok: false, message: `Mise minimum : ${MIN_BET} pièces par ligne.` };
  }
  if (perLine > MAX_BET) return { ok: false, message: `Mise maximum : ${MAX_BET} pièces par ligne.` };

  const staked = perLine * LINES;
  if (profile.vault.coins < staked) {
    return { ok: false, message: `Il te manque ${staked - profile.vault.coins} pièces.` };
  }

  profile.vault.coins -= staked;

  const main = spinOnce(profile, perLine);
  let payout = main.total;

  /*
   * LE BONUS SE JOUE ICI, CÔTÉ SERVEUR, EN ENTIER.
   *
   * L'écran le rejoue ensuite tour par tour, mais il ne décide de rien : le
   * résultat est déjà écrit quand la réponse part. Un navigateur bricolé ne
   * peut donc pas s'offrir un tour de plus, et une déconnexion au milieu du
   * bonus ne fait perdre que l'animation.
   */
  const free = [];
  let extra = 0;
  if (main.trigger) {
    const sticky = new Map();
    let remaining = FREE_SPINS;
    let played = 0;

    while (remaining > 0 && played < MAX_FREE_SPINS) {
      remaining -= 1;
      played += 1;

      const round = spinOnce(profile, perLine, sticky);
      // Les portes tombées ce tour-ci restent pour les suivants. On les
      // ramasse APRÈS l'évaluation : elles paient déjà ce tour-ci.
      collectSticky(round.grid, sticky);

      let added = 0;
      if (round.trigger && played < MAX_FREE_SPINS) {
        added = RETRIGGER_SPINS;
        remaining += added;
        extra += added;
      }

      payout += round.total;
      free.push({ ...round, index: played, added, left: remaining });
    }
  }

  // Le plafond, appliqué à la manche entière — tour de base et tours
  // offerts réunis. On le signale au joueur plutôt que de rogner en
  // silence : un gain amputé sans explication passerait pour un bug.
  const uncapped = payout;
  const cap = staked * MAX_WIN_X;
  const capped = payout > cap;
  if (capped) payout = cap;

  profile.vault.coins += payout;

  return {
    ok: true,
    perLine,
    lines: LINES,
    staked,
    payout,
    capped,
    uncapped,
    profit: payout - staked,
    spin: main,
    free,
    freeSpins: free.length,
    extraSpins: extra,
    coins: profile.vault.coins,
  };
}

/* ─── Redistribution ───────────────────────────────────── */

/**
 * LE JEU DE BASE SE CALCULE. IL N'A PAS BESOIN D'ÊTRE SIMULÉ.
 *
 * Chaque case de la grille est un tirage indépendant dans le ruban de son
 * rouleau — c'est exactement ce que fait `drawGrid`. L'espérance d'une
 * ligne se calcule donc exactement, sans tirer un seul nombre au hasard :
 *
 *   · le symbole de référence est celui du rouleau 1 (la porte d'écurie ne
 *     peut pas y tomber, donc il n'y a pas d'ambiguïté) ;
 *   · pour chaque longueur de suite, on multiplie les probabilités de
 *     « ce rouleau continue la suite » et celle de « celui-là l'arrête » ;
 *   · les multiplicateurs se traitent avec une petite récurrence, puisqu'on
 *     les ADDITIONNE.
 *
 * Et comme la rangée d'une case ne change rien à sa loi, les vingt lignes
 * ont exactement la même espérance : on en calcule une, et on multiplie.
 *
 * Ce n'est pas seulement plus rapide — deux dixièmes de seconde au lieu de
 * trois secondes au démarrage. C'est aussi EXACT : plus aucune variance sur
 * les deux tiers du chiffre affiché.
 */

/** La loi d'un rouleau : identifiant de symbole → probabilité. */
const REEL_P = STRIPS.map((strip) => {
  const p = {};
  for (const id of strip) p[id] = (p[id] || 0) + 1 / strip.length;
  return p;
});

function exactBase() {
  let perLine = 0;

  for (const symbol of SYMBOLS) {
    const s = symbol.id;
    const p0 = REEL_P[0][s] || 0;
    if (!p0) continue;

    /*
     * `dist` est la loi du multiplicateur cumulé après i rouleaux :
     * dist[m] = probabilité (non conditionnelle) d'avoir atteint le rouleau
     * i en continuant la suite, avec m comme somme des multiplicateurs.
     * m vaut 0 quand aucune porte n'est encore entrée dans la combinaison.
     */
    let dist = { 0: p0 };

    for (let reel = 1; reel < REELS; reel++) {
      const pw = REEL_P[reel][WILD.id] || 0;
      const ps = REEL_P[reel][s] || 0;
      const cont = ps + pw;
      const stop = 1 - cont;

      // Avant d'avancer : la suite peut s'arrêter ICI, ce qui fige sa
      // longueur à `reel`. On encaisse si elle vaut au moins trois.
      if (reel >= 3) {
        const pay = symbol.pay[reel - 3];
        for (const [m, prob] of Object.entries(dist)) {
          perLine += prob * stop * pay * (Number(m) || 1);
        }
      }

      const next = {};
      const add = (m, prob) => { if (prob > 0) next[m] = (next[m] || 0) + prob; };
      for (const [mRaw, prob] of Object.entries(dist)) {
        const m = Number(mRaw);
        add(m, prob * ps);                                        // le symbole lui-même
        add(m + WILD_MULTIPLIERS[0], prob * pw * (1 - WILD_X3_CHANCE)); // une porte ×2
        add(m + WILD_MULTIPLIERS[1], prob * pw * WILD_X3_CHANCE);       // une porte ×3
      }
      dist = next;
      void cont;
    }

    // La suite est allée jusqu'au bout : cinq symboles.
    const pay5 = symbol.pay[REELS - 3];
    for (const [m, prob] of Object.entries(dist)) {
      perLine += prob * pay5 * (Number(m) || 1);
    }
  }

  // Vingt lignes identiques, sur une mise de vingt fois la mise par ligne :
  // le rapport est celui d'une seule ligne.
  return perLine;
}

/**
 * Le taux de déclenchement, exact lui aussi : il faut au moins un fer sur
 * chacun des trois rouleaux qui en portent.
 */
function exactTrigger() {
  return SCATTER_REELS.reduce((acc, reel) => {
    const p = REEL_P[reel][SCATTER.id] || 0;
    return acc * (1 - (1 - p) ** ROWS);
  }, 1);
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Joue un bonus entier et renvoie ce qu'il rapporte, en multiples de la mise. */
function playBonus(rnd, perLine) {
  const sticky = new Map();
  let remaining = FREE_SPINS;
  let played = 0;
  let pay = 0;

  while (remaining > 0 && played < MAX_FREE_SPINS) {
    remaining -= 1;
    played += 1;
    const grid = drawGrid(Array.from({ length: DRAW_SIZE }, rnd));
    applySticky(grid, sticky);
    const round = evaluate(grid, perLine);
    collectSticky(grid, sticky);
    if (round.trigger && played < MAX_FREE_SPINS) remaining += RETRIGGER_SPINS;
    pay += round.total;
  }
  return { pay, spins: played };
}

/**
 * LE BONUS, LUI, SE SIMULE — MAIS EN JOUANT DES BONUS.
 *
 * C'est là que passe l'essentiel de la redistribution, et c'est la partie
 * qui converge lentement : un bonus rapporte entre zéro et deux mille fois
 * la mise. Plutôt que de jouer des tours ordinaires en attendant qu'il
 * tombe (une fois sur quatre-vingt-douze), on le déclenche à la main. Pour
 * le même temps de calcul, on en observe quatre-vingt-dix fois plus.
 */
function sampleBonus(count, rnd) {
  const perLine = 100;
  const stake = perLine * LINES;
  let sum = 0;
  let spins = 0;
  let best = 0;

  for (let i = 0; i < count; i++) {
    const b = playBonus(rnd, perLine);
    sum += b.pay;
    spins += b.spins;
    if (b.pay > best) best = b.pay;
  }
  return {
    avg: count ? sum / count / stake : 0,
    spins: count ? spins / count : 0,
    max: best / stake,
    count,
  };
}

/** Le taux de gain : la seule quantité qui demande encore des tours ordinaires. */
function sampleHits(count, rnd) {
  const perLine = 100;
  let hits = 0;
  let best = 0;
  for (let i = 0; i < count; i++) {
    const g = evaluate(drawGrid(Array.from({ length: DRAW_SIZE }, rnd)), perLine);
    if (g.total > 0) hits++;
    if (g.total > best) best = g.total;
  }
  return { rate: count ? hits / count : 0, max: best / (perLine * LINES) };
}

/**
 * La mesure complète. `bonuses` et `rounds` pilotent la finesse : le
 * démarrage en prend peu pour ne pas retarder le serveur, puis un
 * raffinement en tâche de fond en prend beaucoup.
 */
function simulate(rounds = 40000, bonuses = 6000, seed = 987654321) {
  const rnd = makeRng(seed);
  const baseRtp = exactBase();
  const triggerRate = exactTrigger();
  const bonus = sampleBonus(bonuses, rnd);
  const hits = sampleHits(rounds, rnd);

  const rtp = Math.min(MAX_WIN_X, baseRtp + triggerRate * bonus.avg);
  return {
    rtp: Math.round(rtp * 10000) / 100,
    baseRtp: Math.round(baseRtp * 10000) / 100,
    bonusRtp: Math.round(triggerRate * bonus.avg * 10000) / 100,
    bonusRate: Math.round(triggerRate * 100000) / 1000,
    hitRate: Math.round(hits.rate * 10000) / 100,
    bonusAvg: Math.round(bonus.avg * 10) / 10,
    bonusSpins: Math.round(bonus.spins * 10) / 10,
    maxWin: Math.min(MAX_WIN_X, Math.round(Math.max(hits.max, bonus.max))),
    rounds,
    bonuses,
  };
}

/*
 * AU DÉMARRAGE : UNE MESURE RAPIDE, PUIS UNE MESURE FINE.
 *
 * Le serveur doit répondre tout de suite. On prend donc d'abord une mesure
 * légère — deux dixièmes de seconde —, puis on l'affine par tranches, en
 * rendant la main entre chaque, une fois le serveur en route. Le chiffre
 * affiché est toujours le meilleur disponible, et il se stabilise en
 * quelques secondes sans avoir jamais bloqué quoi que ce soit.
 *
 * La graine est fixe : deux démarrages du même code donnent le même
 * chiffre. Un taux de redistribution qui change tout seul n'inspire pas
 * confiance — à juste titre.
 */
let MEASURED = simulate(20000, 3000);

(function refine() {
  const TARGET = 60000;          // bonus au total, pour ±0,6 point
  const SLICE = 5000;
  const rnd = makeRng(4242);
  let sum = 0;
  let done = 0;
  let best = MEASURED.maxWin;

  const step = () => {
    const part = sampleBonus(SLICE, rnd);
    sum += part.avg * SLICE;
    done += SLICE;
    best = Math.max(best, Math.round(part.max));

    const baseRtp = exactBase();
    const triggerRate = exactTrigger();
    const avg = sum / done;
    MEASURED = {
      ...MEASURED,
      rtp: Math.round(Math.min(MAX_WIN_X, baseRtp + triggerRate * avg) * 10000) / 100,
      bonusRtp: Math.round(triggerRate * avg * 10000) / 100,
      bonusAvg: Math.round(avg * 10) / 10,
      maxWin: Math.min(MAX_WIN_X, best),
      bonuses: done,
    };
    if (done < TARGET) setTimeout(step, 60).unref();
  };
  setTimeout(step, 400).unref();
})();

function view() {
  return {
    reels: REELS,
    rows: ROWS,
    lines: LINES,
    paylines: PAYLINES,
    minBet: MIN_BET,
    maxBet: MAX_BET,
    maxWinX: MAX_WIN_X,
    freeSpins: FREE_SPINS,
    retrigger: RETRIGGER_SPINS,
    wildReels: WILD_REELS,
    scatterReels: SCATTER_REELS,
    multipliers: WILD_MULTIPLIERS,
    rtp: MEASURED.rtp,
    bonusRate: MEASURED.bonusRate,
    hitRate: MEASURED.hitRate,
    maxWin: MEASURED.maxWin,
    measuredOn: MEASURED.rounds,
    symbols: SYMBOLS.map((s) => ({ id: s.id, name: s.name, tier: s.tier, pay: s.pay })),
    wild: { id: WILD.id, name: WILD.name },
    scatter: { id: SCATTER.id, name: SCATTER.name },
  };
}

module.exports = {
  play, view, simulate, evaluate, drawGrid, applySticky, collectSticky,
  SYMBOLS, WILD, SCATTER, PAYLINES, STRIPS, LINES, MIN_BET, MAX_BET, MAX_WIN_X,
  REELS, ROWS, DRAW_SIZE, FREE_SPINS, RETRIGGER_SPINS, MAX_FREE_SPINS,
  WILD_REELS, SCATTER_REELS, WILD_MULTIPLIERS,
};
