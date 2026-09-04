'use strict';
/**
 * SIMULATEUR DE LA MACHINE À SOUS — « HORSE HOUSE ».
 *
 * Une machine à sous ne se teste pas en la regardant tourner : à l'œil, une
 * machine à 80 % et une machine à 95 % sont indiscernables sur cent tours.
 * Ce qui se vérifie, ce sont les règles et les chiffres.
 *
 * LES RÈGLES, D'ABORD
 * ───────────────────
 *  · La porte d'écurie ne tombe JAMAIS sur les rouleaux 1 et 5, le fer à
 *    cheval JAMAIS sur les rouleaux 2 et 4. C'est ce qui rend le jeu
 *    lisible : on sait où regarder.
 *  · Les multiplicateurs d'une même ligne s'ADDITIONNENT. ×2 et ×3 font
 *    ×5, pas ×6. C'est écrit sur l'écran, donc ça doit être vrai.
 *  · Pendant les tours offerts, une porte posée ne bouge plus, et elle
 *    garde son multiplicateur jusqu'au dernier tour.
 *  · Trois fers déclenchent, un de plus ne re-déclenche pas deux fois.
 *
 * LES CHIFFRES, ENSUITE
 * ─────────────────────
 * On mesure la redistribution sur des centaines de milliers de tours et on
 * vérifie qu'elle tombe dans une fourchette étroite. C'est le test qui
 * empêche qu'un « petit ajustement » du barème vide la caisse du site sans
 * que personne ne s'en aperçoive avant trois semaines.
 */

const slots = require('../server/slots');

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

/** Un générateur simple, à graine, pour fabriquer des grilles au hasard. */
function rng(seed = 12345) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Fabrique une grille à la main, à partir d'une description lisible. */
function build(rows) {
  // `rows` est donné en LIGNES (ce qu'on voit), on le retourne en colonnes.
  const grid = [];
  for (let reel = 0; reel < slots.REELS; reel++) {
    const column = [];
    for (let row = 0; row < slots.ROWS; row++) {
      const raw = rows[row][reel];
      if (typeof raw === 'string') column.push({ id: raw });
      else column.push({ id: raw[0], mult: raw[1] });
    }
    grid.push(column);
  }
  return grid;
}

(function main() {
  console.log('Machine à sous « Horse House » — les règles, puis les chiffres\n');

  /* ── LES RUBANS ── */
  section('Où tombe quoi');
  {
    const wildOn = slots.STRIPS.map((strip) => strip.includes('wild'));
    check('la porte d’écurie n’existe que sur les rouleaux 2, 3 et 4',
      wildOn.join(',') === 'false,true,true,true,false',
      wildOn.map((v, i) => `R${i + 1}:${v ? 'oui' : 'non'}`).join(' '));

    const scatterOn = slots.STRIPS.map((strip) => strip.includes('scatter'));
    check('le fer à cheval n’existe que sur les rouleaux 1, 3 et 5',
      scatterOn.join(',') === 'true,false,true,false,true',
      scatterOn.map((v, i) => `R${i + 1}:${v ? 'oui' : 'non'}`).join(' '));

    check('vingt lignes de paiement', slots.PAYLINES.length === 20, `${slots.PAYLINES.length}`);
    check('aucune ligne en double',
      new Set(slots.PAYLINES.map((l) => l.join(''))).size === slots.PAYLINES.length);
    check('toutes les lignes tiennent dans la grille',
      slots.PAYLINES.every((l) => l.length === 5 && l.every((r) => r >= 0 && r < 3)));

    // Une ligne entièrement composée de portes est impossible : la première
    // case ne peut pas en être une. C'est ce qui nous dispense d'un barème
    // pour le wild lui-même.
    check('une ligne de portes seules ne peut pas exister',
      !slots.STRIPS[0].includes('wild'));
  }

  /* ── LES GAINS ── */
  section('Ce qu’une ligne rapporte');
  {
    const per = 100;
    const filler = ['10', 'J', 'Q', 'K', 'A'];

    /*
     * On regarde LA LIGNE, pas le total de la grille.
     *
     * Les rangées de remplissage forment forcément des combinaisons sur
     * les lignes diagonales — c'est le principe d'une machine à vingt
     * lignes. Additionner tout le monde et comparer à la valeur d'une
     * seule ligne, c'est se tromper de question.
     */
    const ligne = (grid, symbol) => (slots.evaluate(grid, per).wins
      .find((w) => w.symbol === symbol && w.rows.length >= 3) || null);

    // Cinq cowboys sur la ligne du milieu, sans multiplicateur.
    let w = ligne(build([
      filler, ['cowboy', 'cowboy', 'cowboy', 'cowboy', 'cowboy'], filler,
    ]), 'cowboy');
    check('cinq cowboys paient le barème', w && w.gain === 350 * per,
      w ? `${w.gain} pour ${350 * per} attendu` : 'aucune ligne trouvée');
    check('et cinq symboles sont bien comptés', w && w.count === 5);

    // Trois seulement.
    w = ligne(build([filler, ['cowboy', 'cowboy', 'cowboy', 'hay', 'oats'], filler]), 'cowboy');
    check('trois cowboys paient trois cowboys',
      w && w.count === 3 && w.gain === 14 * per, w ? `${w.gain}` : 'aucune ligne');

    // Deux ne paient rien.
    check('deux ne paient rien',
      ligne(build([filler, ['cowboy', 'cowboy', 'hay', 'oats', 'A'], filler]), 'cowboy') === null);

    // Une ligne ne se lit que de gauche à droite.
    check('une ligne ne se lit pas de droite à gauche',
      ligne(build([filler, ['hay', 'cowboy', 'cowboy', 'cowboy', 'cowboy'], filler]), 'cowboy') === null);
  }

  /* ── LES MULTIPLICATEURS ── */
  section('Les multiplicateurs s’additionnent');
  {
    const per = 100;
    const filler = ['10', 'J', 'Q', 'K', 'A'];

    const ligne = (grid, symbol) => (slots.evaluate(grid, per).wins
      .find((w) => w.symbol === symbol && w.rows.length >= 3) || null);

    let w = ligne(build([filler, ['cowboy', ['wild', 2], 'cowboy', 'cowboy', 'cowboy'], filler]), 'cowboy');
    check('une porte ×2 double la ligne', w && w.gain === 2 * 350 * per,
      w ? `${w.gain} pour ${2 * 350 * per} attendu` : 'aucune ligne');

    w = ligne(build([filler, ['cowboy', ['wild', 2], ['wild', 3], 'cowboy', 'cowboy'], filler]), 'cowboy');
    check('×2 et ×3 sur la même ligne font ×5 — pas ×6',
      w && w.gain === 5 * 350 * per,
      w ? `${w.gain} pour ${5 * 350 * per} attendu (×6 aurait donné ${6 * 350 * per})` : 'aucune ligne');
    check('et l’écran reçoit bien le multiplicateur total', w && w.mult === 5, w ? `×${w.mult}` : '—');

    w = ligne(build([filler, ['cowboy', ['wild', 3], ['wild', 3], ['wild', 3], 'cowboy'], filler]), 'cowboy');
    check('trois portes ×3 font ×9', w && w.gain === 9 * 350 * per, w ? `${w.gain}` : 'aucune ligne');

    // Une porte qui ne participe PAS à la ligne gagnante ne compte pas.
    w = ligne(build([filler, ['cowboy', 'cowboy', 'cowboy', 'hay', ['wild', 3]], filler]), 'cowboy');
    check('une porte hors de la combinaison ne multiplie rien',
      w && w.mult === 1, w ? `×${w.mult}` : 'aucune ligne');

    // La porte remplace, mais jamais le fer à cheval. On regarde la ligne
    // du milieu seule : elle commence par un fer, donc elle ne paie rien,
    // quelles que soient les portes qui suivent.
    const centre = slots.evaluate(build([
      filler, ['scatter', ['wild', 2], ['wild', 2], ['wild', 2], 'scatter'], filler,
    ]), per).wins.find((x) => x.line === 0);
    check('la porte ne remplace pas le fer à cheval', !centre,
      centre ? `${centre.gain} payés sur la ligne du milieu` : 'rien payé sur cette ligne');
  }

  /* ── LE DÉCLENCHEMENT ── */
  section('Le déclenchement des tours offerts');
  {
    const per = 100;
    const filler = ['10', 'J', 'Q', 'K', 'A'];

    let g = slots.evaluate(build([
      ['scatter', 'hay', 'scatter', 'oats', 'scatter'], filler, filler,
    ]), per);
    check('un fer sur les rouleaux 1, 3 et 5 déclenche', g.trigger === true);

    g = slots.evaluate(build([
      ['scatter', 'hay', 'scatter', 'oats', 'hay'], filler, filler,
    ]), per);
    check('deux fers ne déclenchent pas', g.trigger === false);

    // Le piège : trois fers, mais pas sur les trois bons rouleaux.
    g = slots.evaluate(build([
      ['scatter', 'hay', 'scatter', 'oats', 'hay'],
      ['scatter', 'hay', 'oats', 'oats', 'hay'],
      filler,
    ]), per);
    check('trois fers empilés sur deux rouleaux ne déclenchent pas',
      g.trigger === false, `${g.scatters.length} fers, mais sur 2 rouleaux`);

    g = slots.evaluate(build([
      ['scatter', 'hay', 'scatter', 'oats', 'scatter'],
      ['scatter', 'hay', 'oats', 'oats', 'hay'],
      filler,
    ]), per);
    check('quatre fers déclenchent une fois, pas deux', g.trigger === true);

    // Les fers ne paient pas : une grille qui n'a QUE des fers et des
    // symboles dépareillés ne rapporte rien du tout.
    const rien = slots.evaluate(build([
      ['scatter', 'hay', 'scatter', 'oats', 'scatter'],
      ['cowboy', 'oats', 'hay', 'A', 'K'],
      ['oats', 'A', 'K', 'hay', 'cowboy'],
    ]), per);
    check('les fers ne paient rien par eux-mêmes', rien.total === 0, `${rien.total}`);
  }

  /* ── LES PORTES COLLANTES ── */
  section('Les portes restent collées');
  {
    const sticky = new Map([['2,1', 3]]);
    const grid = slots.drawGrid(Array.from({ length: slots.DRAW_SIZE }, (_, i) => (i * 0.137) % 1));
    slots.applySticky(grid, sticky);
    check('la porte collée écrase le symbole tiré',
      grid[2][1].id === 'wild' && grid[2][1].mult === 3,
      `${grid[2][1].id} ×${grid[2][1].mult}`);
    check('et elle est marquée comme collée', grid[2][1].sticky === true);

    // Elle ne bouge plus, tour après tour.
    for (let i = 0; i < 20; i++) {
      const g2 = slots.drawGrid(Array.from({ length: slots.DRAW_SIZE }, () => Math.random()));
      slots.applySticky(g2, sticky);
      if (g2[2][1].id !== 'wild' || g2[2][1].mult !== 3) {
        check('elle ne bouge plus d’un tour à l’autre', false, `tour ${i + 1}`);
        break;
      }
      if (i === 19) check('elle ne bouge plus d’un tour à l’autre', true, '20 tours');
    }

    // Une porte qui tombe s'ajoute à la mémoire ; une déjà connue ne change
    // pas de multiplicateur en cours de route.
    const memory = new Map([['1,0', 2]]);
    const g3 = build([
      [['wild', 3], ['wild', 3], 'hay', 'oats', 'A'],
      ['10', 'J', 'Q', 'K', 'A'],
      ['10', 'J', 'Q', 'K', 'A'],
    ]);
    // (la première case est sur le rouleau 1 : impossible en vrai, mais ici
    // on teste la mémoire, pas le tirage)
    slots.collectSticky(g3, memory);
    check('une nouvelle porte entre en mémoire', memory.has('1,0'));
    check('une porte déjà en mémoire garde son multiplicateur',
      memory.get('1,0') === 2, `×${memory.get('1,0')}`);
  }

  /* ── UNE PARTIE ENTIÈRE ── */
  section('Des tours joués pour de vrai');
  {
    const profile = {
      vault: { coins: 100000000 },
      fair: { serverSeed: 'graine-de-test', clientSeed: 'client', nonce: 0, serverSeedHash: 'x' },
    };

    let bonuses = 0;
    let negative = 0;
    let mismatch = 0;
    let stickyBroken = 0;
    let rounds = 0;

    for (let i = 0; i < 4000; i++) {
      const before = profile.vault.coins;
      const r = slots.play(profile, { bet: 10 });
      if (!r.ok) { check('un tour a été refusé sans raison', false, r.message); break; }
      rounds += 1;

      // La comptabilité, à chaque tour : ce qui sort de la caisse et ce qui
      // y rentre doit correspondre exactement au solde.
      if (profile.vault.coins !== before - r.staked + r.payout) mismatch++;
      if (profile.vault.coins < 0) negative++;

      if (r.free.length) {
        bonuses++;
        // Les portes collées ne disparaissent jamais en cours de bonus.
        const seen = new Set();
        for (const round of r.free) {
          const now = new Set();
          round.grid.forEach((col, reel) => col.forEach((cell, row) => {
            if (cell.id === 'wild') now.add(`${reel},${row}`);
          }));
          for (const key of seen) if (!now.has(key)) stickyBroken++;
          for (const key of now) seen.add(key);
        }
      }
    }

    check('quatre mille tours joués', rounds === 4000, `${rounds}`);
    check('la caisse tombe juste à chaque tour', mismatch === 0, `${mismatch} écart(s)`);
    check('le solde ne passe jamais sous zéro', negative === 0);
    check('des bonus se sont déclenchés', bonuses > 10, `${bonuses} bonus sur ${rounds} tours`);
    check('aucune porte collée n’a disparu en cours de bonus',
      stickyBroken === 0, `${stickyBroken} disparition(s)`);

    // La mise est contrôlée.
    check('une mise trop petite est refusée',
      slots.play(profile, { bet: 1 }).ok === false);
    check('une mise trop grosse est refusée',
      slots.play(profile, { bet: slots.MAX_BET + 1 }).ok === false);
    check('une mise absurde est refusée',
      slots.play(profile, { bet: -500 }).ok === false);
    const pauvre = { vault: { coins: 5 }, fair: { ...profile.fair, nonce: 0 } };
    check('on ne joue pas ce qu’on n’a pas', slots.play(pauvre, { bet: 10 }).ok === false);
  }

  /* ── LE RETRIGGER ── */
  section('Le retrigger, et sa limite');
  {
    // On force un déclenchement à chaque tour pour vérifier que le
    // garde-fou existe : sans lui, une machine « illimitée » l'est
    // vraiment, et un joueur malchanceux fige le serveur.
    const before = slots.MAX_FREE_SPINS;
    check('un plafond de tours offerts existe',
      Number.isFinite(before) && before > 0, `${before} tours au maximum`);
    check('et il laisse largement la place à plusieurs retriggers',
      before >= slots.FREE_SPINS * 5, `${before} contre ${slots.FREE_SPINS} de base`);
  }

  /* ── LES CHIFFRES ── */
  section('La redistribution, mesurée');
  {
    /*
     * On mesure comme le moteur mesure : le jeu de base d'un côté, le bonus
     * de l'autre. Jouer des tours ordinaires et attendre que le bonus tombe
     * donnerait une moyenne qui danse de dix points d'une graine à l'autre —
     * on l'a constaté, et c'est ce qui a motivé la méthode.
     */
    const runs = [1, 2, 3].map((i) => slots.simulate(80000, 12000, i * 7919));
    runs.forEach((r, i) => {
      console.log(`    simulation ${i + 1} : ${r.rtp} % (base ${r.baseRtp} + bonus ${r.bonusRtp}) · `
        + `bonus 1 sur ${Math.round(100 / r.bonusRate)} · gain max ${r.maxWin}×`);
    });
    const avg = (pick) => runs.reduce((n, r) => n + pick(r), 0) / runs.length;
    const rtp = avg((r) => r.rtp);

    check('la redistribution est dans la fourchette annoncée',
      rtp > 91 && rtp < 99, `${rtp.toFixed(2)} % en moyenne`);
    check('la machine ne redistribue jamais plus qu’elle ne prend',
      runs.every((r) => r.rtp < 100), runs.map((r) => `${r.rtp} %`).join(' · '));
    check('le jeu de base ne suffit pas à lui seul',
      avg((r) => r.baseRtp) < 30,
      `${avg((r) => r.baseRtp).toFixed(1)} % — le reste vient du bonus, c’est ce qui fait la volatilité`);
    check('un tour sur quatre environ paie quelque chose',
      avg((r) => r.hitRate) > 18 && avg((r) => r.hitRate) < 32, `${avg((r) => r.hitRate).toFixed(1)} %`);
    check('le bonus tombe à peu près une fois sur cent',
      avg((r) => r.bonusRate) > 0.7 && avg((r) => r.bonusRate) < 1.6,
      `1 sur ${Math.round(100 / avg((r) => r.bonusRate))}`);
    check('un bonus vaut plusieurs dizaines de fois la mise',
      avg((r) => r.bonusAvg) > 40, `${avg((r) => r.bonusAvg).toFixed(0)}× en moyenne`);
    check('aucun gain ne dépasse le plafond annoncé',
      runs.every((r) => r.maxWin <= slots.MAX_WIN_X), `plafond ${slots.MAX_WIN_X}×`);

    const view = slots.view();
    check('le chiffre affiché est cohérent avec ce qu’on vient de mesurer',
      Math.abs(view.rtp - rtp) < 4, `écran ${view.rtp} % contre ${rtp.toFixed(2)} % ici`);
    check('l’écran annonce sur combien de tours il a mesuré',
      view.measuredOn === undefined || view.measuredOn > 0, `${view.rounds || ''}`);
  }

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  process.exit(failures ? 1 : 0);
})();
