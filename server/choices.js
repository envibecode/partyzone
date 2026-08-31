'use strict';
/**
 * Construction des propositions du mode QCM.
 *
 * Le but : quatre réponses crédibles. Un leurre absurde rend la question
 * gratuite, un leurre trop proche la rend injuste. On s'appuie donc sur
 * la nature de la réponse plutôt que sur un tirage au sort aveugle.
 */
const { normalize, shuffle } = require('./util');

/** « 206 » est un nombre, « 14 juillet » n'en est pas un. */
function asNumber(answer) {
  const clean = String(answer).replace(/\s/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(clean) ? Number(clean) : null;
}

/**
 * Leurres numériques plausibles : on reste dans le même ordre de grandeur,
 * et on traite les années à part (±1 à 12 ans, jamais dans le futur du sujet).
 */
function numericDecoys(value, count = 3) {
  const isYear = Number.isInteger(value) && value >= 1000 && value <= 2100;
  const out = new Set();
  const push = (n) => {
    if (n !== value && n > 0 && Number.isFinite(n)) out.add(n);
  };

  if (isYear) {
    const offsets = shuffle([-12, -8, -5, -3, -2, 2, 3, 5, 8, 11]);
    for (const o of offsets) {
      if (out.size >= count * 2) break;
      push(value + o);
    }
  } else if (value <= 12) {
    for (const o of shuffle([-3, -2, -1, 1, 2, 3, 4])) {
      if (out.size >= count * 2) break;
      push(value + o);
    }
  } else if (value <= 200) {
    for (const f of shuffle([0.5, 0.75, 1.25, 1.5, 2, 0.6])) {
      if (out.size >= count * 2) break;
      push(Math.round(value * f));
    }
  } else {
    for (const f of shuffle([0.5, 0.7, 1.3, 1.8, 2.5, 0.25])) {
      if (out.size >= count * 2) break;
      const scaled = value * f;
      // on arrondit comme le ferait un humain : 300000 → 450000, pas 449999
      const magnitude = Math.pow(10, Math.max(0, String(Math.round(scaled)).length - 2));
      push(Math.round(scaled / magnitude) * magnitude);
    }
  }

  return shuffle([...out]).slice(0, count).map(String);
}

/**
 * Fabrique les 4 propositions d'une question de quiz.
 * `pool` est l'ensemble des questions disponibles, pour piocher des leurres
 * textuels dans la même catégorie.
 */
function quizChoices(question, pool) {
  const correct = question.a[0];
  const taken = new Set(question.a.map(normalize));
  const decoys = [];

  const push = (candidate) => {
    const key = normalize(candidate);
    if (!key || taken.has(key)) return;
    taken.add(key);
    decoys.push(String(candidate));
  };

  // 1. Leurres écrits à la main s'il y en a
  for (const d of question.d || []) push(d);

  // 2. Réponse numérique → variations du même ordre de grandeur
  const num = asNumber(correct);
  if (decoys.length < 3 && num !== null) {
    for (const d of numericDecoys(num, 5)) {
      if (decoys.length >= 3) break;
      push(d);
    }
  }

  // 3. Réponse textuelle → autres réponses de la même catégorie
  if (decoys.length < 3) {
    const sameKind = pool.filter(
      (q) => q !== question && q.c === question.c && (asNumber(q.a[0]) === null) === (num === null)
    );
    for (const q of shuffle(sameKind)) {
      if (decoys.length >= 3) break;
      push(q.a[0]);
    }
  }

  // 4. Dernier recours : n'importe quelle autre réponse du même type
  if (decoys.length < 3) {
    const anyKind = pool.filter((q) => q !== question && (asNumber(q.a[0]) === null) === (num === null));
    for (const q of shuffle(anyKind)) {
      if (decoys.length >= 3) break;
      push(q.a[0]);
    }
  }

  return shuffle([correct, ...decoys.slice(0, 3)]);
}

/**
 * Fabrique les 4 propositions d'une manche de blind test.
 * Les leurres sortent de la playlist elle-même : même univers musical,
 * donc pas de réponse évidente par élimination.
 */
function trackChoices(track, allTracks) {
  const label = (t) => `${t.artist} — ${t.title}`;
  const correct = label(track);
  const taken = new Set([normalize(correct)]);
  const decoys = [];

  // On privilégie les titres d'autres artistes, sinon on complète avec le reste.
  const others = allTracks.filter((t) => t !== track);
  const differentArtist = others.filter((t) => normalize(t.artist) !== normalize(track.artist));

  for (const t of [...shuffle(differentArtist), ...shuffle(others)]) {
    if (decoys.length >= 3) break;
    const key = normalize(label(t));
    if (taken.has(key)) continue;
    taken.add(key);
    decoys.push(label(t));
  }

  if (decoys.length < 3) return null; // playlist trop courte pour un QCM honnête
  return shuffle([correct, ...decoys]);
}

module.exports = { quizChoices, trackChoices, numericDecoys, asNumber };
