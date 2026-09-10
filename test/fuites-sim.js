'use strict';
/**
 * LES QUATRE FUITES.
 *
 * Ce banc d'essai garde quatre correctifs qui n'ont rien en commun sauf
 * une chose : chacun laissait s'échapper quelque chose qui n'aurait pas dû
 * sortir — une information, de l'argent, ou une place à table.
 *
 *  1. L'UNDERCOVER RÉVÉLAIT LE MOT D'UN ÉLIMINÉ. Un civil sorti donnait le
 *     mot des civils à tous les infiltrés ; la partie était pliée.
 *
 *  2. LE BLACKJACK PERDAIT LE PROFIL D'UN JOUEUR PARTI EN PLEINE MAIN. Sa
 *     mise était encaissée, ses gains n'étaient jamais versés, et la table
 *     attendait vingt-deux secondes son tour à chaque main.
 *
 *  3. LE RAKEBACK ET L'XP SE CALCULAIENT SUR LA MISE POSÉE. Couvrir rouge
 *     et noir ne risque rien et rapportait autant que jouer.
 *
 *  4. LE BLINDTEST CALAIT LA MUSIQUE AU MAUVAIS ENDROIT. Le calcul du temps
 *     écoulé mélangeait deux horloges et sortait un milliard de secondes.
 *
 * Les trois premiers se vérifient ici, sans serveur. Le quatrième est un
 * calcul : on le refait à la main, et on vérifie qu'il donne la bonne
 * seconde.
 */

const { Undercover } = require('../server/party/undercover');
const blackjack = require('../server/blackjack');
const roulette = require('../server/roulette');
const store = require('../server/store');

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

// Un faux Socket.IO : la table de blackjack diffuse son état à chaque
// action, et elle a besoin d'un adaptateur pour compter ses sockets.
const io = {
  to: () => ({ emit: () => {} }),
  sockets: { adapter: { rooms: new Map() } },
};

(function main() {
  console.log('Les quatre fuites — information, argent, et une place à table\n');

  /* ═══════════ 1. LE MOT DE L'ÉLIMINÉ ═══════════ */
  section('Undercover : le mot d’un éliminé ne sort pas');
  {
    const g = new Undercover(io);
    ['Ana', 'Bruno', 'Chloé', 'David', 'Elsa'].forEach((name, i) => {
      g.join({ id: 'j' + i, name, avatar: null }, {}, 's' + i);
    });
    g.start('j0');

    // On fait éliminer quelqu'un : tout le monde vote sur le même joueur.
    const victimId = g.players[1].id;
    const victim = g.playerOf(victimId);
    const motDeLaVictime = victim.word;
    check('la victime avait bien un mot', Boolean(motDeLaVictime), motDeLaVictime || '—');

    // On force la phase de vote plutôt que de jouer les descriptions : ce
    // qu'on teste, c'est ce que le serveur envoie APRÈS l'élimination.
    g.phase = 'voting';
    g.votes = new Map();
    for (const p of g.players) if (p.id !== victimId) g.votes.set(p.id, victimId);
    g.closeVote();

    check('quelqu’un a bien été éliminé', Boolean(victim.out));

    // Ce que voit CHAQUE joueur, y compris la victime.
    let leaks = 0;
    let rolesShown = 0;
    for (const p of g.players) {
      const s = g.stateFor(p.id);
      const json = JSON.stringify({ ...s, you: null });   // sans son propre mot
      if (motDeLaVictime && json.includes(motDeLaVictime)) leaks++;
      if (s.reveal && s.reveal.role) rolesShown++;
    }
    check('le mot de l’éliminé n’est envoyé à personne', leaks === 0,
      leaks ? `${leaks} joueur(s) le reçoivent` : `état construit pour ${g.players.length} joueurs`);
    check('mais son camp est bien annoncé', rolesShown === g.players.length,
      'c’est la règle du jeu : on apprend si le village s’est trompé');
    check('la révélation ne contient plus de champ « word »',
      g.lastReveal && g.lastReveal.word === undefined);

    // Chacun continue de voir SON mot, évidemment. On prend quelqu'un qui
    // en a un : Monsieur Blanc, lui, n'en reçoit aucun — c'est tout son
    // problème, et c'est voulu.
    const avecMot = g.players.find((p) => p.word && p.id !== victimId);
    const moi = g.stateFor(avecMot.id);
    check('chacun voit toujours son propre mot', Boolean(moi.you.word), moi.you.word || '—');
    const blanc = g.players.find((p) => p.role === 'white');
    check('sauf Monsieur Blanc, qui n’en a jamais eu',
      !blanc || !g.stateFor(blanc.id).you.word, blanc ? blanc.name : 'pas de Monsieur Blanc');

    // Et à la fin, tout est dévoilé : c'est là que ça sert.
    g.finish('civils');
    const fin = g.stateFor(g.players[0].id);
    check('à la fin, les rôles et les mots sont dévoilés',
      Boolean(fin.result) && fin.result.roles.every((r) => r.role),
      `${fin.result.roles.length} joueurs au tableau final`);
  }

  /* ═══════════ 2. LA TABLE DE BLACKJACK ═══════════ */
  section('Blackjack : partir en pleine main ne casse rien');
  {
    const table = blackjack.createTable(io, store);
    const seat = (id, name) => {
      table.profiles.set(id, { id, name, vault: { coins: 100000 }, stats: {}, xp: 0 });
      table.addPlayer({ id, name, avatar: null }, table.profiles.get(id), 'sock-' + id);
    };
    seat('a', 'Ana');
    seat('b', 'Bruno');
    check('deux joueurs assis', table.seats.length === 2, `${table.seats.length}`);

    // Hors main : la place se libère tout de suite.
    table.phase = 'betting';
    const freed = table.removePlayer('b');
    check('hors d’une main, la place est rendue immédiatement',
      freed === true && table.seats.length === 1, `${table.seats.length} siège(s)`);

    // En pleine main : la place est gardée, et `removePlayer` le dit.
    seat('b', 'Bruno');
    table.phase = 'playing';
    table.seats.forEach((s) => { s.hands = [{ cards: [], bet: 100, done: false }]; });
    const keptSeat = table.removePlayer('b');
    check('en pleine main, la place est gardée pour la reconnexion',
      keptSeat === false && table.seats.length === 2, `${table.seats.length} siège(s)`);
    check('et le siège est marqué absent', table.seatOf('b').connected === false);
    check('le serveur sait qu’il doit garder le profil',
      keptSeat === false,
      'c’est cette valeur de retour qui empêchait de payer ses gains');

    // Le profil doit rester : c'est lui qui reçoit les gains à la fin.
    check('le profil du parti est toujours là pour être payé',
      table.profiles.has('b'));

    // Son tour ne fait plus attendre les autres.
    table.activeSeat = table.seats.findIndex((s) => s.id === 'b');
    table.seats.forEach((s) => { s.activeHand = 0; });
    table.activeSeat = -1;
    table.nextSeat();
    const attente = table.deadline - Date.now();
    const surLeParti = table.seats[table.activeSeat] && table.seats[table.activeSeat].id === 'b';
    check('un siège abandonné ne bloque pas la table',
      !surLeParti || attente < 3000,
      surLeParti ? `${Math.round(attente / 1000)} s au lieu de 22` : 'la main est passée à quelqu’un de présent');
    clearTimeout(table.timer);
    clearTimeout(table.stepTimer);
    table.close && table.close();
  }

  /* ═══════════ 3. LE FARM DE RAKEBACK ═══════════ */
  section('Roulette : couvrir rouge et noir n’est pas jouer');
  {
    const mise = (bets) => bets.reduce((s, b) => s + b.amount, 0);

    const rouge = [{ type: 'red', amount: 1000 }];
    const couvert = [{ type: 'red', amount: 1000 }, { type: 'black', amount: 1000 }];
    const troisDouzaines = [1, 2, 3].map((v) => ({ type: 'dozen', value: v, amount: 1000 }));
    const partiel = [{ type: 'red', amount: 1000 }, { type: 'black', amount: 300 }];
    const plein = [{ type: 'straight', value: 17, amount: 500 }];

    check('une vraie mise risque tout ce qu’elle pose',
      roulette.atRisk(rouge) === mise(rouge), `${roulette.atRisk(rouge)} sur ${mise(rouge)}`);

    const r = roulette.atRisk(couvert);
    check('rouge + noir ne risque que le zéro',
      r > 0 && r < mise(couvert) / 20,
      `${r} risqués sur ${mise(couvert)} posés — soit ${(r / mise(couvert) * 100).toFixed(1)} %`);

    const d = roulette.atRisk(troisDouzaines);
    check('les trois douzaines non plus',
      d < mise(troisDouzaines) / 20, `${d} sur ${mise(troisDouzaines)}`);

    const pa = roulette.atRisk(partiel);
    check('une couverture partielle compte proportionnellement',
      pa > mise(partiel) / 3 && pa < mise(partiel),
      `${pa} sur ${mise(partiel)} — la part non couverte`);

    check('un numéro plein ne compte pas double',
      roulette.atRisk(plein) === mise(plein), `${roulette.atRisk(plein)} sur ${mise(plein)}`);

    check('ne rien poser ne risque rien', roulette.atRisk([]) === 0);

    /* Et ce que ça donne sur un profil, rakeback et XP compris. */
    const neuf = () => ({
      id: 'x', name: 'Test', xp: 0,
      vault: { coins: 1000000, items: {} },
      stats: { wagered: 0, returned: 0, rounds: 0, biggestWin: 0 },
      rake: null, season: null,
    });

    const honnete = neuf();
    store.recordPlay(honnete, 2000, 0, 'roulette', { risked: roulette.atRisk([{ type: 'red', amount: 2000 }]) });

    const malin = neuf();
    store.recordPlay(malin, 2000, 2000, 'roulette', { risked: roulette.atRisk(couvert) });

    check('le joueur qui risque vraiment gagne de l’XP',
      honnete.xp > 50, `${honnete.xp} XP`);
    check('le joueur qui se couvre n’en gagne presque pas',
      malin.xp * 20 < honnete.xp, `${malin.xp} XP contre ${honnete.xp}`);
    check('et son rakeback suit la même logique',
      malin.rake.pending * 20 < honnete.rake.pending,
      `${Math.round(malin.rake.pending)} contre ${Math.round(honnete.rake.pending)}`);
    check('l’argent réellement misé reste compté dans les statistiques',
      malin.stats.wagered === 2000,
      'le registre de l’économie doit voir les vrais montants');
  }

  /* ═══════════ 4. LA POSITION DANS L'EXTRAIT ═══════════ */
  section('Blindtest : la musique démarre au bon endroit');
  {
    /*
     * On refait le calcul de l'écran, sans navigateur. Le serveur envoie
     * `deadline` (fin de la manche) et `serverNow` (son horloge). Le temps
     * écoulé vaut la durée de la manche moins ce qu'il en reste.
     */
    const elapsedOf = (s, now = s.receivedAt) => {
      const sent = s.levelMs - (s.deadline - s.serverNow);
      const since = now - s.receivedAt;
      return Math.max(0, Math.min(s.levelMs, sent + since)) / 1000;
    };

    const debut = { serverNow: 1e6, deadline: 1e6 + 20000, levelMs: 20000, receivedAt: 5e6 };
    check('au début de la manche, on démarre à zéro seconde',
      elapsedOf(debut) === 0, `${elapsedOf(debut)} s`);

    const milieu = { serverNow: 1e6, deadline: 1e6 + 12000, levelMs: 20000, receivedAt: 5e6 };
    check('à mi-manche, on démarre au milieu de l’extrait',
      elapsedOf(milieu) === 8, `${elapsedOf(milieu)} s écoulées sur 20`);

    check('et on rattrape le temps de transport',
      elapsedOf(milieu, 5e6 + 500) === 8.5, `${elapsedOf(milieu, 5e6 + 500)} s`);

    const fin = { serverNow: 1e6, deadline: 1e6 + 100, levelMs: 20000, receivedAt: 5e6 };
    check('on ne dépasse jamais la durée de l’extrait',
      elapsedOf(fin, 5e6 + 60000) === 20, `${elapsedOf(fin, 5e6 + 60000)} s`);

    // L'ancien calcul, pour mémoire : il donnait toujours la toute fin.
    const ancien = Math.max(0, (Date.now() - (debut.serverNow - (debut.deadline - debut.serverNow) + debut.levelMs)) / 1000);
    check('l’ancien calcul, lui, envoyait toujours à la fin',
      Math.min(ancien, 20) === 20,
      `il donnait ${Math.round(ancien)} s, écrêtées à 20 — la musique s’arrêtait aussitôt`);
  }

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  process.exit(failures ? 1 : 0);
})();
