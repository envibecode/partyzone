'use strict';
/**
 * LE MOIS : LA CIBLE, ET LES 48 DERNIÈRES HEURES.
 *
 * Deux mécaniques qui touchent au CLASSEMENT DU MOIS, c'est-à-dire à la
 * seule chose que le site met en jeu. Elles n'ont donc pas droit à
 * l'à-peu-près, et deux dérives sont à surveiller de près :
 *
 *  1. LA DERNIÈRE LIGNE DROITE NE DOIT PAS RÉCOMPENSER LA NUIT BLANCHE.
 *     Un multiplicateur pendant 48 heures, c'est une course d'endurance :
 *     celui qui reste debout gagne. Le bonus est donc plafonné EN NOMBRE DE
 *     CAISSES, et ce plafond est ce qu'on vérifie ici — la onzième caisse
 *     doit rapporter exactement ce qu'elle rapporte un mardi ordinaire.
 *
 *  2. LA PRIME DE LA CIBLE NE DOIT PAS DEVENIR UN DISTRIBUTEUR. Deux amis
 *     qui ouvrent un salon à deux, l'un perdant exprès, ne doivent rien
 *     toucher — d'où le minimum de trois joueurs et le quota quotidien.
 */

const finale = require('../server/finale');
const cible = require('../server/cible');
const season = require('../server/season');

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

const profil = (id, name, xp = 0) => ({
  id, name, avatar: null, banned: false,
  vault: { coins: 1000, items: {} },
  season: { month: season.monthKey(new Date()), xp, coins: 0, wagered: 0, rounds: 0, best: 0 },
});

(function main() {
  console.log('Le mois — la cible et la dernière ligne droite\n');

  /* ══════════ LA FENÊTRE ══════════ */
  section('Quand commence la dernière ligne droite');
  {
    const fin = season.nextReset(new Date());
    const dedans = fin - 3600000;          // une heure avant la bascule
    const dehors = fin - 5 * 86400000;     // cinq jours avant

    check('elle dure bien deux jours', finale.WINDOW_MS === 48 * 3600000);
    check('à une heure de la fin, on y est', finale.active(dedans));
    check('cinq jours avant, non', !finale.active(dehors));
    check('elle se termine exactement à la bascule du mois',
      finale.endsAt(dedans) === fin, new Date(fin).toISOString());
  }

  /* ══════════ LE PLAFOND ══════════ */
  section('Le bonus est plafonné en caisses, pas en heures');
  {
    const dedans = season.nextReset(new Date()) - 3600000;
    const p = profil('a', 'Momo');

    // Dix caisses ouvertes une par une, à 100 XP chacune.
    let bonus = 0;
    for (let i = 0; i < finale.CASES; i++) bonus += finale.bonus(p, 100, 1, dedans).xp;
    check('les dix premières caisses touchent le bonus',
      bonus === finale.CASES * 100 * (finale.MULT - 1), `${bonus} XP de bonus`);

    const onzieme = finale.bonus(p, 100, 1, dedans);
    check('la onzième ne rapporte plus rien de plus', onzieme.xp === 0, `${onzieme.xp}`);
    check('et le site le dit clairement', onzieme.left === 0);

    // Et la nuit entière ? Cent caisses de plus : toujours rien.
    let apres = 0;
    for (let i = 0; i < 100; i++) apres += finale.bonus(p, 100, 1, dedans).xp;
    check('cent caisses de plus ne rapportent pas un point de bonus', apres === 0,
      'une nuit blanche ne bat pas quelqu’un qui a joué un quart d’heure');
  }

  section('Une ouverture multiple ne triche pas');
  {
    const dedans = season.nextReset(new Date()) - 3600000;
    const p = profil('b', 'Léa');

    // Cinq caisses d'un coup, puis dix : seules dix au total sont boostées.
    const un = finale.bonus(p, 500, 5, dedans);   // 5 caisses, 100 XP chacune
    check('cinq caisses d’un coup consomment cinq du quota', un.cases === 5, `${un.cases}`);
    check('et le bonus porte sur les cinq', un.xp === Math.round(500 * (finale.MULT - 1)), `${un.xp}`);

    const deux = finale.bonus(p, 1000, 10, dedans); // 10 demandées, 5 disponibles
    check('les cinq dernières seulement sont boostées', deux.cases === 5, `${deux.cases}`);
    check('le bonus est calculé sur ces cinq-là, pas sur les dix',
      deux.xp === Math.round(500 * (finale.MULT - 1)), `${deux.xp} au lieu de ${Math.round(1000 * (finale.MULT - 1))}`);
  }

  section('Hors période, rien du tout');
  {
    const dehors = season.nextReset(new Date()) - 10 * 86400000;
    const p = profil('c', 'Ana');
    const rien = finale.bonus(p, 5000, 10, dehors);
    check('aucun bonus le 12 du mois', rien.xp === 0);
    check('et le quota reste intact pour la fin du mois',
      finale.left(p, dehors) === finale.CASES, `${finale.left(p, dehors)}`);
  }

  /* ══════════ LA CIBLE ══════════ */
  section('Qui porte la cible');
  {
    check('personne quand il n’y a qu’un joueur',
      cible.designate([profil('a', 'Momo', 4000)]) === null);
    check('personne non plus quand le classement est vide',
      cible.designate([]) === null);

    const table = [profil('a', 'Momo', 4000), profil('b', 'Léa', 9000), profil('c', 'Ana', 1200)];
    const c = cible.designate(table);
    check('c’est le premier du mois', c && c.name === 'Léa', c ? c.name : '—');
    check('et on sait de combien il mène', c.avance === 5000, `${c.avance}`);
  }

  section('Qui touche la prime');
  {
    const c = { id: 'b', name: 'Léa' };

    check('personne si la cible n’était pas de la partie',
      cible.vainqueurs(c, [{ id: 'a', score: 3 }, { id: 'x', score: 1 }, { id: 'y', score: 0 }]).length === 0);

    check('personne à deux joueurs — sinon c’est un distributeur',
      cible.vainqueurs(c, [{ id: 'a', score: 3 }, { id: 'b', score: 1 }]).length === 0,
      `il faut ${cible.MIN_JOUEURS} joueurs`);

    const gagnants = cible.vainqueurs(c, [
      { id: 'a', score: 5 }, { id: 'b', score: 3 }, { id: 'x', score: 4 }, { id: 'y', score: 1 },
    ]);
    check('tous ceux qui finissent devant elle touchent',
      gagnants.length === 2 && gagnants.includes('a') && gagnants.includes('x'), gagnants.join(', '));
    check('celui qui finit derrière ne touche rien', !gagnants.includes('y'));
    check('et la cible ne se paie pas elle-même', !gagnants.includes('b'));

    const exaequo = cible.vainqueurs(c, [
      { id: 'a', score: 3 }, { id: 'b', score: 3 }, { id: 'x', score: 1 },
    ]);
    check('une égalité avec la cible ne suffit pas', exaequo.length === 0,
      'il faut finir DEVANT, pas à côté');
  }

  section('Le quota quotidien');
  {
    const p = profil('a', 'Momo');
    const avant = p.vault.coins;
    const versements = [];
    for (let i = 0; i < 5; i++) versements.push(cible.verser(p).paid);

    check('deux primes par jour, pas trois',
      versements.filter((v) => v > 0).length === cible.MAX_PAR_JOUR,
      versements.join('/'));
    check('la prime est bien versée', p.vault.coins === avant + cible.PRIME * cible.MAX_PAR_JOUR,
      `${p.vault.coins - avant} pièces`);

    // Le lendemain, le compteur repart.
    const demain = Date.now() + 86400000;
    check('le lendemain, le compteur repart', cible.verser(p, demain).paid === cible.PRIME);
  }

  section('La prime ne touche jamais au classement');
  {
    const p = profil('a', 'Momo', 500);
    const xpAvant = p.season.xp;
    cible.verser(p);
    check('battre la cible ne donne pas un point d’XP', p.season.xp === xpAvant,
      'sinon la section Party déciderait du lot du mois');
    check('elle donne des pièces, et il faudra les jouer', p.vault.coins > 1000);
  }

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  process.exit(failures ? 1 : 0);
})();
