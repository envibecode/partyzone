'use strict';
/**
 * LE GRAND LIVRE DE L'ÉCONOMIE.
 *
 * Combien de pièces le site fabrique chaque jour, combien il en détruit, et
 * par quelle porte. Sans ce registre, on découvre l'inflation le jour où
 * quelqu'un a quarante millions et où plus rien n'a de valeur — et à ce
 * moment-là il est trop tard : on ne peut plus retirer les pièces sans
 * fâcher tout le monde.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ON COMPTE, ET COMMENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Deux colonnes, jamais mélangées :
 *
 *  · CRÉÉES (`mint`) — des pièces qui n'existaient pas apparaissent : la
 *    mine, le rakeback, la revente d'objets, les récompenses Party, les
 *    cadeaux d'un administrateur.
 *
 *  · DÉTRUITES (`burn`) — des pièces disparaissent pour de bon : le prix
 *    d'une caisse, la commission du marché.
 *
 * Les JEUX sont à part (`play`). Une mise n'est ni créée ni détruite : elle
 * est risquée. Ce qui compte pour un jeu, c'est le solde net — misé moins
 * rendu. Un jeu à 96 % de redistribution détruit 4 % du volume qui passe
 * dessus, et c'est ça qu'on veut voir, pas le brassage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN TAMPON EN MÉMOIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les appels viennent du cœur des jeux, souvent plusieurs fois par seconde,
 * dans du code synchrone. Aller chercher l'état du site (qui est
 * asynchrone) à chaque pièce gagnée serait absurde. On empile donc dans un
 * tampon, et on verse dans l'état toutes les dix secondes — ce qui est
 * aussi ce qui fait survivre le registre aux redémarrages.
 *
 * On garde trente jours. Au-delà, une courbe d'inflation ne se lit plus,
 * elle s'admire.
 */

// `store` exige `ledger` (pour compter les manches) et `ledger` exige
// `store` (pour écrire dans l'état) : la boucle est réelle. On charge donc
// `store` à l'usage, jamais au chargement du fichier — au moment où on
// écrit, tout le monde est prêt.
const store = () => require('./store');

const DAYS_KEPT = 30;
const FLUSH_MS = 10000;

/** Le tampon : source → { mint, burn, staked, returned, rounds }. */
let buffer = new Map();
let bufferedDay = null;

/** La journée d'une date, en heure de Paris — c'est là que vivent les joueurs. */
function dayOf(at = Date.now()) {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(at));
}

function bucket(source) {
  const day = dayOf();
  // Minuit : on vide le tampon de la veille avant d'ouvrir celui du jour.
  if (bufferedDay && bufferedDay !== day) flush();
  bufferedDay = day;
  if (!buffer.has(source)) {
    buffer.set(source, { mint: 0, burn: 0, staked: 0, returned: 0, rounds: 0 });
  }
  return buffer.get(source);
}

/* ─── Les trois façons d'écrire ────────────────────────── */

/** Des pièces apparaissent. */
function mint(source, amount) {
  const n = Math.round(Number(amount) || 0);
  if (n <= 0) return;
  bucket(source).mint += n;
}

/** Des pièces disparaissent. */
function burn(source, amount) {
  const n = Math.round(Number(amount) || 0);
  if (n <= 0) return;
  bucket(source).burn += n;
}

/**
 * Une manche jouée. `staked` est la mise, `returned` ce qui revient au
 * joueur. La différence est ce que le jeu a réellement pris ou donné.
 */
function play(game, staked, returned) {
  const s = Math.round(Number(staked) || 0);
  const r = Math.round(Number(returned) || 0);
  if (s <= 0 && r <= 0) return;
  const b = bucket(game);
  b.staked += s;
  b.returned += r;
  b.rounds += 1;
}

/* ─── Le versement dans l'état du site ─────────────────── */

function ensure(state) {
  if (!state.ledger || typeof state.ledger !== 'object') state.ledger = { days: {} };
  if (!state.ledger.days || typeof state.ledger.days !== 'object') state.ledger.days = {};
  return state.ledger;
}

let flushing = false;
async function flush() {
  if (flushing || !buffer.size) return;
  flushing = true;
  // On détache le tampon AVANT d'attendre : les pièces gagnées pendant
  // l'écriture vont dans le suivant, et aucune ne se perd.
  const pending = buffer;
  const day = bufferedDay || dayOf();
  buffer = new Map();

  try {
    const state = await store().siteState();
    const led = ensure(state);
    const bucketOfDay = led.days[day] || (led.days[day] = {});

    for (const [source, v] of pending) {
      const line = bucketOfDay[source] || (bucketOfDay[source] = { mint: 0, burn: 0, staked: 0, returned: 0, rounds: 0 });
      line.mint += v.mint;
      line.burn += v.burn;
      line.staked += v.staked;
      line.returned += v.returned;
      line.rounds += v.rounds;
    }

    // On oublie les vieux jours : le registre ne doit pas grossir sans fin.
    const days = Object.keys(led.days).sort();
    while (days.length > DAYS_KEPT) delete led.days[days.shift()];

    store().touchState();
  } catch (err) {
    console.error('[registre]', err.message);
  } finally {
    flushing = false;
  }
}

function start() {
  setInterval(() => { flush(); }, FLUSH_MS).unref();
}

/* ─── La lecture, pour le panel d'administration ───────── */

/**
 * Le registre mis en forme : une ligne par jour, une ligne par source, et
 * le total. `net` est ce que le site a fabriqué net — c'est LE chiffre :
 * s'il est positif tous les jours, la masse monétaire gonfle.
 */
function view(state, { days = 14 } = {}) {
  const led = ensure(state);
  const keys = Object.keys(led.days).sort().slice(-days);

  const bySource = {};
  const daily = keys.map((day) => {
    const lines = led.days[day] || {};
    let mint = 0;
    let burn = 0;
    for (const [source, v] of Object.entries(lines)) {
      // Un jeu ne crée ni ne détruit : il prend la différence. Un joueur
      // chanceux peut très bien faire créer des pièces à la roulette sur
      // une journée, et c'est normal.
      const made = v.mint + Math.max(0, v.returned - v.staked);
      const gone = v.burn + Math.max(0, v.staked - v.returned);
      mint += made;
      burn += gone;
      const acc = bySource[source] || (bySource[source] = { source, mint: 0, burn: 0, staked: 0, returned: 0, rounds: 0 });
      acc.mint += made;
      acc.burn += gone;
      acc.staked += v.staked;
      acc.returned += v.returned;
      acc.rounds += v.rounds;
    }
    return { day, mint, burn, net: mint - burn };
  });

  const sources = Object.values(bySource)
    .map((s) => ({
      ...s,
      net: s.mint - s.burn,
      // La redistribution réellement observée sur ce jeu. Elle doit coller
      // au chiffre annoncé sur sa tuile ; sinon, quelque chose ment.
      rtp: s.staked > 0 ? Math.round((s.returned / s.staked) * 10000) / 100 : null,
    }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  const total = daily.reduce((acc, d) => ({
    mint: acc.mint + d.mint, burn: acc.burn + d.burn, net: acc.net + d.net,
  }), { mint: 0, burn: 0, net: 0 });

  return { daily, sources, total, days: keys.length };
}

module.exports = { mint, burn, play, flush, start, view, dayOf, DAYS_KEPT };
