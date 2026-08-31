'use strict';
/**
 * Les trois réglages de difficulté, partagés par le blind test et le quiz.
 * Le multiplicateur récompense ceux qui jouent en mode dur : il s'applique
 * aux points de la partie, donc aussi à l'XP versée au classement général.
 */
const DIFFICULTIES = {
  rookie: {
    id: 'rookie',
    name: 'ROOKIE',
    color: 'green',
    mult: 1,
    blurb: 'Chrono large, indices généreux. Pour découvrir.',
    blindtest: { seconds: 40, hintFrom: 0.3 },
    quiz: { seconds: 30, hintFrom: 0.3 },
  },
  veteran: {
    id: 'veteran',
    name: 'VETERAN',
    color: 'yellow',
    mult: 1.6,
    blurb: 'Chrono serré, indices tardifs. Le mode par défaut.',
    blindtest: { seconds: 26, hintFrom: 0.6 },
    quiz: { seconds: 18, hintFrom: 0.6 },
  },
  nightmare: {
    id: 'nightmare',
    name: 'NIGHTMARE',
    color: 'pink',
    mult: 2.5,
    blurb: 'Aucun indice, chrono minimal. Points x2.5.',
    blindtest: { seconds: 16, hintFrom: 2 },
    quiz: { seconds: 11, hintFrom: 2 },
  },
};

const ORDER = ['rookie', 'veteran', 'nightmare'];

function resolve(id) {
  return DIFFICULTIES[id] || DIFFICULTIES.veteran;
}

/** Liste envoyée au navigateur pour construire le sélecteur. */
function list(game) {
  return ORDER.map((id) => {
    const d = DIFFICULTIES[id];
    return {
      id: d.id,
      name: d.name,
      color: d.color,
      mult: d.mult,
      blurb: d.blurb,
      seconds: d[game] ? d[game].seconds : null,
    };
  });
}

module.exports = { DIFFICULTIES, ORDER, resolve, list };
