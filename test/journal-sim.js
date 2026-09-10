'use strict';
/**
 * LE JOURNAL DU LENDEMAIN, ET LE PRIX CITRON.
 *
 * Ce qu'on vérifie ici n'est pas tout à fait un calcul : c'est de
 * l'écriture. Un journal peut être « juste » et parfaitement inutile —
 * s'il dit « 4 joueurs, 12 événements », personne ne le lira deux fois.
 *
 * On vérifie donc trois choses, dans cet ordre d'importance :
 *
 *  1. QU'IL NE PARLE QUE DE CE QUI EST ARRIVÉ. Pas de journal les jours
 *     sans soirée, jamais de « personne n'a joué hier, dommage ».
 *
 *  2. QU'IL CITE DES NOMS ET DES CHIFFRES. Une phrase sans nom propre ne
 *     se raconte pas.
 *
 *  3. QUE LES SEUILS TIENNENT. Un carnet qui retient tout ne retient rien :
 *     une mise de dix pièces multipliée par vingt n'intéresse personne.
 */

const faits = require('../server/faits');
const journal = require('../server/journal');

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

/** Un état de site tout neuf, et un jour de référence. */
const JOUR = '2026-09-09';
const AT = Date.parse(`${JOUR}T21:00:00Z`);

function etat(list) {
  return { faits: { days: { [JOUR]: list } } };
}

const profil = (id, name, coins = 50000) => ({
  id, name, vault: { coins, items: {} },
  stats: { wagered: 0, returned: 0, rounds: 0, biggestWin: 0 },
});

(function main() {
  console.log('Le journal du lendemain — des phrases, pas un tableau\n');

  /* ── LE SILENCE ── */
  section('Quand il ne s’est rien passé');
  {
    check('pas de soirée, pas de journal', journal.pour(etat([]), JOUR) === null);
    check('un état vide non plus', journal.pour({}, JOUR) === null);
    check('et pas de prix Citron sans rien à décerner', journal.citron({}) === null);
  }

  /* ── CE QU'ON RETIENT, ET CE QU'ON JETTE ── */
  section('Ce qui mérite d’être retenu');
  {
    /*
     * On lit le TAMPON du carnet plutôt que d'intercepter `record` : les
     * fonctions du module s'appellent entre elles directement, donc
     * remplacer l'export ne changeait rien et le test observait un tableau
     * qui restait vide — en croyant que rien n'était retenu.
     */
    faits.reset();
    const p = profil('a', 'Momo');
    // Une grosse mise perdue : ça se raconte.
    faits.manche(p, { staked: 20000, returned: 0, game: 'plinko' });
    // Une petite mise multipliée par vingt : personne n'en parlera.
    faits.manche(p, { staked: 10, returned: 200, game: 'plinko' });
    // Une grosse mise multipliée par vingt : là, oui.
    faits.manche(p, { staked: 2000, returned: 60000, game: 'horse house' });
    // Une manche ordinaire : rien.
    faits.manche(p, { staked: 1000, returned: 900, game: 'blackjack' });

    const notes = faits.pending();
    faits.reset();

    check('une grosse perte est retenue', notes.some((n) => n.kind === 'perte' && n.perte === 20000));
    check('un gros multiplicateur est retenu',
      notes.some((n) => n.kind === 'gain' && n.ratio === 30));
    check('une manche ordinaire est ignorée', notes.length === 3, `${notes.length} faits retenus sur 4 manches`);
    check('une perte de dix pièces n’est pas un événement',
      !notes.some((n) => n.kind === 'perte' && n.perte < 100));
  }

  /* ── LES PHRASES ── */
  section('Ce que ça donne à lire');
  {
    const page = journal.pour(etat([
      { kind: 'gain', at: AT, id: 'a', name: 'Momo', game: 'horse house', staked: 2000, gain: 68000, ratio: 34 },
      { kind: 'perte', at: AT - 900000, id: 'a', name: 'Momo', game: 'plinko', perte: 40000 },
      { kind: 'serie', at: AT - 600000, id: 'b', name: 'Léa', game: 'blackjack', longueur: 7 },
      { kind: 'party', at: AT - 300000, game: 'uno', gameName: 'Uno', winners: [{ id: 'b', name: 'Léa' }], players: 4 },
      { kind: 'party', at: AT - 200000, game: 'uno', gameName: 'Uno', winners: [{ id: 'b', name: 'Léa' }], players: 4 },
      { kind: 'caisse', at: AT - 100000, id: 'c', name: 'Ana', item: 'Le Grand Ratio', rarete: 'MYTHIQUE' },
    ]), JOUR);

    check('il y a un journal', Boolean(page));
    console.log(`\n    « ${page.texte} »\n`);

    check('il cite des noms', /Momo|Léa|Ana/.test(page.texte));
    check('il cite des chiffres', /\d/.test(page.texte));
    check('il raconte le meilleur coup', /68\s?000|34 fois/.test(page.texte), 'le gain à 34×');
    check('et la chute qui va avec', /40\s?000/.test(page.texte));
    check('il relève la série de défaites', /7 défaites/.test(page.texte));
    check('il note qui domine la Party', /Léa a gagné 2 parties/.test(page.texte));
    check('et la trouvaille rare', /Le Grand Ratio/.test(page.texte));
    check('il désigne une vedette', page.vedette && page.vedette.name === 'Momo',
      page.vedette ? page.vedette.name : '—');
    check('il tient en quelques phrases', page.lignes.length <= 7, `${page.lignes.length} lignes`);

    // Le même joueur qui perd puis regagne : la phrase doit le relier.
    check('il relie la chute au gain du même joueur',
      /avait pourtant laissé/.test(page.texte),
      'sinon on lit deux faits sans rapport');
  }

  /* ── UNE SOIRÉE À UN SEUL JOUEUR ── */
  section('Une soirée en solitaire');
  {
    const page = journal.pour(etat([
      { kind: 'perte', at: AT, id: 'a', name: 'Momo', game: 'roulette', perte: 12000 },
    ]), JOUR);
    check('elle a droit à son journal', Boolean(page));
    check('et il ne prétend pas qu’ils étaient plusieurs',
      /solitaire/.test(page.texte) && !/2 joueurs/.test(page.texte), page.texte);
  }

  /* ── LE PRIX CITRON ── */
  section('Le prix Citron');
  {
    const now = Date.parse('2026-09-10T10:00:00Z');
    const state = {
      faits: {
        days: {
          [faits.jour(now - 86400000)]: [
            { kind: 'perte', at: now - 86400000, id: 'a', name: 'Momo', game: 'plinko', perte: 90000 },
          ],
          [faits.jour(now - 2 * 86400000)]: [
            { kind: 'serie', at: now - 2 * 86400000, id: 'b', name: 'Léa', game: 'blackjack', longueur: 9 },
          ],
        },
      },
    };
    const prix = journal.citron(state, now);
    check('un prix est décerné', Boolean(prix));
    console.log(`\n    🍋 ${prix.titre} — ${prix.name} : ${prix.texte}\n`);
    check('il a un lauréat nommé', Boolean(prix.name));
    check('il a un titre', Boolean(prix.titre));
    check('et il explique pourquoi', /\d/.test(prix.texte));
    check('la plus grosse chute l’emporte sur une longue série',
      prix.name === 'Momo', `${prix.name} (${prix.titre})`);

    // Le bredouille : une semaine de faits marquants, aucun gain.
    const bredouille = journal.citron({
      faits: { days: { [faits.jour(now)]: [
        { kind: 'perte', at: now, id: 'c', name: 'Ana', game: 'slots', perte: 900 },
        { kind: 'serie', at: now, id: 'c', name: 'Ana', game: 'slots', longueur: 5 },
      ] } },
    }, now);
    check('une semaine sans le moindre gain a son titre',
      Boolean(bredouille) && bredouille.name === 'Ana',
      bredouille ? `${bredouille.titre} — ${bredouille.name}` : '—');
  }

  /* ── LA MÉMOIRE COURTE ── */
  section('Le carnet oublie');
  {
    const now = Date.now();
    const state = { faits: { days: {
      [faits.jour(now)]: [{ kind: 'gain', at: now }],
      [faits.jour(now - 3 * 86400000)]: [{ kind: 'gain', at: now }],
      [faits.jour(now - 40 * 86400000)]: [{ kind: 'gain', at: now }],
    } } };
    faits.prune(state, now);
    const restants = Object.keys(state.faits.days).length;
    check('ce qui a plus de quinze jours est oublié', restants === 2, `${restants} jours gardés sur 3`);
    check('un site entre potes n’a pas besoin d’archives', faits.KEEP_DAYS <= 30,
      `${faits.KEEP_DAYS} jours de mémoire`);
  }

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  process.exit(failures ? 1 : 0);
})();
