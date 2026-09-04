'use strict';
/**
 * SIMULATEUR DE SOIRÉE.
 *
 * La soirée ne joue à rien : elle compte. Ce qu'on vérifie ici, c'est donc
 * l'arithmétique et l'enchaînement, pas les règles des jeux — chacun a déjà
 * son propre simulateur.
 *
 * Trois choses doivent tenir, et ce sont les trois qui gâchent une soirée
 * quand elles lâchent :
 *
 *  • le barème (les ex æquo, la queue de classement, personne d'oublié) ;
 *  • le cumul (une manche comptée une fois, jamais deux, même après un
 *    redémarrage) ;
 *  • la traduction de chaque jeu vers un classement — c'est `ranking()`,
 *    et c'est le seul endroit où la soirée touche aux jeux.
 *
 * Aucun serveur, aucun navigateur : on manipule les objets directement.
 */

const soirees = require('../server/party/soiree');
const { Uno } = require('../server/party/uno');
const { Belote } = require('../server/party/belote');
const { Blindtest } = require('../server/party/blindtest');
const { Monopoly } = require('../server/party/monopoly');
const { Poker } = require('../server/party/poker');
const { Loup } = require('../server/party/loup');

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

const io = { to: () => ({ emit: () => {} }) };

/** Un salon peuplé, sans passer par les sockets. */
function seat(Game, names) {
  const g = new Game(io);
  names.forEach((name, i) => g.join({ id: 'j' + i, name, avatar: null }, {}, 's' + i));
  return g;
}

(function main() {
  console.log('Simulateur de soirée — plusieurs jeux, un seul classement\n');

  /* ── LE BARÈME ── */
  section('Le barème');
  {
    const solo = soirees.award([
      { id: 'a', score: 50 }, { id: 'b', score: 40 }, { id: 'c', score: 30 },
      { id: 'd', score: 20 }, { id: 'e', score: 10 }, { id: 'f', score: 0 },
    ]);
    check('dix, six, quatre, trois, deux, puis un',
      solo.map((l) => l.gained).join('-') === '10-6-4-3-2-1', solo.map((l) => l.gained).join('-'));
    check('les places suivent le classement',
      solo.map((l) => l.rank).join('-') === '1-2-3-4-5-6');

    const tie = soirees.award([
      { id: 'a', score: 100 }, { id: 'b', score: 100 }, { id: 'c', score: 50 },
    ]);
    check('deux premiers ex æquo touchent dix chacun',
      tie[0].gained === 10 && tie[1].gained === 10, `${tie[0].gained} et ${tie[1].gained}`);
    check('et le suivant est troisième, pas deuxième',
      tie[2].rank === 3 && tie[2].gained === 4, `place ${tie[2].rank}, ${tie[2].gained} pts`);

    const all = soirees.award([
      { id: 'a', score: 7 }, { id: 'b', score: 7 }, { id: 'c', score: 7 }, { id: 'd', score: 7 },
    ]);
    check('une égalité totale ne fait perdre personne',
      all.every((l) => l.gained === 10 && l.rank === 1));

    const long = soirees.award(Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, score: 100 - i })));
    check('au-delà du sixième, un point de présence',
      long.slice(5).every((l) => l.gained === 1), `${long.length} joueurs classés`);
    check('personne n’est oublié en route', long.length === 10);
    check('personne ne repart les mains vides', long.every((l) => l.gained >= 1));
  }

  /* ── CHAQUE JEU SAIT SE CLASSER ── */
  section('Chaque jeu sait dire qui est devant qui');
  {
    // Uno : les points.
    const uno = seat(Uno, ['Alice', 'Bruno', 'Chloé']);
    uno.result = {
      table: [{ id: 'j1', points: 120 }, { id: 'j0', points: 80 }, { id: 'j2', points: 10 }],
      winnerIds: ['j1'],
    };
    check('Uno classe par points',
      uno.ranking().map((r) => r.id).join(',') === 'j1,j0,j2');

    // Monopoly : la fortune, et zéro pour les ruinés.
    const mono = seat(Monopoly, ['Alice', 'Bruno', 'Chloé']);
    mono.result = {
      table: [
        { id: 'j0', out: false, worth: 3200 },
        { id: 'j2', out: false, worth: 1500 },
        { id: 'j1', out: true, worth: 0 },
      ],
      winnerIds: ['j0'],
    };
    const mr = mono.ranking();
    check('Monopoly classe par fortune', mr[0].id === 'j0' && mr[0].score === 3200);
    check('et un ruiné vaut zéro', mr[2].score === 0);

    // Poker : les jetons.
    const pk = seat(Poker, ['Alice', 'Bruno']);
    pk.result = { winnerId: 'j0', standings: [{ id: 'j0', chips: 3000 }, { id: 'j1', chips: 0 }] };
    check('Poker classe par tapis restant',
      soirees.award(pk.ranking()).map((l) => l.gained).join('-') === '10-6');

    // Belote : les deux coéquipiers au même rang.
    const bl = seat(Belote, ['Alice', 'Bruno', 'Chloé', 'David']);
    bl.order = ['j0', 'j1', 'j2', 'j3'];
    bl.result = { scores: [1000, 620], winnerTeam: 0, winnerIds: ['j0', 'j2'] };
    const blAward = soirees.award(bl.ranking());
    const byId = Object.fromEntries(blAward.map((l) => [l.id, l]));
    check('Belote met les deux coéquipiers au même rang',
      byId.j0.rank === 1 && byId.j2.rank === 1 && byId.j1.rank === 3 && byId.j3.rank === 3);
    check('et leur donne les mêmes points',
      byId.j0.gained === 10 && byId.j2.gained === 10 && byId.j1.gained === 4);

    // Loup-garou : pas de score individuel — le camp gagnant, point.
    const lg = seat(Loup, ['A', 'B', 'C', 'D', 'E', 'F']);
    lg.result = { winnerIds: ['j0', 'j1'], camp: 'loups' };
    const lgAward = soirees.award(lg.ranking());
    const winners = lgAward.filter((l) => l.rank === 1).map((l) => l.id).sort().join(',');
    check('Loup-garou classe par camp, sans inventer de score',
      winners === 'j0,j1', winners);
    check('et les villageois restent au classement', lgAward.length === 6);

    // Blindtest : les points.
    const bt = seat(Blindtest, ['Alice', 'Bruno']);
    bt.result = { table: [{ id: 'j1', points: 4200 }, { id: 'j0', points: 900 }], winnerIds: ['j1'] };
    check('Blindtest classe par points', bt.ranking()[0].id === 'j1');

    // Une partie sans résultat ne casse rien : on retombe sur le vainqueur.
    const vierge = seat(Uno, ['Alice', 'Bruno']);
    check('un salon sans résultat se classe quand même',
      vierge.ranking().length === 2 && vierge.ranking().every((r) => r.score === 0));
  }

  /* ── LE CUMUL ── */
  section('Le cumul, manche après manche');
  {
    const s = new soirees.Soiree(['uno', 'belote', 'blindtest'], 'j0');

    const manche = (Game, names, result, extra = {}) => {
      const g = seat(Game, names);
      Object.assign(g, extra);
      g.result = result;
      g.soiree = s.code;
      s.record(g);
      return g;
    };

    manche(Uno, ['Alice', 'Bruno', 'Chloé'], {
      table: [{ id: 'j0', points: 200 }, { id: 'j1', points: 90 }, { id: 'j2', points: 10 }],
      winnerIds: ['j0'],
    });
    check('après une manche, le premier mène', s.standings()[0].id === 'j0');
    check('et le dernier a quand même marqué',
      s.standings()[2].points === 4, `${s.standings()[2].points} pts`);

    const deux = manche(Uno, ['Alice', 'Bruno', 'Chloé'], {
      table: [{ id: 'j2', points: 300 }, { id: 'j1', points: 200 }, { id: 'j0', points: 5 }],
      winnerIds: ['j2'],
    });
    const t = Object.fromEntries(s.standings().map((r) => [r.id, r.points]));
    check('les points s’additionnent', t.j0 === 14 && t.j1 === 12 && t.j2 === 14,
      `j0 ${t.j0}, j1 ${t.j1}, j2 ${t.j2}`);
    check('deux manches enregistrées', s.history.length === 2);

    // Le même salon recompté : la soirée doit refuser.
    const before = JSON.stringify(s.standings());
    s.record(deux);
    check('une manche ne compte jamais deux fois',
      JSON.stringify(s.standings()) === before && s.history.length === 2);

    // Un salon sans résultat : rien ne bouge.
    const rien = seat(Uno, ['Alice']);
    rien.soiree = s.code;
    check('une partie non terminée ne compte pas', s.record(rien) === false);

    // La dernière manche clôt la soirée.
    check('la soirée n’est pas finie avant la dernière manche', s.over === false);
    manche(Blindtest, ['Alice', 'Bruno', 'Chloé'], {
      table: [{ id: 'j1', points: 5000 }, { id: 'j0', points: 1000 }, { id: 'j2', points: 0 }],
      winnerIds: ['j1'],
    });
    check('la dernière manche termine la soirée', s.over === true);
    check('le podium est figé', Boolean(s.result) && s.result.rounds === 3);
    check('le vainqueur est celui du cumul, pas de la dernière manche',
      s.result.winnerIds.join(',') === 'j1', s.result.winnerIds.join(','));
    check('une soirée finie ne compte plus rien',
      s.record(seat(Uno, ['Alice'])) === false);

    const total = s.standings().reduce((n, r) => n + r.points, 0);
    const gained = s.history.reduce((n, h) => n + h.table.reduce((m, l) => m + l.gained, 0), 0);
    check('le classement colle à la somme des manches', total === gained, `${total} = ${gained}`);
  }

  /* ── UN ARRIVANT EN COURS DE ROUTE ── */
  section('Quelqu’un arrive à la deuxième manche');
  {
    const s = new soirees.Soiree(['uno', 'uno'], 'j0');
    const un = seat(Uno, ['Alice', 'Bruno']);
    un.result = { table: [{ id: 'j0', points: 100 }, { id: 'j1', points: 20 }], winnerIds: ['j0'] };
    s.record(un);

    const deux = seat(Uno, ['Alice', 'Bruno', 'Tardif']);
    deux.result = {
      table: [{ id: 'j2', points: 300 }, { id: 'j0', points: 100 }, { id: 'j1', points: 10 }],
      winnerIds: ['j2'],
    };
    s.record(deux);

    const t = Object.fromEntries(s.standings().map((r) => [r.id, r.points]));
    check('le retardataire entre au classement', t.j2 === 10, `${t.j2} pts`);
    check('sans rattraper ceux qui étaient là avant', t.j0 === 16, `${t.j0} pts`);
    check('il est nommé correctement',
      (s.standings().find((r) => r.id === 'j2') || {}).name === 'Tardif');
  }

  /* ── LA SURVIE AU REDÉMARRAGE ── */
  section('La soirée survit à une mise à jour');
  {
    // On repart d'un registre propre : les sections précédentes ont laissé
    // des soirées derrière elles, et on veut compter ce qui est sauvegardé.
    for (const one of [...soirees.soirees.values()]) one.close();

    const s = new soirees.Soiree(['uno', 'belote'], 'j0');
    const g = seat(Uno, ['Alice', 'Bruno']);
    g.result = { table: [{ id: 'j0', points: 90 }, { id: 'j1', points: 40 }], winnerIds: ['j0'] };
    s.record(g);
    s.step = 1;
    s.roomCode = 'ABCD';

    const saved = JSON.parse(JSON.stringify(soirees.saveAll()));
    const before = JSON.stringify(s.state());
    // On efface tout, comme un redémarrage de serveur.
    for (const one of [...soirees.soirees.values()]) one.close();
    check('le registre est bien vide', soirees.soirees.size === 0);

    soirees.restoreAll(saved);
    const back = soirees.get(s.code);
    check('la soirée est retrouvée par son code', Boolean(back));
    check('avec exactement le même état', JSON.stringify(back.state()) === before);
    check('et l’historique intact', back.history.length === 1);
    check('une manche déjà comptée ne se recompte pas au retour',
      back.record(g) === false);

    // Le ménage : une soirée dont le salon a disparu finit par partir.
    const registry = { get: () => null };
    back.createdAt = Date.now() - 60 * 60 * 1000;
    back.history[0].at = Date.now() - 60 * 60 * 1000;
    check('une soirée abandonnée finit par disparaître',
      soirees.sweep(registry) === 1 && soirees.soirees.size === 0);
  }

  /* ── LES GARDE-FOUS ── */
  section('Les garde-fous');
  {
    const s = new soirees.Soiree(['uno', 'belote', 'blindtest'], 'j0');
    check('la première manche est le premier jeu choisi',
      s.games[0] === 'uno' && s.step === -1 && s.nextGame === 'uno');
    s.step = 0;
    check('et la suivante est la deuxième', s.nextGame === 'belote');
    s.step = 2;
    check('après la dernière, il n’y a plus de suivante', s.nextGame === null);
    check('deux jeux au minimum', soirees.MIN_GAMES === 2);
    check('six au maximum', soirees.MAX_GAMES === 6);
    s.close();
  }

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  process.exit(failures ? 1 : 0);
})();
