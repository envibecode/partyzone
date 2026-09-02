'use strict';
const ledger = require('../ledger');
/**
 * LE RANG PARTY.
 *
 * La section Party n'a rien à voir avec le casino, et son rang non plus :
 * on ne mise pas de pièces, on ne peut rien y gagner ni y perdre. Le rang
 * ne récompense que le fait de jouer avec les autres — c'est pour ça qu'une
 * partie perdue rapporte quand même, un peu moins qu'une gagnée.
 *
 * Le classement Party est donc lisible pour ce qu'il est : qui vient jouer
 * le soir, pas qui a eu de la chance à la roulette.
 */

const MAX_LEVEL = 60;

/** Il faut de plus en plus de parties pour monter, sans jamais devenir absurde. */
function xpToNext(level) {
  return Math.round(60 + level * 34 + Math.pow(level, 1.7) * 4);
}

function levelFromXp(xp) {
  let level = 1;
  let spent = 0;
  let need = xpToNext(1);
  while (level < MAX_LEVEL && xp >= spent + need) {
    spent += need;
    level++;
    need = xpToNext(level);
  }
  return {
    level,
    into: Math.max(0, xp - spent),
    need: level >= MAX_LEVEL ? 0 : need,
    ratio: level >= MAX_LEVEL ? 1 : Math.min(1, (xp - spent) / need),
  };
}

/** Des titres de salon, pas des titres de casino. */
function title(level) {
  if (level >= 55) return 'PATRON DU SALON';
  if (level >= 42) return 'MYTHO PROFESSIONNEL';
  if (level >= 32) return 'COMÉDIEN';
  if (level >= 24) return 'BEAU PARLEUR';
  if (level >= 17) return 'SUSPECT HABITUEL';
  if (level >= 11) return 'BAVARD';
  if (level >= 6) return 'INVITÉ';
  return 'NOUVEAU';
}

/**
 * La récompense d'un passage de niveau, en pièces du casino.
 *
 * C'est la passerelle entre les deux sections : on ne mise rien en Party,
 * mais y venir jouer finance les soirées casino. Le montant monte avec le
 * niveau, sans jamais devenir une meilleure source que le jeu lui-même —
 * atteindre le niveau 10 rapporte à peu près ce qu'une bonne main de
 * blackjack rapporte, et il faut une dizaine de parties pour y arriver.
 */
function levelReward(level) {
  return 300 + Math.round(Math.pow(level, 1.55) * 55);
}

function blank() {
  return {
    xp: 0,
    played: 0,
    won: 0,
    games: {}, // gameId → { played, won }
    rewarded: 1, // dernier niveau déjà payé
  };
}

/** Remet en forme un profil ancien qui n'avait pas encore de section Party. */
function ensure(profile) {
  if (!profile.party) profile.party = blank();
  const p = profile.party;
  if (typeof p.xp !== 'number') p.xp = 0;
  if (typeof p.played !== 'number') p.played = 0;
  if (typeof p.won !== 'number') p.won = 0;
  if (!p.games || typeof p.games !== 'object') p.games = {};
  if (typeof p.rewarded !== 'number') p.rewarded = levelFromXp(p.xp).level;
  return p;
}

/**
 * Enregistre une partie terminée.
 *
 * `players` sert à ce qu'une partie à sept rapporte plus qu'un duel : c'est
 * l'inverse exact du casino, où il vaut mieux être seul.
 */
function record(profile, gameId, { won = false, players = 3, rounds = 1 } = {}) {
  const p = ensure(profile);
  const before = levelFromXp(p.xp).level;

  const base = 18 + Math.min(9, players) * 6 + Math.min(12, rounds) * 3;
  const gained = Math.round(won ? base * 1.6 : base);

  p.xp += gained;
  p.played += 1;
  if (won) p.won += 1;

  if (!p.games[gameId]) p.games[gameId] = { played: 0, won: 0 };
  p.games[gameId].played += 1;
  if (won) p.games[gameId].won += 1;

  const lvl = levelFromXp(p.xp);

  // Chaque niveau franchi paie une fois, et une seule. On boucle plutôt que
  // de payer le dernier niveau : un gros gain d'XP peut en franchir deux.
  let coins = 0;
  const levelsGained = [];
  while (p.rewarded < lvl.level) {
    p.rewarded += 1;
    const reward = levelReward(p.rewarded);
    coins += reward;
    levelsGained.push({ level: p.rewarded, coins: reward });
  }
  if (coins > 0) {
    profile.vault.coins += coins;
    ledger.mint('rang Party', coins);
  }

  return {
    gained,
    level: lvl.level,
    title: title(lvl.level),
    levelUp: lvl.level > before,
    coins,
    levelsGained,
  };
}

function view(profile) {
  const p = ensure(profile);
  const lvl = levelFromXp(p.xp);
  return {
    xp: p.xp,
    level: lvl.level,
    into: lvl.into,
    need: lvl.need,
    ratio: lvl.ratio,
    title: title(lvl.level),
    played: p.played,
    won: p.won,
    games: p.games,
    nextReward: lvl.level >= MAX_LEVEL ? null : levelReward(lvl.level + 1),
  };
}

module.exports = { blank, ensure, record, view, levelFromXp, title, levelReward, MAX_LEVEL };
