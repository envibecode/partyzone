'use strict';
/**
 * LES PARIS ET LES DUELS — L'ARITHMÉTIQUE, SANS SERVEUR.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE BANC D'ESSAI EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 * Le banc d'essai en ligne (`rivalites-live.js`) branche de vrais clients
 * et vérifie que la plomberie tient. Mais il ne peut PAS vérifier les
 * comptes : sur un vrai serveur, une partie terminée verse aussi des
 * niveaux de rang Party et des défis du jour, et ces pièces-là tombent dans
 * la même bourse au même moment. On croirait qu'un pari crée de l'argent.
 *
 * Ici, il n'y a que le pot. Et c'est là que se vérifie la seule chose qui
 * compte vraiment :
 *
 *   CE QUI EST VERSÉ ÉGALE EXACTEMENT CE QUI A ÉTÉ MISÉ. À la pièce près,
 *   arrondis compris, sur des milliers de pots tirés au hasard.
 *
 * Un pot mutuel qui perd trois pièces par arrondi, c'est trois pièces
 * détruites à chaque partie — invisible pendant un mois, et une économie
 * qui fuit au bout d'un an. Un pot qui en rend une de trop, c'est
 * l'inverse : une machine à fabriquer de l'argent qu'il suffit de faire
 * tourner.
 */

const paris = require('../server/paris');
const defis = require('../server/defis');

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

/* Un générateur reproductible : un échec doit pouvoir se rejouer. */
let seed = 20260910;
function rnd() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = (n) => Math.floor(rnd() * n);

const salon = (code, joueurs) => ({
  code, game: 'uno', gameName: 'Uno',
  players: joueurs.map((id) => ({ id, name: id.toUpperCase() })),
});

(function main() {
  console.log('Les paris et les duels — l’arithmétique\n');

  /* ══════════ LA RÈGLE QUI TIENT TOUT ══════════ */
  section('On ne parie jamais contre soi-même');
  {
    const room = salon('AAAA', ['a', 'b', 'c']);
    const pot = paris.open(room);

    const contre = paris.place(pot, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, 500, { joueur: true });
    check('un joueur ne peut pas miser sur son adversaire', !contre.ok, contre.message);

    const soi = paris.place(pot, { id: 'a', name: 'A' }, { id: 'a', name: 'A' }, 500, { joueur: true });
    check('mais il peut miser sur lui-même', soi.ok);

    const dehors = paris.place(pot, { id: 'z', name: 'Z' }, { id: 'b', name: 'B' }, 500, { joueur: false });
    check('celui qui ne joue pas mise sur qui il veut', dehors.ok);

    const deux = paris.place(pot, { id: 'z', name: 'Z' }, { id: 'c', name: 'C' }, 500, { joueur: false });
    check('mais sur un seul cheval', !deux.ok, deux.message);

    const petit = paris.place(pot, { id: 'y', name: 'Y' }, { id: 'b', name: 'B' }, 3, { joueur: false });
    check('une mise ridicule est refusée', !petit.ok, petit.message);

    const gros = paris.place(pot, { id: 'x', name: 'X' }, { id: 'b', name: 'B' }, 999999, { joueur: false });
    check('une mise démesurée aussi', !gros.ok, gros.message);

    paris.close(pot);
    const tard = paris.place(pot, { id: 'w', name: 'W' }, { id: 'b', name: 'B' }, 500, { joueur: false });
    check('et plus personne ne mise une fois la partie lancée', !tard.ok, tard.message);
  }

  /* ══════════ LE POT RESSORT ENTIER ══════════ */
  section('Le pot ressort entier — 3 000 pots au hasard');
  {
    let pires = { ecart: 0, ou: '' };
    let verifies = 0;
    let rembourses = 0;
    let sansGagnant = 0;

    for (let n = 0; n < 3000; n++) {
      const joueurs = ['a', 'b', 'c', 'd'].slice(0, 2 + pick(3));
      const room = salon(`P${n}`, joueurs);
      const pot = paris.open(room);

      // Entre un et six parieurs, des montants tordus exprès : ce sont les
      // arrondis qu'on cherche, pas les cas ronds.
      const parieurs = 1 + pick(6);
      for (let k = 0; k < parieurs; k++) {
        const qui = { id: `p${k}`, name: `P${k}` };
        const sur = joueurs[pick(joueurs.length)];
        const montant = paris.MIN_MISE + pick(4000) + (pick(2) ? 7 : 0);
        paris.place(pot, qui, { id: sur, name: sur.toUpperCase() }, montant, { joueur: false });
      }

      const mise = paris.total(pot);
      // Un classement au hasard, avec parfois une égalité en tête, et
      // parfois un joueur qui a quitté la table avant le début.
      const partants = pick(10) === 0 ? joueurs.slice(0, joueurs.length - 1) : joueurs;
      const scores = partants.map((id) => ({ id, score: pick(3) }));
      const res = paris.settle(pot, scores);

      const verse = res.payouts.reduce((s, p) => s + p.amount, 0);
      const ecart = Math.abs(verse - mise);
      if (ecart > pires.ecart) pires = { ecart, ou: `pot ${pot.code}` };
      if (res.refund) rembourses += 1;
      if (!res.winners.length) sansGagnant += 1;
      verifies += 1;

      // Personne ne doit toucher plus que le pot entier.
      for (const p of res.payouts) {
        if (p.amount > mise) { pires = { ecart: p.amount - mise, ou: `un parieur seul dépasse le pot` }; }
      }
      paris.pots.delete(pot.code);
    }

    check('ce qui est versé égale ce qui est misé, toujours', pires.ecart === 0,
      pires.ecart ? `${pires.ecart} pièces d’écart (${pires.ou})` : `${verifies} pots`);
    check('les pots sans gagnant sont remboursés, pas confisqués',
      rembourses >= sansGagnant, `${rembourses} remboursés pour ${sansGagnant} sans vainqueur`);
  }

  /* ══════════ LE PRORATA ══════════ */
  section('Le partage au prorata');
  {
    const room = salon('BBBB', ['a', 'b']);
    const pot = paris.open(room);
    paris.place(pot, { id: 'x', name: 'X' }, { id: 'a', name: 'A' }, 300, {});
    paris.place(pot, { id: 'y', name: 'Y' }, { id: 'a', name: 'A' }, 100, {});
    paris.place(pot, { id: 'z', name: 'Z' }, { id: 'b', name: 'B' }, 600, {});

    const res = paris.settle(pot, [{ id: 'a', score: 2 }, { id: 'b', score: 1 }]);
    const part = (id) => (res.payouts.find((p) => p.id === id) || {}).amount || 0;

    check('le pot fait bien la somme des mises', res.pot === 1000, `${res.pot}`);
    check('celui qui a misé trois fois plus touche trois fois plus',
      part('x') === 750 && part('y') === 250, `${part('x')} et ${part('y')}`);
    check('celui qui s’est trompé ne touche rien', part('z') === 0);
    check('et le total versé fait le pot', part('x') + part('y') === 1000);
    paris.pots.delete(pot.code);
  }

  /* ══════════ LE CHEVAL QUI NE PREND PAS LE DÉPART ══════════ */
  section('Le joueur qui s’en va avant le début');
  {
    const room = salon('CCCC', ['a', 'b']);
    const pot = paris.open(room);
    paris.place(pot, { id: 'x', name: 'X' }, { id: 'a', name: 'A' }, 500, {});
    paris.place(pot, { id: 'y', name: 'Y' }, { id: 'b', name: 'B' }, 500, {});

    // « a » a quitté le salon : il n'est pas dans le classement.
    const res = paris.settle(pot, [{ id: 'b', score: 1 }]);
    const part = (id) => (res.payouts.find((p) => p.id === id) || {}).amount || 0;

    check('la mise sur l’absent est rendue', part('x') === 500, `${part('x')}`);
    check('elle ne tombe pas dans le pot des autres', part('y') === 500, `${part('y')}`);
    check('rien ne se perd', part('x') + part('y') === 1000);
    paris.pots.delete(pot.code);
  }

  /* ══════════ LA PARTIE QUI N'A PAS LIEU ══════════ */
  section('La partie qui n’a jamais lieu');
  {
    const room = salon('DDDD', ['a', 'b']);
    const pot = paris.open(room);
    paris.place(pot, { id: 'x', name: 'X' }, { id: 'a', name: 'A' }, 700, {});
    paris.place(pot, { id: 'y', name: 'Y' }, { id: 'b', name: 'B' }, 300, {});

    const res = paris.cancel(pot, 'salon fermé');
    const somme = res.payouts.reduce((s, p) => s + p.amount, 0);
    check('tout le monde récupère sa mise, au centime', somme === 1000, `${somme}`);
    check('et personne ne gagne rien au passage',
      res.payouts.every((p) => p.amount === p.mise));

    const rejoue = paris.settle(pot, [{ id: 'a', score: 1 }]);
    check('un pot déjà réglé ne se règle pas deux fois', rejoue === null);
    paris.pots.delete(pot.code);
  }

  /* ══════════ LES DUELS ══════════ */
  section('Le duel : à somme nulle, ou rien');
  {
    const A = { id: 'a', name: 'Ana' };
    const B = { id: 'b', name: 'Bruno' };

    check('on ne se défie pas soi-même',
      !defis.create({ from: A, to: A, game: 'uno', stake: 100 }).ok);
    check('la belote ne se joue pas à deux',
      !defis.create({ from: A, to: B, game: 'belote', stake: 100 }).ok);

    const { defi } = defis.create({ from: A, to: B, game: 'uno', stake: 1000 });
    check('un défi part en attente', defi.status === 'pending');
    check('le lanceur ne peut pas accepter son propre défi',
      !defis.accept(defi.id, A.id).ok);

    const ok = defis.accept(defi.id, B.id);
    check('l’autre accepte', ok.ok && defi.status === 'live');
    check('le séquestre vaut les deux mises', defi.escrow === 2000, `${defi.escrow}`);

    const res = defis.settle(defi, [{ id: 'a', score: 3 }, { id: 'b', score: 1 }]);
    check('le vainqueur prend tout', res.winner === 'a' && res.pot === 2000,
      `${res.winner} : ${res.pot}`);
    check('ce que l’un gagne, l’autre l’a perdu', res.pot === defi.stake * 2);
    check('un duel réglé ne se règle pas deux fois',
      defis.settle(defi, [{ id: 'b', score: 9 }]) === null);
    defis.defis.delete(defi.id);

    // L'égalité.
    const nul = defis.create({ from: A, to: B, game: 'uno', stake: 400 }).defi;
    defis.accept(nul.id, B.id);
    const egal = defis.settle(nul, [{ id: 'a', score: 2 }, { id: 'b', score: 2 }]);
    check('une égalité rend les mises', egal.refund && egal.winner === null && egal.pot === 0);
    defis.defis.delete(nul.id);

    // L'abandon.
    const perdu = defis.create({ from: A, to: B, game: 'uno', stake: 400 }).defi;
    defis.accept(perdu.id, B.id);
    const abandon = defis.abort(perdu, 'salon disparu');
    check('un duel dont la partie s’évapore rend tout', abandon.refund && abandon.pot === 0);
    check('et il ne peut plus être réglé après',
      defis.settle(perdu, [{ id: 'a', score: 5 }]) === null);
    defis.defis.delete(perdu.id);

    // Celui qui s'en va perd.
    const fuite = defis.create({ from: A, to: B, game: 'uno', stake: 400 }).defi;
    defis.accept(fuite.id, B.id);
    const parti = defis.settle(fuite, [{ id: 'a', score: 1 }]);
    check('celui qui quitte la partie la perd', parti.winner === 'a', String(parti.winner));
    defis.defis.delete(fuite.id);
  }

  /* ══════════ LE FACE-À-FACE ══════════ */
  section('Le face-à-face compte dans le bon sens');
  {
    const face = require('../server/faceaface');
    const state = {};
    const room = {
      code: 'EEEE', game: 'uno', gameName: 'Uno',
      players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bruno' }, { id: 'c', name: 'Chloé' }],
      ranking: () => [{ id: 'a', score: 3 }, { id: 'b', score: 2 }, { id: 'c', score: 1 }],
    };

    const paires = face.record(state, room);
    check('une partie à trois écrit trois rivalités', paires === 3, `${paires}`);

    const ab = face.between(state, 'a', 'b');
    const ba = face.between(state, 'b', 'a');
    check('Ana a fini devant Bruno', ab.moi === 1 && ab.lui === 0);
    check('et vu de Bruno, c’est l’inverse', ba.moi === 0 && ba.lui === 1);
    check('même quand aucun des deux n’a gagné la partie',
      face.between(state, 'b', 'c').moi === 1, 'finir troisième devant le quatrième, ça compte');

    // Trois parties de plus, dans l'autre sens.
    room.ranking = () => [{ id: 'b', score: 5 }, { id: 'a', score: 1 }, { id: 'c', score: 0 }];
    face.record(state, room);
    face.record(state, room);
    const apres = face.between(state, 'a', 'b');
    check('les parties s’additionnent', apres.joues === 3, `${apres.joues}`);
    check('et le compte suit', apres.moi === 1 && apres.lui === 2, `${apres.moi}-${apres.lui}`);
    check('le détail par jeu tient debout',
      apres.games[0].moi + apres.games[0].lui + apres.games[0].nul === apres.joues);

    const egalite = {
      ...room,
      ranking: () => [{ id: 'a', score: 2 }, { id: 'b', score: 2 }],
      players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bruno' }],
    };
    face.record(state, egalite);
    const nul = face.between(state, 'a', 'b');
    check('une égalité n’est une victoire pour personne', nul.nul === 1 && nul.moi === 1 && nul.lui === 2);

    check('la phrase de résumé nomme celui qui mène',
      face.resume(nul, 'Ana', 'Bruno').includes('Bruno'), face.resume(nul, 'Ana', 'Bruno'));
    check('et ne ment pas quand personne n’a joué',
      face.resume({ joues: 0, moi: 0, lui: 0, nul: 0, games: [], last: [] }, 'Ana', 'Bruno')
        .includes('jamais'));
  }

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  process.exit(failures ? 1 : 0);
})();
