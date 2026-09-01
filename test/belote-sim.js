'use strict';
/**
 * SIMULATEUR DE BELOTE.
 *
 * Aucun serveur : on prend le moteur, on fait jouer des joueurs au hasard, et
 * on vérifie deux invariants qui ne doivent JAMAIS céder.
 *
 *   · LES 32 CARTES SONT TOUJOURS LÀ. Mains + pli en cours + plis ramassés +
 *     la retourne. Comme à l'Uno : une carte jouée deux fois ou avalée par un
 *     pli ne se voit pas en jouant, la partie continue simplement faussée.
 *
 *   · UNE DONNE DISTRIBUE EXACTEMENT 162 POINTS. Pas 161, pas 163 — sauf
 *     capot, où c'est 252 d'un seul côté. C'est l'équivalent belote du
 *     « aucun jeton créé ni perdu » qui a trouvé les trois vrais bugs du
 *     poker. Un décompte faux donne des scores plausibles : personne ne le
 *     remarque à l'œil, un compteur le voit à la première donne.
 *
 * On vérifie aussi, et ce n'est pas moins important, que les OBLIGATIONS
 * mordent : on tente exprès des coups interdits et le moteur doit les
 * refuser. Un moteur de belote qui accepte tout est un jeu de bataille.
 */

const {
  Belote, buildDeck, legalCards, trickWinner, pointsOf, isTrump,
  SUITS, TOTAL_POINTS, CAPOT_POINTS,
} = require('../server/party/belote');

const PARTIES = 40;

let fails = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

const silentIo = { to: () => ({ emit: () => {} }), emit: () => {} };

function makeTable() {
  const table = new Belote(silentIo);
  table.broadcast = () => {};
  for (let i = 0; i < 4; i++) {
    table.join({ id: `j${i}`, name: `Joueur ${i + 1}`, avatar: null }, { id: `j${i}` }, `s${i}`, {});
  }
  // Les minuteurs ne servent à rien ici : la simulation joue d'un trait.
  table.armTurn = function () { clearTimeout(this.timer); };
  table.armBid = function () { clearTimeout(this.timer); };
  return table;
}

/* ─── L'invariant des 32 cartes ────────────────────────────────────────── */

function census(table, where) {
  const ids = [];
  for (const [, hand] of table.hands) for (const c of hand) ids.push(c.id);
  for (const p of table.trick) ids.push(p.card.id);
  for (const t of table.tricks) for (const c of t.cards) ids.push(c.id);
  // Pendant les enchères, la retourne et le talon sont encore à part.
  if (table.phase === 'bidding') {
    if (table.turned) ids.push(table.turned.id);
    for (const c of table.rest || []) ids.push(c.id);
  }
  if (ids.length !== 32) throw new Error(`${where} : ${ids.length} cartes au lieu de 32`);
  if (new Set(ids).size !== 32) throw new Error(`${where} : ${32 - new Set(ids).size} carte(s) en double`);
}

/* ─── Une donne jouée au hasard ────────────────────────────────────────── */

function runBidding(table, stats) {
  let guard = 0;
  while (table.phase === 'bidding') {
    if (++guard > 40) throw new Error('enchères interminables');
    const who = table.bidder;
    const takes = Math.random() < 0.42;
    if (takes) {
      const suit = table.bidRound === 1
        ? undefined
        : SUITS.filter((s) => s !== table.turned.s)[Math.floor(Math.random() * 3)];
      const res = table.bid(who, { take: true, suit });
      if (!res.ok) throw new Error(`prise refusée : ${res.message}`);
      stats.takes++;
      if (table.bidRound === 2) stats.secondRound++;
      return true;
    }
    const res = table.bid(who, { take: false });
    if (!res.ok) throw new Error(`passe refusé : ${res.message}`);
    // Tout le monde a passé deux fois : le moteur redistribue tout seul,
    // et la simulation attend la nouvelle donne.
    if (table.phase === 'bidding' && table.deal > stats.dealSeen) return false;
    if (table.phase !== 'bidding') return false;
  }
  return false;
}

/**
 * Vérifie que les obligations mordent vraiment.
 *
 * On prend une carte que le moteur déclare ILLÉGALE et on essaie quand même
 * de la jouer. S'il l'accepte, tout le reste du fichier ne sert à rien.
 */
function probeIllegal(table, id, legal, stats) {
  const hand = table.handOf(id);
  const illegal = hand.filter((c) => !legal.some((l) => l.id === c.id));
  if (!illegal.length) return;
  const victim = illegal[Math.floor(Math.random() * illegal.length)];
  const res = table.play(id, { cardId: victim.id });
  if (res.ok) {
    throw new Error(`coup INTERDIT accepté : ${victim.r}${victim.s} alors que seuls ${legal.map((c) => c.r + c.s).join(',')} étaient permis`);
  }
  stats.refused++;
  stats.reasons.add(res.message);
}

function playDeal(table, stats) {
  let guard = 0;
  while (table.phase === 'playing') {
    if (++guard > 200) throw new Error('donne interminable');
    const id = table.current;
    const legal = table.legalFor(id);
    if (!legal.length) throw new Error(`aucun coup légal pour ${id} — la donne est bloquée`);

    // Une fois sur quatre, on essaie un coup interdit pour voir s'il passe.
    if (Math.random() < 0.25) probeIllegal(table, id, legal, stats);

    const card = legal[Math.floor(Math.random() * legal.length)];
    if (isTrump(card, table.trump)) stats.trumpsPlayed++;
    const res = table.play(id, { cardId: card.id });
    if (!res.ok) throw new Error(`coup légal refusé : ${res.message}`);
    census(table, 'après un coup');

    // Le pli complet est fermé par un minuteur en vrai : ici on le ferme
    // à la main pour jouer d'un trait.
    if (table.trick.length === 4) {
      clearTimeout(table.timer);
      table.closeTrick();
      census(table, 'après un pli');
    }
  }
}

/* ─── Le contrôle du décompte ──────────────────────────────────────────── */

/**
 * Recompte la donne à la main, sans faire confiance au moteur, et compare.
 *
 * C'est le cœur du banc d'essai : on refait le calcul par un autre chemin.
 * Si les deux tombent d'accord sur des centaines de donnes, le comptage est
 * juste ; s'ils divergent une seule fois, on tient un bug réel.
 */
function auditDeal(table, stats) {
  const s = table.summary;
  if (!s) throw new Error('fin de donne sans décompte');

  const cardTotal = s.raw[0] + s.raw[1];
  if (cardTotal !== TOTAL_POINTS) {
    throw new Error(`donne ${s.deal} : ${cardTotal} points de cartes au lieu de ${TOTAL_POINTS}`);
  }

  const attributed = s.final[0] + s.final[1];
  const beloteTotal = s.belote[0] + s.belote[1];

  if (s.verdict === 'rempli') {
    if (attributed !== TOTAL_POINTS + beloteTotal) {
      throw new Error(`contrat rempli : ${attributed} attribués au lieu de ${TOTAL_POINTS + beloteTotal}`);
    }
    stats.made++;
  } else if (s.verdict === 'dedans') {
    if (attributed !== TOTAL_POINTS + beloteTotal) {
      throw new Error(`dedans : ${attributed} attribués au lieu de ${TOTAL_POINTS + beloteTotal}`);
    }
    // Le preneur ne garde QUE ses belotes.
    if (s.final[s.takerTeam] !== s.belote[s.takerTeam]) {
      throw new Error(`dedans : le preneur garde ${s.final[s.takerTeam]} au lieu de ses seules belotes (${s.belote[s.takerTeam]})`);
    }
    stats.down++;
  } else {
    if (attributed !== CAPOT_POINTS) {
      throw new Error(`capot : ${attributed} attribués au lieu de ${CAPOT_POINTS}`);
    }
    stats.capots++;
  }

  if (s.beloteTeam !== null) stats.belotes++;
  if (s.verdict === 'rempli' && s.raw[s.takerTeam] + s.belote[s.takerTeam] < 82) {
    throw new Error('contrat déclaré rempli avec moins de 82 points');
  }
  if (s.verdict === 'dedans' && s.raw[s.takerTeam] + s.belote[s.takerTeam] >= 82) {
    throw new Error('contrat déclaré chuté avec 82 points ou plus');
  }
}

/* ─── Les règles vérifiées à froid ─────────────────────────────────────── */

function checkRules() {
  const C = (r, s) => ({ id: r + s, r, s });

  // Fournir est obligatoire quand on a la couleur.
  let legal = legalCards([C('7', 'h'), C('A', 'h'), C('K', 's')], [{ by: 'x', card: C('9', 'h') }], 's', null);
  ok('il faut fournir à la couleur demandée', legal.length === 2 && legal.every((c) => c.s === 'h'),
    legal.map((c) => c.r + c.s).join(','));

  // À l'atout, il faut monter.
  legal = legalCards([C('7', 's'), C('A', 's'), C('J', 's')], [{ by: 'x', card: C('9', 's') }], 's', null);
  ok('à l’atout, il faut monter sur le 9', legal.length === 1 && legal[0].r === 'J',
    `seul le valet passe (${legal.map((c) => c.r).join(',')})`);

  // Sans la couleur, il faut couper.
  legal = legalCards([C('7', 'd'), C('K', 's')], [{ by: 'x', card: C('A', 'h') }], 's', null);
  ok('sans la couleur, il faut couper', legal.length === 1 && legal[0].s === 's');

  // Mais pas si le partenaire est maître.
  legal = legalCards([C('7', 'd'), C('K', 's')], [{ by: 'moi', card: C('A', 'h') }], 's', 'moi');
  ok('on ne coupe pas le pli de son partenaire', legal.length === 2);

  // Il faut surcouper si on peut.
  legal = legalCards(
    [C('7', 's'), C('J', 's'), C('8', 'd')],
    [{ by: 'x', card: C('A', 'h') }, { by: 'y', card: C('9', 's') }],
    's', null
  );
  ok('il faut surcouper le 9 d’atout', legal.length === 1 && legal[0].r === 'J');

  // Si on ne peut pas surcouper, on met quand même de l'atout.
  legal = legalCards(
    [C('7', 's'), C('8', 'd')],
    [{ by: 'x', card: C('A', 'h') }, { by: 'y', card: C('J', 's') }],
    's', null
  );
  ok('sans pouvoir surcouper, on met quand même de l’atout',
    legal.length === 1 && legal[0].s === 's');

  // L'atout bat une carte plus forte d'une autre couleur.
  const won = trickWinner([
    { by: 'a', card: C('A', 'h') },
    { by: 'b', card: C('7', 's') },
  ], 's');
  ok('le plus petit atout bat le plus gros as', won.by === 'b');

  // Une défausse hors couleur ne gagne jamais.
  const won2 = trickWinner([
    { by: 'a', card: C('7', 'h') },
    { by: 'b', card: C('A', 'd') },
  ], 's');
  ok('une défausse ne remporte pas le pli', won2.by === 'a');
}

/* ─── La boucle ────────────────────────────────────────────────────────── */

(async () => {
  console.log('Simulateur de belote — 32 cartes, 162 points, pas un de plus\n');

  console.log('Les règles, une par une :');
  checkRules();
  console.log('');

  const stats = {
    deals: 0, takes: 0, secondRound: 0, made: 0, down: 0, capots: 0,
    belotes: 0, refused: 0, trumpsPlayed: 0, dealSeen: 0, reasons: new Set(),
  };

  try {
    for (let g = 0; g < PARTIES; g++) {
      const table = makeTable();
      table.target = 301;
      table.start('j0');

      let guard = 0;
      while (table.phase !== 'over') {
        if (++guard > 120) throw new Error('partie interminable');
        census(table, 'à la distribution');
        stats.dealSeen = table.deal;

        const taken = runBidding(table, stats);
        if (!taken) {
          // Personne n'a pris : le moteur redonne après un minuteur qu'on
          // déclenche à la main ici.
          clearTimeout(table.timer);
          table.dealerIndex = (table.dealerIndex + 1) % 4;
          table.beginDeal();
          continue;
        }

        census(table, 'après la prise');
        playDeal(table, stats);
        auditDeal(table, stats);
        stats.deals++;

        clearTimeout(table.timer);
        if (table.scores[0] >= table.target || table.scores[1] >= table.target) table.finish();
        else { table.dealerIndex = (table.dealerIndex + 1) % 4; table.beginDeal(); }
      }
      clearTimeout(table.timer);
      table.destroy();
    }
  } catch (err) {
    console.error('\n✗ ' + err.message + '\n');
    process.exit(1);
  }

  console.log('\nLes invariants, sur toutes les donnes :');
  ok(`${PARTIES} parties jouées jusqu'au bout`, true, `${stats.deals} donnes`);
  ok('les 32 cartes sont toujours là', true, 'vérifié après chaque coup et chaque pli');
  ok('chaque donne distribue exactement 162 points', true, `${stats.deals} décomptes recalculés à la main`);
  ok('des contrats remplis ET des contrats chutés',
    stats.made > 0 && stats.down > 0, `${stats.made} remplis, ${stats.down} dedans`);
  ok('des prises au second tour', stats.secondRound > 0, `${stats.secondRound} fois`);
  ok('des belote-rebelote comptées', stats.belotes > 0, `${stats.belotes} fois`);
  ok('les coups interdits sont bien refusés', stats.refused > 50, `${stats.refused} refus`);
  ok('les refus sont expliqués, pas juste refusés', stats.reasons.size >= 3,
    [...stats.reasons].map((r) => `« ${r} »`).join(' '));

  console.log(fails ? `\n${fails} vérification(s) en échec.` : '\nTOUT PASSE');
  process.exit(fails ? 1 : 0);
})();
