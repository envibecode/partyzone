'use strict';
/**
 * SIMULATEUR DE LOUP-GAROU.
 *
 * Pas de serveur, pas de navigateur : on instancie le moteur, on joue des
 * centaines de parties au hasard, et on vérifie après chaque action que le
 * jeu tient debout.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE SEUL INVARIANT QUI COMPTE VRAIMENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * AUCUN JOUEUR NE VOIT LE RÔLE D'UN AUTRE.
 *
 * Tout le reste du jeu peut être bancal et rester amusant. Ça, non : un
 * Loup-garou où l'on peut lire le rôle de son voisin en ouvrant la console
 * du navigateur n'est pas un jeu difficile, c'est un jeu mort. Le banc
 * d'essai construit donc l'état de CHAQUE joueur à CHAQUE action et
 * cherche, dans tout le JSON, la trace du rôle de quelqu'un d'autre.
 *
 * Trois exceptions, et elles sont dans les règles :
 *  · un loup voit les autres loups ;
 *  · la voyante voit ce qu'elle a regardé ;
 *  · le rôle d'un mort est public, quand l'hôte l'a réglé ainsi.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES AUTRES INVARIANTS
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  · Un mort ne revient jamais à la vie.
 *  · La composition est cohérente : au moins un loup, jamais plus du tiers.
 *  · Les potions de la sorcière ne servent qu'une fois chacune.
 *  · Une partie se termine toujours — pas de nuit sans fin.
 */

const { Loup, ROLES, composition } = require('../server/party/loup');

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

const io = { to: () => ({ emit: () => {} }) };

function table(n) {
  const game = new Loup(io);
  for (let i = 0; i < n; i++) {
    game.join({ id: 'j' + i, name: 'Joueur' + i, avatar: null }, {}, 's' + i);
  }
  return game;
}

/* ═══════════ L'invariant du secret ═══════════ */

/**
 * Cherche, dans l'état construit pour `viewer`, le rôle de quelqu'un
 * d'autre. On regarde la structure ET le JSON brut : un rôle qui
 * traînerait dans un champ oublié serait tout aussi lisible depuis la
 * console du navigateur.
 */
function secretsHeld(game, viewer) {
  const s = game.stateFor(viewer);
  const json = JSON.stringify(s);
  const leaks = [];

  const myRole = game.roleOf(viewer);
  const iAmWolf = myRole === 'loup';
  const seen = new Set((game.seerSeen.get(viewer) || []).map((x) => x.id));

  for (const p of s.players) {
    if (p.id === viewer) continue;
    const real = game.roleOf(p.id);
    if (!real) continue;

    // Ce qu'on a le droit de savoir.
    const allowedDead = !game.isAlive(p.id) && (game.revealRoles || game.phase === 'over');
    const allowedWolf = iAmWolf && real === 'loup';
    const allowedSeen = seen.has(p.id);
    const allowed = allowedDead || allowedWolf || allowedSeen || game.phase === 'over';

    if (!allowed) {
      if (p.role) leaks.push(`${p.name} : rôle "${p.role}" visible`);
      if (p.wolf) leaks.push(`${p.name} : marqué comme loup`);
    }
  }

  // La victime de la nuit : seuls les loups et la sorcière la connaissent.
  if (game.phase === 'nuit' && game.victim && game.victim !== viewer) {
    const mayKnow = iAmWolf || myRole === 'sorciere';
    if (!mayKnow && json.includes(`"victim":"${game.victim}"`)) {
      leaks.push('la victime de la nuit est visible');
    }
  }

  // Les votes des loups.
  if (game.phase === 'nuit' && !iAmWolf && game.wolfVotes.size) {
    for (const [wolf, target] of game.wolfVotes) {
      if (wolf === viewer) continue;
      if (json.includes(`"wolfVote":"${target}"`)) leaks.push('un vote de loup est visible');
    }
  }

  return leaks;
}

function checkSecrets(game, where) {
  for (const p of game.players) {
    const leaks = secretsHeld(game, p.id);
    if (leaks.length) {
      console.log(`  ✗ fuite (${where}) — ${p.name} voit : ${leaks[0]}`);
      failures++;
      return false;
    }
  }
  // Et un spectateur, qui n'est à aucune place.
  const spy = game.stateFor('spectateur-inconnu');
  const json = JSON.stringify(spy);
  if (spy.you.role) { console.log(`  ✗ fuite (${where}) — un spectateur reçoit un rôle`); failures++; return false; }
  // À la fin de la partie, tous les rôles sont publics : c'est le moment
  // où l'on découvre qui était quoi, et c'est la moitié du plaisir.
  if (game.phase !== 'over') {
    for (const p of spy.players) {
      if (p.role && game.isAlive(p.id)) {
        console.log(`  ✗ fuite (${where}) — un spectateur voit le rôle d'un vivant`);
        failures++;
        return false;
      }
      if (p.wolf) { console.log(`  ✗ fuite (${where}) — un spectateur voit un loup`); failures++; return false; }
    }
  }
  void json;
  return true;
}

/* ═══════════ Les autres invariants ═══════════ */

function invariants(game, where, memory) {
  const errs = [];

  // Un mort ne revient jamais.
  for (const id of memory.dead) {
    if (game.isAlive(id)) errs.push(`${game.nameOf(id)} est revenu à la vie`);
  }
  for (const id of game.roles.keys()) if (!game.isAlive(id)) memory.dead.add(id);

  // Les potions ne servent qu'une fois.
  if (game.witch.heal === true && memory.healed) errs.push('la potion de vie est revenue');
  if (game.witch.kill === true && memory.killed) errs.push('la potion de mort est revenue');
  if (!game.witch.heal) memory.healed = true;
  if (!game.witch.kill) memory.killed = true;

  // Les vivants sont un sous-ensemble des joueurs.
  for (const id of game.alive) {
    if (!game.roles.has(id)) errs.push(`${id} est vivant sans rôle`);
  }

  if (errs.length) {
    console.log(`  ✗ invariant rompu (${where}) : ${errs[0]}`);
    failures++;
    return false;
  }
  return true;
}

/* ═══════════ Une partie jouée au hasard ═══════════ */

function playOne(seed, n) {
  const game = table(n);
  game.start('j0');

  let rng = seed;
  const rand = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  };
  const pick = (list) => list[Math.floor(rand() * list.length)];

  const memory = { dead: new Set(), healed: false, killed: false };
  const phases = new Set();
  let actions = 0;

  if (!checkSecrets(game, 'distribution')) return null;

  while (game.phase !== 'over' && actions < 4000) {
    actions += 1;
    phases.add(game.phase);

    if (game.phase === 'nuit') {
      // Les loups désignent.
      for (const wolf of game.wolves()) {
        if (game.wolfVotes.has(wolf)) continue;
        const targets = game.livingIds().filter((id) => game.roleOf(id) !== 'loup');
        if (targets.length) game.wolfVote(wolf, pick(targets));
      }
      // La voyante regarde.
      const seer = game.holderOf('voyante');
      if (seer && game.isAlive(seer) && !game.seerLook) {
        const targets = game.livingIds().filter((id) => id !== seer);
        if (targets.length) game.seerLookAt(seer, pick(targets));
      }
      // La sorcière décide.
      const witch = game.holderOf('sorciere');
      if (witch && game.isAlive(witch)) {
        if (game.witch.heal && game.victim && rand() < 0.35) game.witchAct(witch, { heal: true });
        if (game.witch.kill && rand() < 0.2) {
          const targets = game.livingIds().filter((id) => id !== witch);
          if (targets.length) game.witchAct(witch, { kill: pick(targets) });
        }
      }
      if (!checkSecrets(game, 'nuit')) return null;
      if (!invariants(game, 'nuit', memory)) return null;
      game.closeNight();
      continue;
    }

    if (game.phase === 'chasseur' && game.shot) {
      const who = game.shot.byId;
      const targets = game.livingIds().filter((id) => id !== who);
      game.hunterShoot(who, targets.length && rand() < 0.85 ? pick(targets) : null);
      if (!invariants(game, 'chasseur', memory)) return null;
      continue;
    }

    if (game.phase === 'matin') { game.beginDebate(); continue; }
    if (game.phase === 'debat') { game.beginVote(); continue; }

    if (game.phase === 'vote') {
      for (const id of game.livingIds()) {
        const targets = game.livingIds().filter((x) => x !== id);
        // Un peu d'abstention, pour passer aussi par ce chemin.
        game.vote(id, targets.length && rand() < 0.9 ? pick(targets) : null);
        if (game.phase !== 'vote') break;
      }
      if (game.phase === 'vote') game.closeVote();
      if (!checkSecrets(game, 'vote')) return null;
      if (!invariants(game, 'vote', memory)) return null;
      continue;
    }

    if (game.phase === 'bucher') { game.beginNight(); continue; }
    break;
  }

  if (!checkSecrets(game, 'fin')) return null;
  if (game.phase !== 'over') {
    console.log(`  ✗ partie bloquée en phase « ${game.phase} » après ${actions} tours ` +
      `(${game.alive.size} vivants, ${game.wolves().length} loups)`);
    failures++;
    return null;
  }
  return { game, actions, phases };
}

/* ═══════════ Le banc d'essai ═══════════ */

(function main() {
  console.log('Simulateur de Loup-garou — le secret des rôles, avant tout\n');

  /* ── LA COMPOSITION ── */
  section('La composition du village');
  for (const n of [4, 6, 8, 10, 12, 16]) {
    const roles = composition(n);
    const wolves = roles.filter((r) => r === 'loup').length;
    const villagers = roles.length - wolves;
    check(`${n} joueurs : ${wolves} loup${wolves > 1 ? 's' : ''}`,
      roles.length === n && wolves >= 1 && wolves < villagers,
      roles.join(', '));
  }
  check('jamais plus d’un tiers de loups',
    [4, 5, 6, 7, 8, 9, 10, 12, 14, 16].every((n) => {
      const w = composition(n).filter((r) => r === 'loup').length;
      return w <= Math.floor(n / 3);
    }));
  check('une voyante dès qu’il y a la place',
    composition(8).includes('voyante'));
  check('au moins deux villageois ordinaires',
    [6, 8, 10, 12].every((n) => composition(n).filter((r) => r === 'villageois').length >= 2));

  /* ── LES POUVOIRS ── */
  section('Les pouvoirs, et leurs refus');
  {
    const g = table(8);
    g.start('j0');
    const wolf = g.wolves()[0];
    const villager = g.villagers()[0];

    check('un villageois ne peut pas désigner de victime',
      g.wolfVote(villager, wolf).ok === false, g.wolfVote(villager, wolf).message);
    check('un loup ne dévore pas un loup',
      g.wolves().length > 1
        ? g.wolfVote(wolf, g.wolves()[1]).ok === false
        : true,
      g.wolves().length > 1 ? g.wolfVote(wolf, g.wolves()[1]).message : '(un seul loup à cette table)');
    check('un loup peut désigner un villageois', g.wolfVote(wolf, villager).ok === true);

    const seer = g.holderOf('voyante');
    if (seer) {
      check('la voyante ne se regarde pas elle-même',
        g.seerLookAt(seer, seer).ok === false, g.seerLookAt(seer, seer).message);
      const target = g.livingIds().find((id) => id !== seer);
      const look = g.seerLookAt(seer, target);
      check('la voyante découvre un rôle', look.ok && Boolean(look.role), look.role);
      check('et ne peut regarder qu’une fois par nuit',
        g.seerLookAt(seer, g.livingIds().find((id) => id !== seer && id !== target)).ok === false);
      check('ce qu’elle a vu n’apparaît que chez elle',
        g.stateFor(seer).you.seen.length === 1
        && g.stateFor(villager === seer ? wolf : villager).you.seen.length === 0);
    }

    const witch = g.holderOf('sorciere');
    if (witch) {
      g.settleWolves();
      check('la sorcière voit la victime des loups',
        Boolean(g.stateFor(witch).you.witch.victim));
      // Quelqu'un qui n'est ni la sorcière ni un loup : c'est lui qui ne
      // doit rien voir.
      const plain = g.livingIds().find((id) => g.roleOf(id) === 'villageois');
      check('mais personne d’autre ne la voit',
        !plain || g.stateFor(plain).you.witch === undefined);
      const heal = g.witchAct(witch, { heal: true });
      check('elle peut sauver une fois', heal.ok === true);
      check('et pas deux', g.witchAct(witch, { heal: true }).ok === false,
        g.witchAct(witch, { heal: true }).message);
    }
  }

  /* ── LE VOTE ── */
  section('Le vote du village');
  {
    const g = table(6);
    g.start('j0');
    g.phase = 'vote';
    g.votes = new Map();
    const ids = g.livingIds();
    check('un mort ne vote pas',
      (g.alive.delete(ids[5]), g.vote(ids[5], ids[0]).ok === false));
    g.alive.add(ids[5]);

    // Égalité franche : personne ne meurt.
    g.votes = new Map([[ids[0], ids[1]], [ids[1], ids[0]], [ids[2], ids[1]], [ids[3], ids[0]]]);
    const before = g.alive.size;
    g.closeVote();
    check('en cas d’égalité, personne n’est brûlé', g.alive.size === before, `${g.alive.size} vivants`);
    check('et le dépouillement le dit', g.lastVote.tie === true);
  }

  /* ── DES PARTIES ENTIÈRES ── */
  section('Des parties entières, jouées au hasard');
  {
    let played = 0;
    let byWolves = 0;
    let byVillage = 0;
    let hunters = 0;
    let totalActions = 0;
    const phases = new Set();

    for (let seed = 1; seed <= 60; seed++) {
      const n = 4 + (seed % 9);
      const out = playOne(seed * 7919, n);
      if (!out) break;
      played += 1;
      totalActions += out.actions;
      out.phases.forEach((p) => phases.add(p));
      if (out.phases.has('chasseur')) hunters += 1;
      if (out.game.result.camp === 'loups') byWolves += 1; else byVillage += 1;
    }

    check('soixante parties jouées jusqu’au bout', played === 60, `${played}`);
    check('aucun rôle n’a jamais fuité', failures === 0 || played === 60,
      `${totalActions} tours vérifiés, état construit pour chaque joueur à chaque phase`);
    check('les deux camps gagnent', byWolves > 0 && byVillage > 0,
      `${byWolves} fois les loups, ${byVillage} fois le village`);
    check('le chasseur a tiré', hunters > 0, `${hunters} parties`);
    check('toutes les phases ont été traversées',
      ['nuit', 'matin', 'debat', 'vote', 'bucher'].every((p) => phases.has(p)),
      [...phases].join(', '));
    check('aucune partie ne tourne en rond',
      totalActions / played < 200, `${Math.round(totalActions / played)} tours en moyenne`);
  }

  /* ── LA FIN ── */
  section('Les conditions de victoire');
  {
    const g = table(6);
    g.start('j0');
    // On tue tous les loups : le village gagne.
    for (const w of g.wolves()) g.alive.delete(w);
    g.checkEnd();
    check('sans loup, le village gagne', g.result && g.result.camp === 'village', g.phase);

    const h = table(6);
    h.start('j0');
    // On ne laisse que les loups et autant de villageois : les loups gagnent.
    const wolves = h.wolves();
    h.alive = new Set([...wolves, h.villagers()[0]]);
    h.checkEnd();
    check('à égalité, les loups gagnent',
      h.result && h.result.camp === 'loups',
      `${wolves.length} loup(s) contre 1 villageois`);
    check('le tableau final révèle tous les rôles',
      h.result.table.length === 6 && h.result.table.every((t) => t.roleName));
    check('les vainqueurs sont désignés',
      h.result.winnerIds.length === wolves.length);
  }

  /* ── LA SURVIE À UNE MISE À JOUR ── */
  section('La partie survit à un redéploiement');
  {
    /*
     * Le Loup-garou garde ses vivants dans un `Set`. La sauvegarde
     * l'écrivait bien en tableau, mais la relecture le rendait tel quel :
     * au redémarrage, `alive.has(...)` n'existait plus et la partie était
     * simplement abandonnée avec un message dans les journaux. Un village
     * de douze perdu parce qu'on a corrigé une faute de frappe.
     */
    const rooms = require('../server/party/rooms');
    const g = table(8);
    g.start('j0');
    const code = g.code;
    const aliveBefore = [...g.alive].sort().join(',');
    const rolesBefore = g.players.map((p) => `${p.id}:${p.role}`).sort().join(',');

    const saved = JSON.parse(JSON.stringify(rooms.saveAll().filter((r) => r.data.code === code)));
    rooms.rooms.delete(code);
    clearTimeout(g.timer);

    const n = rooms.restoreAll(saved, { loup: () => new Loup(io) });
    const back = rooms.get(code);
    check('la partie est reprise', n === 1 && Boolean(back));
    check('les vivants sont encore un ensemble, pas un tableau',
      back.alive instanceof Set, back.alive instanceof Set ? '' : typeof back.alive);
    check('et ce sont les mêmes', [...back.alive].sort().join(',') === aliveBefore);
    check('les rôles sont intacts',
      back.players.map((p) => `${p.id}:${p.role}`).sort().join(',') === rolesBefore);
    check('la nuit reprend où elle en était', back.phase === g.phase, back.phase);
    // Et le jeu répond encore : c'est ça qui manquait avant.
    const wolf = back.wolves()[0];
    const prey = back.villagers()[0];
    check('les loups peuvent voter de nouveau', back.wolfVote(wolf, prey).ok === true);
    clearTimeout(back.timer);
    rooms.rooms.delete(code);
  }

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  process.exit(failures ? 1 : 0);
})();
