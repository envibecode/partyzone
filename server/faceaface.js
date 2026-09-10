'use strict';
/**
 * LE FACE-À-FACE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LE SITE NE SAVAIT PAS DIRE
 * ─────────────────────────────────────────────────────────────────────────
 * Le classement dit qui est premier. Le palmarès dit qui gagne le plus
 * souvent. Aucun des deux ne répond à la seule question qu'on se pose
 * vraiment entre potes : « toi et moi, ça donne quoi ? »
 *
 * C'est pourtant celle qui se rejoue à chaque partie. Deux joueurs peuvent
 * être quatrième et cinquième du classement général et avoir, entre eux,
 * une histoire de dix-sept parties dont quatorze dans le même sens.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COMMENT ON COMPTE
 * ─────────────────────────────────────────────────────────────────────────
 * À la fin de chaque partie Party, on prend le classement du salon et on
 * regarde, pour chaque PAIRE de joueurs, lequel a fini devant. Pas qui a
 * gagné la partie : qui a fini devant l'autre. Dans un Monopoly à cinq,
 * finir troisième quand ton rival finit cinquième, ça compte — et c'est
 * précisément ce dont on se vante le lendemain.
 *
 * On garde un compteur par paire, et le détail par jeu. Une paire, c'est
 * une ligne ; à dix joueurs, c'est quarante-cinq lignes au total. Autant
 * dire rien : on peut se permettre de tout garder.
 *
 * LE SENS DE LA PAIRE. La clé est toujours écrite dans le même ordre
 * (le plus petit identifiant d'abord), sinon la même rivalité s'écrirait
 * dans deux lignes différentes selon qui a ouvert le salon. C'est le genre
 * de détail qui ne se voit qu'au bout de trois semaines, quand les
 * compteurs ne tombent plus juste.
 */

const MAX_PAIRES = 4000;
const DERNIERES = 8;

const cle = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function bucket(state) {
  if (!state.face) state.face = { pairs: {} };
  if (!state.face.pairs) state.face.pairs = {};
  return state.face.pairs;
}

function ligne(pairs, a, b, now) {
  const key = cle(a, b);
  if (!pairs[key]) {
    pairs[key] = { a: a < b ? a : b, b: a < b ? b : a, wa: 0, wb: 0, nul: 0, games: {}, last: [], at: now };
  }
  return pairs[key];
}

/**
 * Enregistre une partie terminée.
 *
 * @param {object} state l'état du site
 * @param {object} room  le salon fini (il faut `ranking()`, `game`, `gameName`)
 * @returns {number} le nombre de paires mises à jour
 */
function record(state, room, now = Date.now()) {
  let ranking;
  try { ranking = room.ranking(); } catch { return 0; }
  if (!Array.isArray(ranking) || ranking.length < 2) return 0;

  const pairs = bucket(state);
  const noms = new Map((room.players || []).map((p) => [p.id, p.name]));
  let n = 0;

  for (let i = 0; i < ranking.length; i++) {
    for (let j = i + 1; j < ranking.length; j++) {
      const x = ranking[i];
      const y = ranking[j];
      if (!x.id || !y.id || x.id === y.id) continue;

      const l = ligne(pairs, x.id, y.id, now);
      const premier = x.score === y.score ? null : (x.score > y.score ? x.id : y.id);

      const g = l.games[room.game] || (l.games[room.game] = { wa: 0, wb: 0, nul: 0, name: room.gameName });
      if (!premier) { l.nul += 1; g.nul += 1; }
      else if (premier === l.a) { l.wa += 1; g.wa += 1; }
      else { l.wb += 1; g.wb += 1; }

      l.at = now;
      l.na = noms.get(l.a) || l.na;
      l.nb = noms.get(l.b) || l.nb;
      l.last = [{ at: now, game: room.game, gameName: room.gameName, winner: premier }, ...(l.last || [])]
        .slice(0, DERNIERES);
      n += 1;
    }
  }

  // On ne garde pas les rivalités mortes indéfiniment : à quelques joueurs
  // le plafond ne sera jamais atteint, mais un site ouvert à une classe
  // entière remplirait la base sans que personne ne s'en aperçoive.
  const keys = Object.keys(pairs);
  if (keys.length > MAX_PAIRES) {
    keys.sort((k1, k2) => pairs[k1].at - pairs[k2].at)
      .slice(0, keys.length - MAX_PAIRES)
      .forEach((k) => delete pairs[k]);
  }
  return n;
}

/**
 * Le face-à-face entre deux joueurs, DU POINT DE VUE DU PREMIER.
 *
 * L'inversion se fait ici et nulle part ailleurs : le navigateur reçoit
 * « toi 9, lui 4 » et n'a rien à retourner lui-même — c'est comme ça qu'on
 * évite d'afficher un jour le score à l'envers.
 */
function between(state, moi, lui) {
  const l = bucket(state)[cle(moi, lui)];
  const vide = { joues: 0, moi: 0, lui: 0, nul: 0, games: [], last: [] };
  if (!l) return vide;

  const inverse = l.a !== moi;
  const games = Object.entries(l.games).map(([id, g]) => ({
    game: id,
    name: g.name || id,
    moi: inverse ? g.wb : g.wa,
    lui: inverse ? g.wa : g.wb,
    nul: g.nul,
    joues: g.wa + g.wb + g.nul,
  })).sort((x, y) => y.joues - x.joues);

  return {
    joues: l.wa + l.wb + l.nul,
    moi: inverse ? l.wb : l.wa,
    lui: inverse ? l.wa : l.wb,
    nul: l.nul,
    games,
    last: (l.last || []).map((e) => ({
      at: e.at, game: e.game, gameName: e.gameName,
      // `null` = ex æquo ; sinon vrai si c'est moi qui ai fini devant.
      moi: e.winner === null ? null : e.winner === moi,
    })),
    depuis: l.at,
  };
}

/** Tous les adversaires connus d'un joueur, du plus fréquenté au moins. */
function rivaux(state, moi, limit = 12) {
  const out = [];
  for (const l of Object.values(bucket(state))) {
    if (l.a !== moi && l.b !== moi) continue;
    const inverse = l.a !== moi;
    const id = inverse ? l.a : l.b;
    out.push({
      id,
      name: (inverse ? l.na : l.nb) || '—',
      joues: l.wa + l.wb + l.nul,
      moi: inverse ? l.wb : l.wa,
      lui: inverse ? l.wa : l.wb,
      nul: l.nul,
      at: l.at,
    });
  }
  return out.sort((x, y) => y.joues - x.joues || y.at - x.at).slice(0, limit);
}

/**
 * La phrase qui résume une rivalité. C'est elle qu'on lit, pas le tableau.
 */
function resume(f, moi = 'Toi', lui = 'Lui') {
  if (!f.joues) return `${moi} et ${lui} n’ont encore jamais joué ensemble.`;
  if (f.moi === f.lui) return `${f.joues} parties, et personne ne prend l’avantage : ${f.moi} partout.`;
  const devant = f.moi > f.lui ? moi : lui;
  const derriere = f.moi > f.lui ? lui : moi;
  const haut = Math.max(f.moi, f.lui);
  const bas = Math.min(f.moi, f.lui);
  const ecart = haut - bas;
  if (ecart >= 5 && bas === 0) return `${devant} mène ${haut} à ${bas} sur ${derriere}. Ça devient gênant.`;
  if (ecart >= 5) return `${devant} mène largement : ${haut} à ${bas} en ${f.joues} parties.`;
  if (ecart === 1) return `${devant} mène d’une seule partie — ${haut} à ${bas}.`;
  return `${devant} mène ${haut} à ${bas}.`;
}

module.exports = { record, between, rivaux, resume, cle, MAX_PAIRES };
