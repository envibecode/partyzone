'use strict';
/**
 * LE JOURNAL DU LENDEMAIN, ET LE PRIX CITRON.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI DES PHRASES, ET PAS UN TABLEAU
 * ─────────────────────────────────────────────────────────────────────────
 * Le site sait déjà tout compter. Ce qu'il ne savait pas faire, c'est le
 * dire. Un tableau de chiffres se regarde une fois ; « Momo a perdu
 * quarante mille au Plinko en douze minutes, puis a tout repris sur un
 * bonus à trois cent quarante fois la mise » se raconte le lendemain à midi.
 *
 * Alors on écrit des phrases. Pas générées par une intelligence
 * quelconque — assemblées à partir de tournures écrites à la main, choisies
 * selon ce qui s'est passé. C'est plus fiable, ça ne coûte rien, et ça a du
 * caractère.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEUX RÈGLES D'ÉCRITURE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  1. ON NE PARLE QUE DE CE QUI EST ARRIVÉ. Pas de « personne n'a joué
 *     hier, dommage ! » — un journal qui gronde ses lecteurs se ferme.
 *     Sans soirée, il n'y a pas de journal, point.
 *
 *  2. ON CITE DES NOMS ET DES CHIFFRES. « Un joueur a bien joué » ne veut
 *     rien dire. « Léa a gagné trois Uno d'affilée » se discute.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE PRIX CITRON
 * ─────────────────────────────────────────────────────────────────────────
 * Le site ne célébrait que les gains. Or perdre, c'est 95 % de ce qui se
 * passe dans un casino, et de loin ce qui fait le plus rire. Chaque semaine,
 * un trophée à la pire décision de la bande : la plus grosse chute, la série
 * la plus longue, l'acharnement le plus obstiné. Ça ne coûte rien à
 * personne — c'est une médaille en chocolat, et c'est tout l'intérêt.
 */

const faits = require('./faits');

const fmt = (n) => Math.round(n).toLocaleString('fr-FR');

/** Le nom d'un jeu, tel qu'on le dit à l'oral. */
const JEUX = {
  blackjack: 'au blackjack',
  roulette: 'à la roulette',
  plinko: 'au Plinko',
  'horse house': 'à Horse House',
  mine: 'à la mine',
  jeu: 'au casino',
};
const auJeu = (g) => JEUX[g] || `à ${g}`;

/* ─── Le journal ───────────────────────────────────────── */

/**
 * Écrit le journal d'une journée. Renvoie `null` si rien ne s'est passé :
 * mieux vaut pas de journal qu'un journal vide.
 */
function pour(state, day, { profiles = [] } = {}) {
  const list = faits.of(state, day);
  if (!list.length) return null;

  const gains = list.filter((f) => f.kind === 'gain').sort((a, b) => b.ratio - a.ratio);
  const pertes = list.filter((f) => f.kind === 'perte').sort((a, b) => b.perte - a.perte);
  const parties = list.filter((f) => f.kind === 'party');
  const caisses = list.filter((f) => f.kind === 'caisse');
  const soirees = list.filter((f) => f.kind === 'soiree');
  const series = list.filter((f) => f.kind === 'serie').sort((a, b) => b.longueur - a.longueur);
  const retours = list.filter((f) => f.kind === 'retour');

  const joueurs = new Set(list.map((f) => f.id).filter(Boolean));
  const lignes = [];

  /* ── L'ouverture : qui était là, et combien de temps ── */
  const premier = Math.min(...list.map((f) => f.at));
  const dernier = Math.max(...list.map((f) => f.at));
  const minutes = Math.round((dernier - premier) / 60000);
  if (joueurs.size >= 2 && minutes >= 5) {
    lignes.push(`${joueurs.size} joueurs, ${minutes} minutes de jeu.`);
  } else if (joueurs.size === 1) {
    const seul = list.find((f) => f.name);
    lignes.push(seul ? `Soirée en solitaire pour ${seul.name}.` : 'Une petite soirée.');
  }

  /* ── Le meilleur coup ── */
  if (gains.length) {
    const g = gains[0];
    lignes.push(
      `${g.name} a sorti ${fmt(g.gain)} pièces d’une mise de ${fmt(g.staked)} ${auJeu(g.game)}`
      + ` — ${g.ratio} fois la mise.`
    );
  }

  /* ── La plus belle chute ── */
  if (pertes.length) {
    const p = pertes[0];
    const meme = gains.find((g) => g.id === p.id);
    lignes.push(meme
      ? `${p.name} avait pourtant laissé ${fmt(p.perte)} pièces ${auJeu(p.game)} un peu plus tôt.`
      : `${p.name} a laissé ${fmt(p.perte)} pièces ${auJeu(p.game)}.`);
  }

  /* ── La série ── */
  if (series.length) {
    const s = series[0];
    lignes.push(`${s.longueur} défaites d’affilée pour ${s.name} ${auJeu(s.game)}. `
      + 'On a connu des soirées plus faciles.');
  }

  /* ── Le retour ── */
  if (retours.length) {
    const r = retours[0];
    lignes.push(`${r.name} est descendu à ${fmt(r.bas)} pièces avant de remonter à ${fmt(r.haut)}.`);
  }

  /* ── La Party ── */
  if (soirees.length) {
    const s = soirees[0];
    const noms = (s.winners || []).map((w) => w.name).join(' et ');
    if (noms) lignes.push(`Soirée en ${s.manches} manches : ${noms} l’emporte au cumul.`);
  } else if (parties.length) {
    // Qui a gagné le plus de parties Party dans la soirée ?
    const compte = {};
    for (const p of parties) {
      for (const w of p.winners || []) compte[w.name] = (compte[w.name] || 0) + 1;
    }
    const [nom, n] = Object.entries(compte).sort((a, b) => b[1] - a[1])[0] || [];
    if (nom && n >= 2) {
      lignes.push(`${nom} a gagné ${n} parties Party sur ${parties.length}.`);
    } else if (parties.length) {
      const noms = [...new Set(parties.map((p) => p.gameName).filter(Boolean))];
      lignes.push(`${parties.length} partie${parties.length > 1 ? 's' : ''} Party`
        + (noms.length ? ` — ${noms.slice(0, 3).join(', ')}.` : '.'));
    }
  }

  /* ── Les trouvailles ── */
  if (caisses.length) {
    const c = caisses[0];
    lignes.push(caisses.length > 1
      ? `${caisses.length} objets rares sont sortis des caisses, dont ${c.item} pour ${c.name}.`
      : `${c.name} a sorti ${c.item} d’une caisse.`);
  }

  if (!lignes.length) return null;

  return {
    day,
    joueurs: joueurs.size,
    minutes,
    lignes,
    texte: lignes.join(' '),
    faits: list.length,
    // De quoi mettre une tête à côté du titre : celui qui a fait le plus
    // gros coup de la soirée.
    vedette: gains.length ? { id: gains[0].id, name: gains[0].name } : null,
    profiles: profiles.length,
  };
}

/** Le journal d'hier. C'est celui qu'on lit le matin. */
function hier(state, now = Date.now()) {
  return pour(state, faits.jour(now - 86400000));
}

/**
 * UNE SEULE PHRASE : le moment de la soirée.
 *
 * La carte de fin de soirée n'a de la place que pour ça. On prend le fait
 * le plus spectaculaire de la journée parmi ceux qui concernent les gens
 * qui étaient là — sinon la carte d'une soirée à quatre raconterait le
 * bonus qu'un cinquième a touché tout seul l'après-midi.
 *
 * L'ordre de préférence n'est pas l'ordre chronologique : un gros gain se
 * raconte mieux qu'une série de défaites, qui se raconte mieux qu'une
 * caisse. À défaut, on renvoie `null` et la carte se passe de la bande.
 */
function moment(state, ids = null, now = Date.now()) {
  const dedans = ids && ids.length ? new Set(ids) : null;
  const list = faits.of(state, faits.jour(now))
    .filter((f) => !dedans || !f.id || dedans.has(f.id));
  if (!list.length) return null;

  const top = (kind, tri) => list.filter((f) => f.kind === kind).sort(tri)[0];

  const g = top('gain', (a, b) => b.ratio - a.ratio);
  if (g) return `${g.name} sort ${fmt(g.gain)} pièces d’une mise de ${fmt(g.staked)} — ${g.ratio}× ${auJeu(g.game)}.`;

  const r = top('retour', (a, b) => b.haut - a.haut);
  if (r) return `${r.name} tombe à ${fmt(r.bas)} pièces et remonte à ${fmt(r.haut)}.`;

  const p = top('perte', (a, b) => b.perte - a.perte);
  if (p) return `${p.name} laisse ${fmt(p.perte)} pièces ${auJeu(p.game)} en une manche.`;

  const s = top('serie', (a, b) => b.longueur - a.longueur);
  if (s) return `${s.longueur} défaites d’affilée pour ${s.name} ${auJeu(s.game)}.`;

  const c = top('caisse', (a, b) => b.at - a.at);
  if (c) return `${c.name} sort ${c.item} d’une caisse.`;

  return null;
}

/* ─── Le prix Citron ───────────────────────────────────── */

/*
 * Trois catégories, et le site choisit la plus spectaculaire de la semaine.
 * On ne cumule pas : un seul lauréat, sinon ce n'est plus un prix.
 */
function citron(state, now = Date.now()) {
  const list = faits.since(state, 7, now);
  if (!list.length) return null;

  const candidats = [];

  const pertes = list.filter((f) => f.kind === 'perte').sort((a, b) => b.perte - a.perte);
  if (pertes.length) {
    candidats.push({
      poids: pertes[0].perte / 1000,
      id: pertes[0].id,
      name: pertes[0].name,
      titre: 'La Chute',
      texte: `${fmt(pertes[0].perte)} pièces parties d’un coup ${auJeu(pertes[0].game)}.`,
    });
  }

  const series = list.filter((f) => f.kind === 'serie').sort((a, b) => b.longueur - a.longueur);
  if (series.length) {
    candidats.push({
      poids: series[0].longueur * 2.5,
      id: series[0].id,
      name: series[0].name,
      titre: 'L’Obstiné',
      texte: `${series[0].longueur} défaites d’affilée ${auJeu(series[0].game)}, sans jamais lever le pied.`,
    });
  }

  // Celui qui a le plus joué pour le moins de résultat : on compte ses
  // faits marquants, et aucun n'est un gain.
  const parJoueur = {};
  for (const f of list) {
    if (!f.id) continue;
    if (!parJoueur[f.id]) parJoueur[f.id] = { name: f.name, gains: 0, pertes: 0 };
    if (f.kind === 'gain') parJoueur[f.id].gains += 1;
    if (f.kind === 'perte' || f.kind === 'serie') parJoueur[f.id].pertes += 1;
  }
  const bredouille = Object.entries(parJoueur)
    .filter(([, p]) => p.gains === 0 && p.pertes >= 2)
    .sort((a, b) => b[1].pertes - a[1].pertes)[0];
  if (bredouille) {
    candidats.push({
      poids: bredouille[1].pertes * 2,
      id: bredouille[0],
      name: bredouille[1].name,
      titre: 'Le Bredouille',
      texte: 'Une semaine entière sans un seul coup à raconter.',
    });
  }

  if (!candidats.length) return null;
  const gagnant = candidats.sort((a, b) => b.poids - a.poids)[0];
  return { semaine: faits.semaine(now), ...gagnant };
}

module.exports = { pour, hier, moment, citron, auJeu };
