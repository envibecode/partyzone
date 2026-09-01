'use strict';
/**
 * SIMULATION DU POKER, SANS RÉSEAU.
 *
 * Soixante tournois entiers joués au hasard, avec beaucoup de tapis pour
 * fabriquer des pots secondaires. Une seule chose est vraiment vérifiée, mais
 * elle vaut toutes les autres : APRÈS CHAQUE ACTION, la somme des jetons de
 * la table doit valoir exactement ce qu'elle valait au départ.
 *
 * C'est ce test qui a débusqué les trois vrais bugs de ce moteur : un
 * `committed` d'éliminé jamais remis à zéro qui gonflait les pots secondaires,
 * un pot payé mais laissé affiché — donc compté deux fois —, et une table
 * bloquée quand la blinde mettait un joueur à tapis avant qu'il ait parlé.
 *
 *   node test/poker-sim.js
 */
const { Poker } = require('../server/party/poker');
const fakeIo = { to: () => ({ emit: () => {} }), sockets: { adapter: { rooms: new Map() } } };

let bad = 0;
const check = (l, ok, x='') => { console.log(`${ok?'✓':'✗'} ${l}${x?' — '+x:''}`); if(!ok) bad++; };

function makeTable(n) {
  const room = new Poker(fakeIo);
  for (let i = 0; i < n; i++) {
    room.join({ id: `p${i}`, name: `J${i}`, avatar: null }, {}, `s${i}`);
  }
  return room;
}

// On joue des tournois entiers en pilotant les actions au hasard,
// et on vérifie à chaque instant que la somme des jetons est constante.
let tournaments = 0, hands = 0, showdowns = 0, sidePots = 0, splits = 0, drift = 0, maxBoard = 0;

for (let t = 0; t < 60; t++) {
  const n = 2 + (t % 6);          // de 2 à 7 joueurs
  const room = makeTable(n);
  const TOTAL = n * 5000;
  room.start('p0');
  tournaments++;

  let guard = 0;
  while (room.phase !== 'over' && guard++ < 4000) {
    if (room.phase === 'showdown') {
      showdowns++;
      if (room.showdown && room.showdown.pots && room.showdown.pots.length > 1) sidePots++;
      if (room.showdown && room.showdown.pots) {
        for (const p of room.showdown.pots) if (p.winners.length > 1) splits++;
        const paid = room.showdown.pots.reduce((s, p) => s + p.amount, 0);
        const got = (room.showdown.winners || []).reduce((s, w) => s + w.won, 0);
        if (paid !== got) drift++;
      }
      maxBoard = Math.max(maxBoard, room.board.length);
      // on enchaîne la main suivante à la main, sans attendre le minuteur
      clearTimeout(room.timer);
      if (room.alive.length <= 1) { room.finish(room.alive[0]); break; }
      hands++;
      room.nextHand();
      continue;
    }
    if (room.phase !== 'playing' || !room.toAct) {
      // runOut() étale les cartes sur un minuteur : on le déroule d'un coup
      // runOut() étale les cartes sur un minuteur ; on le court-circuite.
      clearTimeout(room.timer);
      if (room.inHand.length <= 1) { room.awardUncontested(room.inHand[0]); continue; }
      while (room.board.length < 5) { room.deck.pop(); room.board.push(room.deck.pop()); }
      room.doShowdown();
      continue;
    }
    const p = room.playerOf(room.toAct);
    const toCall = room.currentBet - p.bet;
    const r = Math.random();
    let move = 'check', amount;
    if (r < 0.10) move = 'fold';
    else if (r < 0.72) move = toCall > 0 ? 'call' : 'check';
    else {
      move = 'raise';
      // relances variées, dont des tapis, pour fabriquer des pots secondaires
      amount = r > 0.94 ? p.bet + p.chips
        : Math.min(p.bet + p.chips, room.currentBet + room.minRaise + Math.floor(Math.random() * 800));
    }
    const res = room.act(p.id, move, amount);
    if (!res.ok && move === 'raise') room.act(p.id, toCall > 0 ? 'call' : 'check');
    if (!res.ok && move === 'check') room.act(p.id, 'call');
    if (!res.ok && move === 'call') room.act(p.id, 'check');

    const sum = room.players.reduce((s, x) => s + (x.chips || 0), 0) + room.pot;
    if (sum !== TOTAL) { drift++; console.log(`  déséquilibre : ${sum} au lieu de ${TOTAL}`); break; }
  }
  clearTimeout(room.timer);

  const end = room.players.reduce((s, x) => s + (x.chips || 0), 0);
  if (end !== TOTAL) { drift++; console.log(`  fin déséquilibrée : ${end}/${TOTAL}`); }
  if (guard >= 4000) {
    console.log('BLOQUÉ phase=' + room.phase + ' street=' + room.street + ' toAct=' + room.toAct + ' currentBet=' + room.currentBet + ' pot=' + room.pot);
    console.log(room.players.map(p=>`  ${p.name} chips=${p.chips} bet=${p.bet} com=${p.committed} inHand=${p.inHand} fold=${p.folded} allin=${p.allIn} acted=${p.acted} bust=${p.busted}`).join('\n'));
    process.exit(1);
  }
}

check(`${tournaments} tournois joués jusqu'au bout`, tournaments === 60);
check('aucun jeton créé ni perdu, jamais', drift === 0, `${hands} mains, ${showdowns} abattages`);
check('des pots secondaires ont été formés', sidePots > 0, `${sidePots} fois`);
check('des pots partagés ont été gérés', splits > 0, `${splits} fois`);
check('le tableau ne dépasse jamais 5 cartes', maxBoard === 5, `max ${maxBoard}`);
console.log(bad ? `\n${bad} ÉCHEC(S)` : '\nTOUT PASSE');
process.exit(bad ? 1 : 0);
