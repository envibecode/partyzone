'use strict';
/**
 * SIMULATEUR D'UNO.
 *
 * Il ne demande aucun serveur : il prend le moteur, fait jouer des joueurs
 * au hasard, et vérifie après CHAQUE COUP un invariant que rien ne doit
 * jamais casser — il y a cent huit cartes, elles sont quelque part.
 *
 * Pourquoi cet invariant plutôt que des tests de règles un par un : dans un
 * jeu de cartes, les bugs qui comptent ne sont presque jamais « le +2 ne
 * fait pas piocher ». Ce sont les fuites — une carte défaussée deux fois,
 * une carte piochée sur une pioche vide, une main qui garde une carte déjà
 * posée. Elles ne se voient pas en jouant : la partie continue, un peu
 * fausse, et personne ne comprend pourquoi quelqu'un gagne trop souvent.
 * Un compteur vérifié à chaque action les attrape en quelques secondes.
 *
 * C'est exactement ce qui a trouvé les trois vrais bugs du poker.
 */

const { Uno, buildDeck } = require('../server/party/uno');

const TOTAL = 108;
const PARTIES = 60;

let fails = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

/* ─── Un salon sans serveur ────────────────────────────────────────────── */

/** Une fausse instance Socket.IO : elle absorbe tout et ne dit rien. */
const silentIo = { to: () => ({ emit: () => {} }), emit: () => {} };

function makeTable(count) {
  const table = new Uno(silentIo);
  // On coupe la diffusion : elle ne sert à rien ici et fait perdre du temps.
  table.broadcast = () => {};
  for (let i = 0; i < count; i++) {
    table.join(
      { id: `j${i}`, name: `Joueur ${i + 1}`, avatar: null },
      { id: `j${i}` },
      `sock-${i}`,
      {}
    );
  }
  return table;
}

/* ─── L'invariant ──────────────────────────────────────────────────────── */

/**
 * Compte toutes les cartes du jeu et vérifie qu'elles y sont toutes, une
 * seule fois chacune. On compare les IDENTIFIANTS, pas seulement le nombre :
 * une carte dupliquée et une carte perdue se compenseraient dans un simple
 * total.
 */
function census(table, where) {
  const ids = [];
  for (const [, hand] of table.hands) for (const c of hand) ids.push(c.id);
  for (const c of table.draw) ids.push(c.id);
  for (const c of table.discard) ids.push(c.id);

  if (ids.length !== TOTAL) {
    throw new Error(`${where} : ${ids.length} cartes en jeu au lieu de ${TOTAL}`);
  }
  const unique = new Set(ids);
  if (unique.size !== TOTAL) {
    throw new Error(`${where} : ${TOTAL - unique.size} carte(s) en double`);
  }
}

/* ─── Un joueur qui joue au hasard ─────────────────────────────────────── */

/**
 * Il ne cherche pas à gagner : il prend le premier coup légal qu'il trouve,
 * et sinon il pioche. Un joueur malin explorerait moins de situations —
 * c'est justement le hasard qui fait passer le moteur par les cas tordus.
 */
function randomMove(table, id, stats) {
  const hand = table.handOf(id);

  // Une chance sur cinq de contester un +4 : il faut que le cas arrive
  // souvent, dans les deux sens.
  if (table.lastD4 && table.lastD4.target === id && table.pending > 0 && Math.random() < 0.35) {
    const bluff = table.lastD4.hadColor;
    const res = table.challenge(id);
    if (res.ok) {
      stats.challenges++;
      if (bluff) stats.bluffsCaught++; else stats.badChallenges++;
    }
    return;
  }

  const playables = hand.filter((c) => table.playable(c));
  if (playables.length) {
    const card = playables[Math.floor(Math.random() * playables.length)];
    const color = card.c === 'w' ? ['r', 'y', 'g', 'b'][Math.floor(Math.random() * 4)] : null;
    if (card.v === 'd2') stats.d2++;
    if (card.v === 'd4') stats.d4++;
    if (card.v === 'rev') stats.rev++;
    if (card.v === 'skip') stats.skip++;
    const res = table.play(id, { cardId: card.id, color });
    if (!res.ok) throw new Error(`coup légal refusé : ${res.message}`);
    return;
  }

  const res = table.pick(id);
  if (!res.ok) throw new Error(`pioche refusée : ${res.message}`);
  // Si la carte piochée est jouable, on la joue une fois sur deux.
  if (table.drawn && table.drawn.playerId === id) {
    if (Math.random() < 0.5) {
      table.play(id, {
        cardId: table.drawn.cardId,
        color: ['r', 'y', 'g', 'b'][Math.floor(Math.random() * 4)],
      });
    } else {
      table.keep(id);
    }
  }
}

/* ─── La partie ────────────────────────────────────────────────────────── */

function playOneRound(table, stats) {
  let guard = 0;
  while (table.phase === 'playing') {
    if (++guard > 4000) throw new Error('manche interminable : plus de 4000 coups');
    const id = table.current;
    if (!id) throw new Error('personne dont ce soit le tour');

    /*
     * L'empreinte de la table avant le coup.
     *
     * Le premier garde-fou que j'avais écrit comparait juste « la main et le
     * tour n'ont pas bougé ». Il criait au blocage après une contestation
     * gagnée — où la règle veut justement que la main reste au contestataire,
     * qui n'a rien fait de mal. On regarde donc TOUT ce qu'un coup peut
     * changer : si strictement rien n'a bougé, alors seulement la table est
     * coincée.
     */
    const before = [table.turn, table.handOf(id).length, table.draw.length,
                    table.discard.length, table.pending].join('/');
    randomMove(table, id, stats);
    census(table, `après un coup de ${id}`);

    // Le « Uno ! » : une fois sur deux le joueur y pense, une fois sur
    // trois un adversaire le prend en flagrant délit.
    if (table.unoAt) {
      if (Math.random() < 0.5) table.sayUno(table.unoAt.playerId);
      else if (Math.random() < 0.33) {
        const other = table.order.find((x) => x !== table.unoAt.playerId);
        const res = table.catchUno(other, table.unoAt.playerId);
        if (res.ok) stats.caught++;
      }
      census(table, 'après un Uno');
    }
    const after = [table.turn, table.handOf(id).length, table.draw.length,
                   table.discard.length, table.pending].join('/');
    if (before === after && table.phase === 'playing' && !table.drawn) {
      throw new Error(`tour bloqué sur ${id} : rien n'a bougé (${before})`);
    }
  }
}

(async () => {
  console.log('Simulateur Uno — aucune carte ne doit se créer ni disparaître\n');

  const stats = { d2: 0, d4: 0, rev: 0, skip: 0, challenges: 0, bluffsCaught: 0, badChallenges: 0, caught: 0, rounds: 0, recycles: 0 };
  let maxHand = 0;

  try {
    for (let g = 0; g < PARTIES; g++) {
      const count = 2 + Math.floor(Math.random() * 5); // de 2 à 6 joueurs
      const table = makeTable(count);
      table.stacking = Math.random() < 0.75;
      table.roundsTarget = 1 + Math.floor(Math.random() * 2);

      // On neutralise les minuteurs : la simulation joue au rythme du
      // processeur, pas à celui d'une vraie table.
      table.armTurn = function () { clearTimeout(this.timer); };

      table.beginRound();
      census(table, 'à la distribution');

      let rounds = 0;
      while (table.phase !== 'over' && rounds < 6) {
        playOneRound(table, stats);
        stats.rounds++;
        rounds++;

        for (const [, hand] of table.hands) maxHand = Math.max(maxHand, hand.length);
        if (table.phase === 'round-end') {
          census(table, 'en fin de manche');
          clearTimeout(table.timer);
          if (table.round >= table.roundsTarget) table.finish();
          else table.beginRound();
        }
      }
      clearTimeout(table.timer);
      table.destroy();
    }
  } catch (err) {
    console.error('\n✗ ' + err.message + '\n');
    process.exit(1);
  }

  ok(`${PARTIES} parties jouées jusqu'au bout`, true, `${stats.rounds} manches`);
  ok('aucune carte créée ni perdue, jamais', true, `invariant vérifié après chaque coup`);
  ok('les +2 sont sortis', stats.d2 > 50, `${stats.d2} posés`);
  ok('les +4 sont sortis', stats.d4 > 20, `${stats.d4} posés`);
  ok('des inversions et des passe-tours', stats.rev > 20 && stats.skip > 20,
    `${stats.rev} inversions, ${stats.skip} passe-tours`);
  ok('des +4 ont été contestés dans les deux sens',
    stats.bluffsCaught > 0 && stats.badChallenges > 0,
    `${stats.challenges} contestations : ${stats.bluffsCaught} bluffs démasqués, ${stats.badChallenges} à tort`);
  ok('des joueurs se sont fait prendre sans Uno', stats.caught > 0, `${stats.caught} fois`);
  ok('aucune main ne dérape', maxHand < 40, `main la plus grosse : ${maxHand} cartes`);

  console.log(fails ? `\n${fails} vérification(s) en échec.` : '\nTOUT PASSE');
  process.exit(fails ? 1 : 0);
})();
