'use strict';
/**
 * BLINDTEST.
 *
 * La toute première idée du site, revenue à sa place. Une playlist
 * YouTube, un extrait, quatre propositions, et le premier qui trouve
 * marque le plus.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COMMENT ON LIT UNE PLAYLIST SANS CLÉ D'API
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'API YouTube demande une clé, un projet Google, un quota. On s'en passe :
 * c'est le NAVIGATEUR DE L'HÔTE qui charge la playlist dans un lecteur
 * YouTube et qui en lit le contenu (`getPlaylist`, `getVideoData`), puis
 * l'envoie au serveur. Zéro configuration, zéro clé à mettre chez
 * l'hébergeur, et ça marche avec n'importe quelle playlist publique.
 *
 * Le serveur, lui, ne fait jamais confiance à ce qu'on lui envoie : la
 * liste est nettoyée, plafonnée, et c'est LUI qui tire les extraits et
 * fabrique les propositions.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LE SERVEUR NE DIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Pendant une manche, personne ne reçoit le titre. Les quatre propositions
 * partent MÉLANGÉES et le serveur garde pour lui laquelle est la bonne ;
 * les clients renvoient un numéro. La bonne réponse n'apparaît qu'au
 * dévoilement.
 *
 * UNE HONNÊTETÉ : le morceau est joué par le lecteur YouTube de chaque
 * joueur, et ce lecteur connaît le titre de ce qu'il joue. Quelqu'un qui
 * ouvre la console de son navigateur peut donc le lire. Il n'y a pas moyen
 * d'éviter ça en lisant YouTube côté navigateur — il faudrait diffuser le
 * son depuis le serveur, ce qui est une tout autre affaire. Entre amis,
 * c'est un tricheur qui se fatigue plus qu'il ne gagne ; c'est écrit ici
 * plutôt que caché.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TROIS DÉCISIONS
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  1. LA MUSIQUE NE S'ARRÊTE PAS QUAND ON RÉPOND.
 *     C'était la demande d'origine, et elle est juste : couper le son au
 *     premier bon buzz punit les trois autres, qui n'ont plus rien à
 *     chercher. Ici le morceau va au bout de la manche, et on voit les
 *     autres trouver — ou ne pas trouver.
 *
 *  2. RÉPONDRE VITE RAPPORTE PLUS, MAIS RÉPONDRE JUSTE RAPPORTE TOUJOURS.
 *     Le barème part de 1000 et décroît avec le temps, jusqu'à 300. Même
 *     le dernier à trouver marque quelque chose : sinon, dès qu'on est
 *     doublé, la manche est finie pour soi.
 *
 *  3. ON NE PEUT RÉPONDRE QU'UNE FOIS.
 *     Sinon il suffit de cliquer les quatre propositions.
 */

const { Room } = require('./rooms');
const fair = require('../fair');

const MIN = 1;   // le blindtest se joue très bien seul, pour s'entraîner
const MAX = 12;

/** Les trois difficultés : durée d'écoute, nombre de propositions, indice. */
const LEVELS = {
  facile:    { ms: 30000, choices: 4, hint: 10000, label: 'Facile' },
  moyen:     { ms: 20000, choices: 4, hint: 0, label: 'Moyen' },
  difficile: { ms: 12000, choices: 6, hint: 0, label: 'Difficile' },
};

const REVEAL_MS = 6000;
const MAX_TRACKS = 200;
const BEST = 1000;      // points d'une réponse instantanée
const FLOOR = 300;      // points d'une réponse à la dernière seconde
const FIRST_BONUS = 200;

/* ─── Nettoyage des titres ─────────────────────────────────
 *
 * Les titres YouTube sont pleins de bruit : « (Official Video) »,
 * « [4K Remaster] », « | Lyrics ». On l'enlève pour que les propositions
 * soient lisibles — et surtout pour que deux morceaux du même artiste ne
 * se distinguent pas par leur suffixe promotionnel.
 */
const NOISE = /\s*[([]\s*(official|officiel|clip|video|vidéo|audio|lyrics?|paroles|hd|4k|hq|remaster(ed)?|visualizer|mv|m\/v|live|version longue|extended)[^)\]]*[)\]]/gi;

function cleanTitle(raw) {
  return String(raw || '')
    .replace(NOISE, '')
    .replace(/\s*[|·–-]\s*(official|lyrics?|audio|video|clip)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function shuffleFrom(list, serverSeed, clientSeed, nonce) {
  const out = [...list];
  const rolls = fair.floats(serverSeed, clientSeed, nonce, Math.max(1, out.length));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rolls[out.length - 1 - i] * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ═══════════ La partie ═══════════ */

class Blindtest extends Room {
  constructor(io) {
    super(io, { game: 'blindtest', min: MIN, max: MAX, name: 'Blindtest' });

    /* Réglages de l'hôte. */
    this.level = 'moyen';
    this.roundsTarget = 10;

    /* La playlist, envoyée par le navigateur de l'hôte. */
    this.playlistId = null;
    this.playlistTitle = '';
    this.tracks = [];        // { id, title, author }

    /* La partie. */
    this.round = 0;
    this.order = [];         // les index de pistes tirés pour la partie
    this.current = null;     // { track, choices, answer, startedAt, offset }
    this.answers = new Map();// id → { choice, at, right, points }
    this.scores = new Map();
    this.streaks = new Map();
    this.result = null;
    this.log = [];
    this.deadline = 0;
    this.timer = null;

    this.serverSeed = fair.newServerSeed();
    this.serverSeedHash = fair.hashSeed(this.serverSeed);
    this.previousSeed = null;
  }

  nameOf(id) { const p = this.playerOf(id); return p ? p.name : '—'; }

  note(text, kind = 'info') {
    this.log.unshift({ text, kind, at: Date.now() });
    this.log.length = Math.min(this.log.length, 30);
  }

  /* ─── Réglages ─────────────────────────────────────────────────────── */

  configure(userId, { level, rounds } = {}) {
    if (userId !== this.hostId) return { ok: false, message: 'Seul l’hôte règle la partie.' };
    if (this.phase !== 'lobby') return { ok: false, message: 'La partie est en cours.' };
    if (LEVELS[level]) this.level = level;
    if ([5, 10, 20].includes(Number(rounds))) this.roundsTarget = Number(rounds);
    this.broadcast();
    return { ok: true };
  }

  /**
   * L'hôte envoie le contenu de la playlist, lu par son navigateur.
   *
   * On ne fait aucune confiance à ce qui arrive : on nettoie les titres, on
   * jette les doublons et les entrées vides, on plafonne. Un client bricolé
   * ne doit pas pouvoir nous faire garder deux mille morceaux en mémoire.
   */
  setPlaylist(userId, { id, title, tracks } = {}) {
    if (userId !== this.hostId) return { ok: false, message: 'Seul l’hôte choisit la playlist.' };
    if (this.phase !== 'lobby') return { ok: false, message: 'La partie est en cours.' };
    if (!Array.isArray(tracks)) return { ok: false, message: 'Playlist illisible.' };

    const seen = new Set();
    const clean = [];
    for (const t of tracks) {
      const vid = String((t && t.id) || '').trim();
      if (!/^[\w-]{6,20}$/.test(vid) || seen.has(vid)) continue;
      const name = cleanTitle(t.title);
      if (!name) continue;
      seen.add(vid);
      clean.push({ id: vid, title: name, author: cleanTitle(t.author).slice(0, 60) });
      if (clean.length >= MAX_TRACKS) break;
    }

    if (clean.length < 4) {
      return { ok: false, message: 'Il faut au moins quatre morceaux lisibles dans la playlist.' };
    }

    this.playlistId = String(id || '').slice(0, 60) || null;
    this.playlistTitle = cleanTitle(title).slice(0, 90);
    this.tracks = clean;
    this.note(`Playlist chargée : ${clean.length} morceaux.`, 'ok');
    this.broadcast();
    return { ok: true, count: clean.length };
  }

  /* ─── Démarrage ────────────────────────────────────────────────────── */

  start(userId) {
    if (userId !== this.hostId) return { ok: false, message: 'Seul l’hôte lance la partie.' };
    if (this.phase !== 'lobby' && this.phase !== 'over') {
      return { ok: false, message: 'La partie est déjà lancée.' };
    }
    if (this.tracks.length < 4) {
      return { ok: false, message: 'Charge d’abord une playlist YouTube.' };
    }

    // On tire les pistes de la partie d'un coup : personne ne repasse deux
    // fois, et on sait tout de suite combien de manches on peut faire.
    const picks = shuffleFrom(this.tracks.map((_, i) => i), this.serverSeed, this.code, 1);
    this.order = picks.slice(0, Math.min(this.roundsTarget, picks.length));

    this.round = 0;
    this.scores = new Map(this.players.map((p) => [p.id, 0]));
    this.streaks = new Map();
    this.result = null;
    this.log = [];
    this.note(`Partie lancée — ${this.order.length} manches, niveau ${LEVELS[this.level].label.toLowerCase()}.`, 'ok');
    this.nextRound();
    return { ok: true };
  }

  /* ─── Une manche ───────────────────────────────────────────────────── */

  nextRound() {
    clearTimeout(this.timer);
    if (this.round >= this.order.length) return this.finish();

    const level = LEVELS[this.level];
    const track = this.tracks[this.order[this.round]];
    this.round += 1;

    /*
     * Les mauvaises réponses viennent de la playlist elle-même.
     *
     * C'est ce qui rend le jeu intéressant : à choisir entre quatre
     * morceaux de la même soirée, il faut vraiment reconnaître celui qui
     * joue. Des titres pris au hasard sur internet seraient éliminables
     * sans écouter.
     *
     * En difficile, on privilégie les morceaux du MÊME artiste — c'est là
     * que ça devient méchant.
     */
    const others = this.tracks.filter((t) => t.id !== track.id);
    const need = level.choices - 1;
    const decoys = [];

    // En difficile, on prend D'ABORD tout ce qu'on peut du même artiste,
    // puis on complète avec le reste. Prendre « tout ou rien » ratait le
    // cas le plus courant : une playlist avec trois ou quatre morceaux par
    // artiste, où il y a de quoi piéger sans pouvoir remplir six cases.
    if (this.level === 'difficile' && track.author) {
      const kin = others.filter((t) => t.author === track.author);
      decoys.push(...shuffleFrom(kin, this.serverSeed, this.code, 100 + this.round).slice(0, need));
    }

    const rest = shuffleFrom(
      others.filter((t) => !decoys.some((d) => d.id === t.id)),
      this.serverSeed, this.code, 300 + this.round,
    );
    while (decoys.length < need && rest.length) decoys.push(rest.shift());

    const choices = shuffleFrom([track, ...decoys], this.serverSeed, this.code, 500 + this.round);
    const answer = choices.findIndex((c) => c.id === track.id);

    // Un extrait qui ne commence pas au début : la première seconde d'un
    // morceau est souvent muette, et l'intro est parfois plus connue que le
    // morceau. On tombe quelque part entre 15 et 60 secondes.
    const [roll] = fair.floats(this.serverSeed, this.code, 900 + this.round, 1);
    const offset = 15 + Math.floor(roll * 45);

    this.current = {
      track,
      choices: choices.map((c) => c.title),
      answer,
      offset,
      startedAt: Date.now(),
      firstId: null,
    };
    this.answers = new Map();
    this.phase = 'ecoute';
    this.arm(level.ms, () => this.reveal());
    this.broadcast();
  }

  /**
   * Une réponse.
   *
   * Une seule par manche et par personne : sinon il suffit de cliquer les
   * quatre propositions. Le barème décroît avec le temps mais ne descend
   * jamais à zéro — le dernier à trouver marque quand même, sans quoi une
   * manche est finie pour soi dès qu'on est doublé.
   */
  answer(userId, index) {
    if (this.phase !== 'ecoute' || !this.current) return { ok: false, message: 'Aucune manche en cours.' };
    if (!this.playerOf(userId)) return { ok: false, message: 'Tu n’es pas dans ce salon.' };
    if (this.answers.has(userId)) return { ok: false, message: 'Tu as déjà répondu.' };

    const n = Math.floor(Number(index));
    if (!(n >= 0 && n < this.current.choices.length)) return { ok: false, message: 'Réponse invalide.' };

    const level = LEVELS[this.level];
    const elapsed = Date.now() - this.current.startedAt;
    const right = n === this.current.answer;

    let points = 0;
    if (right) {
      const ratio = Math.max(0, 1 - elapsed / level.ms);
      points = Math.round(FLOOR + (BEST - FLOOR) * ratio);
      if (!this.current.firstId) {
        this.current.firstId = userId;
        points += FIRST_BONUS;
      }
      // Une série de bonnes réponses : trois d'affilée valent un petit
      // supplément. C'est ce qui récompense la constance sur vingt manches.
      const streak = (this.streaks.get(userId) || 0) + 1;
      this.streaks.set(userId, streak);
      if (streak >= 3) points += 100;
      this.scores.set(userId, (this.scores.get(userId) || 0) + points);
    } else {
      this.streaks.set(userId, 0);
    }

    this.answers.set(userId, { choice: n, at: elapsed, right, points });
    this.broadcast();

    // Tout le monde a répondu : on dévoile sans attendre. La musique, elle,
    // a déjà fait son temps — c'est la manche qui s'accélère, pas le son
    // qui se coupe au premier bon buzz.
    if (this.players.every((p) => !p.connected || this.answers.has(p.id))) {
      this.arm(1200, () => this.reveal());
    }
    return { ok: true, right };
  }

  reveal() {
    clearTimeout(this.timer);
    if (this.phase !== 'ecoute' || !this.current) return;
    this.phase = 'reponse';

    const found = [...this.answers.entries()].filter(([, a]) => a.right).length;
    this.note(found
      ? `${this.current.track.title} — ${found} bonne${found > 1 ? 's' : ''} réponse${found > 1 ? 's' : ''}.`
      : `${this.current.track.title} — personne n’a trouvé.`, found ? 'ok' : 'miss');

    this.arm(REVEAL_MS, () => this.nextRound());
    this.broadcast();
  }

  /** L'hôte peut enchaîner sans attendre le dévoilement. */
  skip(userId) {
    if (userId !== this.hostId) return { ok: false, message: 'Seul l’hôte peut passer.' };
    if (this.phase === 'ecoute') { this.reveal(); return { ok: true }; }
    if (this.phase === 'reponse') { this.nextRound(); return { ok: true }; }
    return { ok: false, message: 'Rien à passer.' };
  }

  /* ─── Fin ──────────────────────────────────────────────────────────── */

  finish() {
    clearTimeout(this.timer);
    this.phase = 'over';
    this.current = null;

    const table = this.players
      .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, points: this.scores.get(p.id) || 0 }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

    const best = table.length ? table[0].points : 0;
    this.result = {
      table,
      // Une égalité en tête fait deux vainqueurs : on ne départage pas au
      // hasard une partie que deux personnes ont gagnée.
      winnerIds: table.filter((t) => t.points === best && best > 0).map((t) => t.id),
      rounds: this.round,
      playlist: this.playlistTitle,
    };
    this.previousSeed = { serverSeed: this.serverSeed, serverSeedHash: this.serverSeedHash };
    this.note(this.result.winnerIds.length
      ? `Terminé — ${this.result.winnerIds.map((id) => this.nameOf(id)).join(' et ')} l’emporte.`
      : 'Terminé — personne n’a marqué.', 'end');
    this.broadcast();
    if (this.onEnd) this.onEnd(this);
  }

  winners() { return this.result ? this.result.winnerIds : []; }

  /* ─── Minuterie ────────────────────────────────────────────────────── */

  arm(ms, onTimeout) {
    clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { onTimeout(); } catch (err) { console.error('[blindtest]', err.message); }
    }, ms);
  }

  /** Pour la soirée : le classement, c'est celui des points. */
  ranking() {
    if (!this.result) return super.ranking();
    return this.result.table.map((t) => ({ id: t.id, score: t.points }));
  }

  resume() {
    if (this.phase === 'lobby' || this.phase === 'over') return;
    // On redonne une manche complète : être doublé par un déploiement
    // serait la plus bête des défaites.
    if (this.phase === 'ecoute' && this.current) {
      this.current.startedAt = Date.now();
      this.arm(LEVELS[this.level].ms, () => this.reveal());
    } else {
      this.arm(REVEAL_MS, () => this.nextRound());
    }
    this.note('Le serveur a redémarré — la manche repart.', 'info');
    this.broadcast();
  }

  /* ─── L'état ───────────────────────────────────────────────────────── */

  stateFor(playerId) {
    const base = this.baseState();
    const level = LEVELS[this.level];
    const mine = this.answers.get(playerId) || null;
    const revealing = this.phase === 'reponse';

    const board = this.players
      .map((p) => {
        const a = this.answers.get(p.id);
        return {
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          cosmetics: p.cosmetics,
          connected: p.connected,
          you: p.id === playerId,
          points: this.scores.get(p.id) || 0,
          streak: this.streaks.get(p.id) || 0,
          // Pendant l'écoute, on voit QUI a répondu, jamais QUOI : c'est ce
          // qui met la pression sans donner la réponse.
          answered: Boolean(a),
          right: revealing && a ? a.right : undefined,
          gained: revealing && a ? a.points : undefined,
          first: revealing && this.current && this.current.firstId === p.id ? true : undefined,
        };
      })
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

    return {
      ...base,
      level: this.level,
      levelLabel: level.label,
      levelMs: level.ms,
      hintAt: level.hint,
      round: this.round,
      rounds: this.order.length || this.roundsTarget,
      roundsTarget: this.roundsTarget,
      playlist: { id: this.playlistId, title: this.playlistTitle, count: this.tracks.length },
      deadline: this.deadline,
      serverNow: Date.now(),
      board,
      current: this.current ? {
        // Le titre n'est JAMAIS envoyé pendant l'écoute. Les propositions
        // partent mélangées, et le serveur garde la bonne pour lui.
        videoId: this.current.track.id,
        offset: this.current.offset,
        choices: this.current.choices,
        // L'indice du mode facile : l'artiste, après dix secondes.
        hint: level.hint && Date.now() - this.current.startedAt > level.hint
          ? this.current.track.author : null,
        answer: revealing ? this.current.answer : undefined,
        title: revealing ? this.current.track.title : undefined,
        author: revealing ? this.current.track.author : undefined,
        firstName: revealing && this.current.firstId ? this.nameOf(this.current.firstId) : null,
      } : null,
      you: {
        id: playerId,
        answered: Boolean(mine),
        choice: mine ? mine.choice : null,
        right: revealing && mine ? mine.right : undefined,
        gained: revealing && mine ? mine.points : undefined,
        points: this.scores.get(playerId) || 0,
        isHost: this.hostId === playerId,
      },
      log: this.log,
      result: this.result,
      fair: { serverSeedHash: this.serverSeedHash, previous: this.previousSeed },
    };
  }

  broadcast() {
    for (const player of this.players) {
      const state = this.stateFor(player.id);
      for (const socketId of player.sockets) this.io.to(socketId).emit('bt:state', state);
    }
    this.broadcastWatchers('bt:state');
  }

  destroy() {
    clearTimeout(this.timer);
    super.destroy();
  }
}

module.exports = { Blindtest, LEVELS, MIN, MAX, cleanTitle, shuffleFrom, BEST, FLOOR, FIRST_BONUS };
