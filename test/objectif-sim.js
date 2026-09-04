'use strict';
/**
 * LE BUT DU SITE, VÉRIFIÉ.
 *
 * Le classement du mois décide d'un vrai lot. Il vaut donc mieux qu'il
 * compte ce qu'on croit qu'il compte — et rien d'autre.
 *
 * Quatre choses doivent tenir, et ce sont les quatre par lesquelles on
 * pourrait gagner sans jouer le jeu :
 *
 *  • le classement se joue à l'XP, pas aux pièces (amasser sans ouvrir de
 *    caisse ne doit rapporter aucune place) ;
 *  • l'XP de la section Party n'entre jamais dedans ;
 *  • une correction d'administrateur ne fait pas gagner le mois ;
 *  • le compteur repart à zéro au changement de mois, et le vainqueur du
 *    mois écoulé est celui qui avait le plus d'XP.
 */

const season = require('../server/season');
const partyRank = require('../server/party/rank');

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

/** Un profil nu, comme le magasin en fabrique un. */
function profile(id, name) {
  return {
    id, name, avatar: null, xp: 0,
    party: partyRank.blank(),
    // Le rang Party paie ses paliers en pièces : il lui faut un coffre.
    vault: { coins: 0, items: {}, opened: 0 },
    season: null,
    banned: false,
  };
}

(function main() {
  console.log('Le but du site — l’XP, et rien qu’elle\n');

  /* ── LE COMPTEUR ── */
  section('Le compteur du mois');
  {
    const p = profile('a', 'Ana');
    season.recordXp(p, 120);
    season.recordXp(p, 80);
    check('l’XP s’additionne', p.season.xp === 200, `${p.season.xp}`);

    // Une reprise d'XP (correction) ne doit pas retirer des places déjà
    // gagnées : on ne compte que ce qui a été gagné.
    season.recordXp(p, -500);
    check('une valeur négative ne retire rien', p.season.xp === 200, `${p.season.xp}`);

    // Le bénéfice reste tenu, mais séparément.
    season.record(p, { profit: 5000, staked: 20000, rounds: 4 });
    check('le bénéfice est compté à part', p.season.coins === 5000 && p.season.xp === 200,
      `${p.season.coins} ¤ et ${p.season.xp} XP`);
    check('les manches jouées sont comptées', p.season.rounds === 4);

    // Un profil écrit avant le passage à l'XP n'a pas le champ.
    const vieux = profile('v', 'Vieux');
    vieux.season = { month: season.monthKey(), coins: 9999, wagered: 0, rounds: 0, best: 0 };
    season.recordXp(vieux, 10);
    check('un vieux profil sans champ XP ne casse rien',
      vieux.season.xp === 10, `${vieux.season.xp}`);
  }

  /* ── LE CLASSEMENT ── */
  section('Ce que le classement récompense');
  {
    // Le cas qui compte : le prudent amasse, le joueur ouvre des caisses.
    const prudent = profile('p', 'Prudent');
    season.record(prudent, { profit: 900000, staked: 1000, rounds: 1 });

    const joueur = profile('j', 'Joueur');
    season.record(joueur, { profit: -40000, staked: 200000, rounds: 300 });
    season.recordXp(joueur, 12000);   // il a tout remis dans les caisses

    const ranked = season.ranking([prudent, joueur], 10);
    check('celui qui ouvre des caisses passe devant celui qui thésaurise',
      ranked.length === 1 && ranked[0].id === 'j',
      ranked.map((r) => `${r.name} ${r.xp} XP`).join(', '));
    check('le riche sans XP n’est même pas classé',
      !ranked.some((r) => r.id === 'p'),
      `${prudent.season.coins} ¤ et ${prudent.season.xp} XP`);
    check('le classement affiche l’XP', ranked[0].xp === 12000, `${ranked[0].xp}`);
    check('et garde le bénéfice comme statistique', ranked[0].coins === -40000);

    // L'ordre, sur trois joueurs.
    const a = profile('a', 'Ana'); season.recordXp(a, 500);
    const b = profile('b', 'Bruno'); season.recordXp(b, 900);
    const c = profile('c', 'Chloe'); season.recordXp(c, 700);
    const trio = season.ranking([a, b, c], 10);
    check('les places suivent l’XP',
      trio.map((r) => r.name).join(',') === 'Bruno,Chloe,Ana',
      trio.map((r) => `${r.name} ${r.xp}`).join(' · '));

    // Un joueur banni ne figure nulle part.
    const banni = profile('x', 'Banni');
    season.recordXp(banni, 99999);
    banni.banned = true;
    check('un joueur banni est hors classement',
      !season.ranking([a, b, c, banni], 10).some((r) => r.id === 'x'));
  }

  /* ── LA PARTY EST À PART ── */
  section('L’XP de la Party ne compte pas pour le lot');
  {
    const p = profile('a', 'Ana');
    // Vingt parties Party gagnées : le rang Party monte, et rien d'autre.
    for (let i = 0; i < 20; i++) {
      partyRank.record(p, 'uno', { won: true, players: 4, rounds: 5 });
    }
    check('le rang Party a bien monté', p.party.xp > 0, `${p.party.xp} XP Party`);
    check('l’XP du site n’a pas bougé', p.xp === 0, `${p.xp}`);
    // Le rang Party paie ses paliers en pièces, et c'est voulu : les pièces
    // sont un moyen, pas le but. Ce qui ne doit pas bouger, c'est l'XP.
    check('il peut payer des pièces, ça n’est pas de l’XP',
      typeof p.vault.coins === 'number', `${p.vault.coins} ¤ gagnés en Party`);
    check('le compteur du mois n’a pas bougé',
      !p.season || (p.season.xp || 0) === 0,
      p.season ? `${p.season.xp} XP` : 'aucun compteur');
    check('une soirée entière de Party ne classe personne',
      season.ranking([p], 10).length === 0);
  }

  /* ── LA BASCULE DE MOIS ── */
  section('Le changement de mois');
  {
    const passe = season.monthKey(new Date(Date.UTC(2026, 7, 15)));   // août 2026
    const mk = (id, name, xp, coins) => ({
      ...profile(id, name),
      season: { month: passe, xp, coins, wagered: 0, rounds: 10, best: 0 },
    });
    const gagnant = mk('g', 'Gagnant', 8000, -50000);
    const riche = mk('r', 'Riche', 100, 900000);

    const state = { month: passe, hallOfFame: [] };
    const now = Date.UTC(2026, 8, 1, 0, 5, 0);   // 1er septembre
    const winner = season.rollover(state, [gagnant, riche], now);

    check('le mois bascule', Boolean(winner) && state.month === season.monthKey(new Date(now)));
    check('le vainqueur est celui qui a le plus d’XP',
      winner && winner.id === 'g', winner ? `${winner.name} (${winner.xp} XP)` : '—');
    check('le plus riche ne gagne pas', !winner || winner.id !== 'r');
    check('le palmarès garde l’XP du vainqueur',
      state.hallOfFame[0] && state.hallOfFame[0].xp === 8000);
    check('le lot n’est pas remis par le site',
      state.hallOfFame[0] && state.hallOfFame[0].delivered === false);

    // Le compteur du joueur repart à zéro au premier appel du mois suivant.
    season.ensure(gagnant, now);
    check('le compteur repart à zéro le mois suivant',
      gagnant.season.xp === 0 && gagnant.season.coins === 0);

    // Et un mois où personne n'a marqué ne désigne personne.
    const vide = { month: passe, hallOfFame: [] };
    check('un mois sans XP ne désigne aucun vainqueur',
      season.rollover(vide, [mk('z', 'Zero', 0, 500000)], now) === null);
  }

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  process.exit(failures ? 1 : 0);
})();
