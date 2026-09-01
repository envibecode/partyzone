'use strict';

/** Normalise un texte pour la comparaison : minuscules, sans accents, sans ponctuation. */
function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(le|la|les|l|un|une|des|du|de|d|the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Distance de Levenshtein (itérative, mémoire O(n)). */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Compare une proposition à une réponse attendue avec tolérance aux fautes de frappe.
 * Retourne un score 0..1 (1 = identique).
 */
function similarity(guess, answer) {
  const g = normalize(guess);
  const a = normalize(answer);
  if (!g || !a) return 0;
  if (g === a) return 1;
  // proposition contenue dans la réponse (ou l'inverse) et suffisamment longue
  if (a.length >= 5 && g.length >= 4 && (a.includes(g) || g.includes(a))) {
    return 0.94;
  }
  const dist = levenshtein(g, a);
  const max = Math.max(g.length, a.length);
  return 1 - dist / max;
}

/** Tolérance : plus le mot est court, plus on est strict. */
function isCloseEnough(guess, answer) {
  const a = normalize(answer);
  if (!a) return false;
  const threshold = a.length <= 4 ? 1 : a.length <= 8 ? 0.85 : 0.8;
  return similarity(guess, answer) >= threshold;
}

/** Compare à une liste de réponses acceptées. */
function matchesAny(guess, answers) {
  return (answers || []).some((ans) => isCloseEnough(guess, ans));
}

function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pick(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/** Masque une réponse : "Albert Einstein" → "_ _ _ _ _ _   _ _ _ _ _ _ _ _" avec quelques lettres révélées. */
function maskAnswer(answer, revealRatio = 0) {
  const chars = String(answer).split('');
  const letterIndexes = chars.map((c, i) => (/[a-zA-Z0-9À-ÿ]/.test(c) ? i : -1)).filter((i) => i >= 0);
  const revealCount = Math.floor(letterIndexes.length * revealRatio);
  // révélation déterministe et « étalée » plutôt qu'aléatoire, pour un dévoilement lisible
  const revealed = new Set();
  if (revealCount > 0) {
    const step = letterIndexes.length / revealCount;
    for (let k = 0; k < revealCount; k++) {
      revealed.add(letterIndexes[Math.floor(k * step)]);
    }
  }
  return chars
    .map((c, i) => {
      if (!/[a-zA-Z0-9À-ÿ]/.test(c)) return c;
      return revealed.has(i) ? c : '·';
    })
    .join('');
}

module.exports = { normalize, levenshtein, similarity, isCloseEnough, matchesAny, shuffle, pick, maskAnswer };
