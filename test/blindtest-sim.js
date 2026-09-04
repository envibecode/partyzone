'use strict';
/**
 * SIMULATEUR DE BLINDTEST.
 *
 * On instancie le moteur avec une fausse playlist et on joue des parties
 * entières. Aucun YouTube n'est nécessaire : le serveur ne joue pas de
 * musique, il tire des extraits, fabrique des propositions et compte les
 * points. C'est exactement ce qu'on vérifie ici.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES QUATRE INVARIANTS
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  1. LA RÉPONSE N'EST JAMAIS ENVOYÉE PENDANT L'ÉCOUTE.
 *     Ni le titre, ni l'index de la bonne proposition. C'est le seul
 *     secret du jeu, et le seul que le serveur puisse vraiment garder.
 *
 *  2. LA BONNE RÉPONSE EST TOUJOURS DANS LES PROPOSITIONS.
 *     Un blindtest où le bon titre manque est un blindtest injouable, et
 *     c'est le genre de bug qu'on ne voit qu'une fois sur trente manches.
 *
 *  3. ON NE RÉPOND QU'UNE FOIS.
 *     Sinon il suffit de cliquer les quatre propositions.
 *
 *  4. LE BARÈME EST MONOTONE.
 *     Répondre plus vite ne rapporte jamais moins. Et même la dernière
 *     seconde rapporte quelque chose : sinon la manche est finie pour soi
 *     dès qu'on est doublé.
 */

const { Blindtest, LEVELS, cleanTitle, BEST, FLOOR, FIRST_BONUS } = require('../server/party/blindtest');

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

const io = { to: () => ({ emit: () => {} }) };

/** Une fausse playlist : dix artistes, quatre morceaux chacun. */
function fakeTracks(n = 40) {
  const artists = ['Daft Punk', 'Orelsan', 'Stromae', 'Gojira', 'Angèle', 'PNL', 'Justice', 'Air', 'Phoenix', 'Christine'];
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = artists[i % artists.length];
    out.push({
      id: `vid${String(i).padStart(4, '0')}`,
      // Les numéros sont rembourrés : sans ça « Morceau 1 » serait un
      // morceau de « Morceau 11 » et la détection de fuite crierait au loup.
      title: `${a} - Morceau ${String(i + 1).padStart(3, '0')} (Official Video)`,
      author: a,
    });
  }
  return out;
}

function table(names, level = 'moyen') {
  const game = new Blindtest(io);
  names.forEach((name, i) => game.join({ id: 'j' + i, name, avatar: null }, {}, 's' + i));
  game.configure('j0', { level, rounds: 10 });
  game.setPlaylist('j0', { id: 'PLtest', title: 'Soirée', tracks: fakeTracks() });
  return game;
}

/* ═══════════ Le secret ═══════════ */

function noLeak(game, where) {
  if (game.phase !== 'ecoute' || !game.current) return true;
  const title = game.current.track.title;
  for (const p of game.players) {
    const s = game.stateFor(p.id);
    const json = JSON.stringify(s);
    if (s.current.answer !== undefined) {
      console.log(`  ✗ fuite (${where}) — l'index de la bonne réponse est envoyé`);
      failures++; return false;
    }
    if (s.current.title !== undefined) {
      console.log(`  ✗ fuite (${where}) — le titre est envoyé pendant l'écoute`);
      failures++; return false;
    }
    if (s.current.author !== undefined) {
      console.log(`  ✗ fuite (${where}) — l'artiste est envoyé comme réponse`);
      failures++; return false;
    }
    if (s.you.right !== undefined || s.board.some((b) => b.right !== undefined)) {
      console.log(`  ✗ fuite (${where}) — on sait déjà qui a juste`);
      failures++; return false;
    }
    // Le titre EST dans les propositions, forcément : c'est le seul endroit
    // où il a le droit d'être. On enlève ce champ-là de l'état, et on relit
    // tout le reste — log, indice, tableau, résultat — pour vérifier qu'il
    // n'a fuité nulle part ailleurs.
    const rest = JSON.parse(json);
    delete rest.current.choices;
    if (JSON.stringify(rest).includes(title)) {
      console.log(`  ✗ fuite (${where}) — le titre traîne hors des propositions`);
      failures++; return false;
    }
  }
  return true;
}

/* ═══════════ Le banc d'essai ═══════════ */

(function main() {
  console.log('Simulateur de blindtest — le titre, et rien que le titre\n');

  /* ── LES TITRES ── */
  section('Le nettoyage des titres YouTube');
  const cases = [
    ['Daft Punk - Around the World (Official Video)', 'Daft Punk - Around the World'],
    ['Stromae - Alors on danse [Official Music Video]', 'Stromae - Alors on danse'],
    ['Angèle - Balance ton quoi (Clip officiel)', 'Angèle - Balance ton quoi'],
    ['Gojira — Stranded (4K Remaster)', 'Gojira — Stranded'],
    ['PNL - Au DD | Lyrics', 'PNL - Au DD'],
    ['Justice - D.A.N.C.E.', 'Justice - D.A.N.C.E.'],
  ];
  cases.forEach(([raw, want]) => {
    const got = cleanTitle(raw);
    check(`« ${raw.slice(0, 42)}… »`, got === want, got);
  });
  check('un titre vide ne passe pas', cleanTitle('   ') === '');
  check('un titre trop long est coupé', cleanTitle('x'.repeat(400)).length === 120);

  /* ── LA PLAYLIST ── */
  section('La playlist, et ce qu’on refuse');
  {
    const g = new Blindtest(io);
    g.join({ id: 'j0', name: 'Hote', avatar: null }, {}, 's0');
    g.join({ id: 'j1', name: 'Autre', avatar: null }, {}, 's1');

    check('un invité ne charge pas la playlist',
      g.setPlaylist('j1', { tracks: fakeTracks() }).ok === false,
      g.setPlaylist('j1', { tracks: fakeTracks() }).message);
    check('une playlist trop courte est refusée',
      g.setPlaylist('j0', { tracks: fakeTracks(3) }).ok === false,
      g.setPlaylist('j0', { tracks: fakeTracks(3) }).message);
    check('des entrées cassées sont jetées sans tout casser',
      g.setPlaylist('j0', { tracks: [
        ...fakeTracks(6),
        { id: '', title: 'vide' },
        { id: 'bon', title: '' },
        { id: 'vid0000', title: 'un doublon' },
        null,
      ] }).ok === true);
    check('les doublons sont écartés', g.tracks.length === 6, `${g.tracks.length} morceaux gardés`);
    check('deux cents morceaux au maximum',
      (g.setPlaylist('j0', { tracks: fakeTracks(400) }), g.tracks.length === 200),
      `${g.tracks.length}`);
    check('on ne peut pas lancer sans playlist', (() => {
      const h = new Blindtest(io);
      h.join({ id: 'j0', name: 'Seul', avatar: null }, {}, 's0');
      return h.start('j0').ok === false;
    })());
  }

  /* ── UNE MANCHE ── */
  section('Une manche');
  {
    const g = table(['Alice', 'Bruno', 'Chloé']);
    g.start('j0');
    check('la partie démarre en écoute', g.phase === 'ecoute', g.phase);
    check('quatre propositions en niveau moyen', g.current.choices.length === 4, `${g.current.choices.length}`);
    check('la bonne réponse est parmi elles',
      g.current.choices[g.current.answer] === g.current.track.title);
    check('l’extrait ne commence pas au début',
      g.current.offset >= 15 && g.current.offset < 60, `${g.current.offset} s`);
    check('personne ne reçoit la réponse', noLeak(g, 'manche 1'));

    const wrong = (g.current.answer + 1) % g.current.choices.length;
    check('une mauvaise réponse ne rapporte rien',
      g.answer('j1', wrong).right === false && g.scores.get('j1') === 0);
    check('on ne répond qu’une fois',
      g.answer('j1', g.current.answer).ok === false, g.answer('j1', 0).message);
    check('une réponse hors bornes est refusée', g.answer('j2', 99).ok === false);

    const first = g.answer('j0', g.current.answer);
    check('une bonne réponse rapporte', first.right === true && g.scores.get('j0') > 0,
      `${g.scores.get('j0')} points`);
    check('le premier touche le bonus',
      g.scores.get('j0') >= FLOOR + FIRST_BONUS, `${g.scores.get('j0')} ≥ ${FLOOR + FIRST_BONUS}`);

    g.reveal();
    check('au dévoilement, le titre arrive', g.stateFor('j1').current.title === g.current.track.title);
    check('et l’index de la bonne réponse aussi',
      g.stateFor('j1').current.answer === g.current.answer);
    check('on sait qui a trouvé le premier', g.stateFor('j1').current.firstName === 'Alice');
  }

  /* ── LE BARÈME ── */
  section('Le barème');
  {
    const points = [];
    for (const delay of [0, 4000, 9000, 14000, 19000]) {
      const g = table(['Solo']);
      g.start('j0');
      g.current.startedAt = Date.now() - delay;
      g.answer('j0', g.current.answer);
      points.push(g.scores.get('j0'));
    }
    check('répondre plus vite ne rapporte jamais moins',
      points.every((v, i) => i === 0 || v <= points[i - 1]), points.join(' → '));
    check('une réponse instantanée vaut le maximum',
      points[0] === BEST + FIRST_BONUS, `${points[0]} pour ${BEST} + ${FIRST_BONUS}`);
    check('la dernière seconde rapporte quand même',
      points[points.length - 1] >= FLOOR, `${points[points.length - 1]} ≥ ${FLOOR}`);

    // La série.
    const g = table(['Solo']);
    g.start('j0');
    for (let k = 0; k < 3; k++) {
      g.answer('j0', g.current.answer);
      g.reveal();
      g.nextRound();
    }
    check('trois bonnes réponses d’affilée font une série', g.streaks.get('j0') >= 3, `${g.streaks.get('j0')}`);
    const before = g.streaks.get('j0');
    g.answer('j0', (g.current.answer + 1) % g.current.choices.length);
    check('une erreur casse la série', g.streaks.get('j0') === 0, `${before} → ${g.streaks.get('j0')}`);
  }

  /* ── LE MODE DIFFICILE ── */
  section('Le mode difficile');
  {
    const g = table(['Alice', 'Bruno'], 'difficile');
    g.start('j0');
    check('six propositions', g.current.choices.length === 6, `${g.current.choices.length}`);
    check('la manche est plus courte',
      LEVELS.difficile.ms < LEVELS.moyen.ms, `${LEVELS.difficile.ms / 1000} s contre ${LEVELS.moyen.ms / 1000} s`);
    // Les leurres du même artiste : la fausse playlist a quatre morceaux
    // par artiste, donc on ne peut pas toujours en trouver cinq — mais on
    // vérifie que le mécanisme choisit bien le même artiste quand il peut.
    const sameArtist = g.current.choices.filter((t) => t.startsWith(g.current.track.author)).length;
    check('les leurres viennent de la playlist elle-même',
      g.current.choices.every((t) => g.tracks.some((x) => x.title === t)));
    check('et se ressemblent quand c’est possible', sameArtist >= 2, `${sameArtist} du même artiste`);
  }

  /* ── DES PARTIES ENTIÈRES ── */
  section('Des parties entières');
  {
    let played = 0;
    let rounds = 0;
    let leaks = 0;
    let rng = 12345;
    const rand = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };

    for (let seed = 0; seed < 30; seed++) {
      const level = ['facile', 'moyen', 'difficile'][seed % 3];
      const g = table(['Alice', 'Bruno', 'Chloé', 'David'], level);
      g.configure('j0', { rounds: 5 });
      g.start('j0');

      let guard = 0;
      while (g.phase !== 'over' && guard++ < 60) {
        if (g.phase === 'ecoute') {
          if (!noLeak(g, `partie ${seed}`)) { leaks++; break; }
          // La bonne réponse est toujours dans les propositions : c'est
          // l'invariant le plus bête et le plus important.
          if (!g.current.choices.includes(g.current.track.title)) {
            console.log('  ✗ la bonne réponse manque dans les propositions');
            failures++; break;
          }
          rounds += 1;
          for (const p of g.players) {
            const right = rand() < 0.55;
            const idx = right ? g.current.answer
              : (g.current.answer + 1 + Math.floor(rand() * (g.current.choices.length - 1))) % g.current.choices.length;
            g.answer(p.id, idx);
          }
          g.reveal();
        } else if (g.phase === 'reponse') g.nextRound();
        else break;
      }
      if (g.phase !== 'over') {
        console.log(`  ✗ partie bloquée en ${g.phase} (niveau ${level}, manche ${g.round}/${g.order.length}, ` +
          `${g.current ? g.current.choices.length : 0} propositions, ${g.tracks.length} pistes)`);
        failures++; break;
      }
      played += 1;

      // Les scores sont cohérents avec le tableau final.
      const sum = g.result.table.reduce((n, t) => n + t.points, 0);
      const fromMap = [...g.scores.values()].reduce((n, v) => n + v, 0);
      if (sum !== fromMap) { console.log('  ✗ le tableau final ne colle pas aux scores'); failures++; break; }
    }

    check('trente parties jouées jusqu’au bout', played === 30, `${played}`);
    check('aucune fuite de réponse', leaks === 0, `${rounds} manches vérifiées, état construit pour chaque joueur`);
    check('le tableau final colle toujours aux scores', true);
  }

  /* ── LE PODIUM ── */
  section('Le podium');
  {
    const g = table(['Alice', 'Bruno', 'Chloé']);
    g.start('j0');
    g.scores.set('j0', 3000); g.scores.set('j1', 1200); g.scores.set('j2', 3000);
    g.round = 10;
    g.order = [];
    g.finish();
    check('le tableau est trié', g.result.table[0].points >= g.result.table[1].points);
    check('une égalité en tête fait deux vainqueurs',
      g.result.winnerIds.length === 2, g.result.winnerIds.join(', '));
    check('personne ne gagne quand personne ne marque', (() => {
      const h = table(['Seul']);
      h.start('j0');
      h.order = [];
      h.finish();
      return h.result.winnerIds.length === 0;
    })());
  }

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  process.exit(failures ? 1 : 0);
})();
