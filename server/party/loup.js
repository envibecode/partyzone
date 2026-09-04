'use strict';
/**
 * LOUP-GAROU.
 *
 * Le village dort, les loups se réveillent, quelqu'un meurt, on accuse le
 * mauvais, on recommence. Le plus vieux jeu de soirée du monde.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LE SITE FAIT, ET CE QU'IL NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le site tient les rôles, les nuits, les votes et les morts. Il ne tient
 * PAS la parole : le débat se fait de vive voix, sur Discord, comme à une
 * vraie table. C'est ce qui fait qu'on peut jouer sans serveur relais audio
 * et sans que le jeu soit moins bon — au contraire, un Loup-garou où l'on
 * s'écrit est un Loup-garou triste.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES CINQ DÉCISIONS
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  1. LE SERVEUR EST LE SEUL À CONNAÎTRE LES RÔLES.
 *     Chaque joueur reçoit un état construit pour lui : son rôle, et rien
 *     d'autre. Les loups se voient entre eux parce que la règle le veut ;
 *     personne d'autre ne voit quoi que ce soit. Un banc d'essai vérifie
 *     qu'aucun rôle ne traverse jamais l'état de quelqu'un d'autre.
 *
 *  2. LES MORTS NE PARLENT PAS AUX VIVANTS.
 *     Le salon a déjà un canal « fantôme » pour les éliminés. On le
 *     réutilise : un mort peut commenter, seuls les autres morts le lisent.
 *     Sans ça, la première victime souffle la réponse et la partie est finie.
 *
 *  3. UNE NUIT NE BLOQUE JAMAIS SUR UN ABSENT.
 *     Chaque phase a son minuteur. Le loup qui ne vote pas vote blanc, la
 *     voyante qui ne regarde pas ne regarde pas. Personne n'attend trois
 *     minutes que quelqu'un revienne des toilettes.
 *
 *  4. LE CHASSEUR TIRE, MÊME LA NUIT.
 *     C'est la règle, et c'est le meilleur moment du jeu. Sa mort ouvre une
 *     phase à part : tout s'arrête, il désigne, on continue.
 *
 *  5. ON DIT TOUJOURS LE RÔLE DES MORTS.
 *     Certaines tables cachent le rôle des éliminés. C'est plus dur et
 *     beaucoup moins amusant : la moitié du plaisir est de découvrir qu'on
 *     vient de brûler la voyante.
 */

const { Room } = require('./rooms');
const fair = require('../fair');

const MIN = 4;
const MAX = 16;

const NIGHT_MS = 45 * 1000;     // les loups, la voyante, la sorcière
const DEBATE_MS = 150 * 1000;   // le débat, de vive voix sur Discord
const VOTE_MS = 60 * 1000;
const REVEAL_MS = 8000;
const SHOT_MS = 30 * 1000;      // le chasseur choisit sa cible

/* ─── Les rôles ────────────────────────────────────────── */

const ROLES = {
  loup: {
    name: 'Loup-garou', camp: 'loups', emoji: '🐺',
    blurb: 'Chaque nuit, tu dévores un villageois avec les autres loups. Le jour, tu mens.',
  },
  villageois: {
    name: 'Villageois', camp: 'village', emoji: '🧑‍🌾',
    blurb: 'Aucun pouvoir. Ta voix au vote, et ta capacité à écouter.',
  },
  voyante: {
    name: 'Voyante', camp: 'village', emoji: '🔮',
    blurb: 'Chaque nuit, tu découvres le rôle d’une personne. Le dire trop tôt te tue.',
  },
  sorciere: {
    name: 'Sorcière', camp: 'village', emoji: '⚗️',
    blurb: 'Deux potions pour toute la partie : une pour sauver la victime des loups, une pour tuer.',
  },
  chasseur: {
    name: 'Chasseur', camp: 'village', emoji: '🏹',
    blurb: 'Quand tu meurs, tu emportes quelqu’un avec toi. Même la nuit.',
  },
};

/**
 * La composition du village.
 *
 * Un quart de loups, arrondi au plus proche, jamais moins d'un ni plus du
 * tiers : en dessous les loups perdent toujours, au-dessus le village n'a
 * aucune chance. Les rôles spéciaux arrivent dans l'ordre voyante,
 * sorcière, chasseur — la voyante d'abord parce que c'est elle qui donne
 * au village de quoi jouer.
 */
function composition(n) {
  const wolves = Math.max(1, Math.min(Math.floor(n / 3), Math.round(n / 4)));
  const roles = new Array(wolves).fill('loup');
  const specials = ['voyante', 'sorciere', 'chasseur'];
  for (const role of specials) {
    if (roles.length >= n) break;
    // Il faut toujours au moins deux villageois ordinaires : un village
    // entièrement composé de pouvoirs n'est plus un village.
    if (n - roles.length <= 2) break;
    roles.push(role);
  }
  while (roles.length < n) roles.push('villageois');
  return roles;
}

/** La composition annoncée dans le salon, en toutes lettres. */
function preview(n) {
  if (n < MIN) return { ok: false, text: `Il faut au moins ${MIN} joueurs.` };
  const roles = composition(n);
  const count = {};
  for (const r of roles) count[r] = (count[r] || 0) + 1;
  const parts = [];
  const say = (key, one, many) => {
    if (!count[key]) return;
    parts.push(count[key] > 1 ? `${count[key]} ${many}` : one);
  };
  say('loup', 'un loup', 'loups');
  say('voyante', 'une voyante', 'voyantes');
  say('sorciere', 'une sorcière', 'sorcières');
  say('chasseur', 'un chasseur', 'chasseurs');
  say('villageois', 'un villageois', 'villageois');
  return { ok: true, text: `À ${n}, le village comptera ${parts.join(', ')}.`, count };
}

function shuffleFrom(list, serverSeed, clientSeed, nonce) {
  const out = [...list];
  const rolls = fair.floats(serverSeed, clientSeed, nonce, out.length);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rolls[out.length - 1 - i] * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ═══════════ La partie ═══════════ */

class Loup extends Room {
  constructor(io) {
    super(io, { game: 'loup', min: MIN, max: MAX, name: 'Loup-garou' });

    /* Réglages de l'hôte. */
    this.debateMs = DEBATE_MS;
    this.revealRoles = true;   // on dit le rôle des morts

    /* État. */
    this.night = 0;
    this.roles = new Map();     // id → clé de rôle
    this.alive = new Set();
    this.deaths = [];           // les morts de la nuit en cours
    this.wolfVotes = new Map(); // id du loup → id de la cible
    this.seerLook = null;       // { byId, targetId, role }
    this.seerSeen = new Map();  // id de la voyante → [{ id, name, role }]
    this.witch = { heal: true, kill: true, saved: false, killed: null };
    this.victim = null;         // la victime désignée par les loups
    this.votes = new Map();     // id → id
    this.shot = null;           // { byId } quand un chasseur doit tirer
    this.lastNight = null;      // le récit du matin
    this.deadRoles = [];        // { id, name, role, how }
    this.result = null;
    this.log = [];
    this.deadline = 0;
    this.timer = null;

    this.serverSeed = fair.newServerSeed();
    this.serverSeedHash = fair.hashSeed(this.serverSeed);
    this.previousSeed = null;
  }

  /* ─── Utilitaires ──────────────────────────────────────────────────── */

  nameOf(id) {
    const p = this.playerOf(id);
    return p ? p.name : '—';
  }

  note(text, kind = 'info') {
    this.log.unshift({ text, kind, at: Date.now() });
    this.log.length = Math.min(this.log.length, 40);
  }

  roleOf(id) { return this.roles.get(id) || null; }
  campOf(id) { const r = this.roleOf(id); return r ? ROLES[r].camp : null; }
  isAlive(id) { return this.alive.has(id); }

  livingIds() { return [...this.alive]; }
  wolves() { return this.livingIds().filter((id) => this.roleOf(id) === 'loup'); }
  villagers() { return this.livingIds().filter((id) => this.roleOf(id) !== 'loup'); }
  holderOf(role) { return [...this.roles.entries()].find(([, r]) => r === role)?.[0] || null; }

  /* ─── Réglages ─────────────────────────────────────────────────────── */

  configure(userId, { debate, revealRoles } = {}) {
    if (userId !== this.hostId) return { ok: false, message: 'Seul l’hôte règle la partie.' };
    if (this.phase !== 'lobby') return { ok: false, message: 'La partie est en cours.' };
    if ([90, 150, 240].includes(Number(debate))) this.debateMs = Number(debate) * 1000;
    if (typeof revealRoles === 'boolean') this.revealRoles = revealRoles;
    this.broadcast();
    return { ok: true };
  }

  /* ─── Démarrage ────────────────────────────────────────────────────── */

  start(userId) {
    if (userId !== this.hostId) return { ok: false, message: 'Seul l’hôte lance la partie.' };
    if (this.phase !== 'lobby' && this.phase !== 'over') {
      return { ok: false, message: 'La partie est déjà lancée.' };
    }
    const present = this.players.filter((p) => p.connected);
    if (present.length < MIN) return { ok: false, message: `Il faut au moins ${MIN} joueurs.` };

    const ids = present.map((p) => p.id);
    const roles = shuffleFrom(composition(ids.length), this.serverSeed, this.code, 1);

    this.roles = new Map(ids.map((id, i) => [id, roles[i]]));
    this.alive = new Set(ids);
    this.players.forEach((p) => { p.out = !ids.includes(p.id); });
    this.night = 0;
    this.seerSeen = new Map();
    this.witch = { heal: true, kill: true, saved: false, killed: null };
    this.deadRoles = [];
    this.result = null;
    this.log = [];

    const wolves = ids.filter((id) => this.roles.get(id) === 'loup').length;
    this.note(`Le village compte ${ids.length} habitants, dont ${wolves} loup${wolves > 1 ? 's' : ''}.`, 'start');
    this.beginNight();
    return { ok: true };
  }

  /* ─── La nuit ──────────────────────────────────────────────────────── */

  beginNight() {
    clearTimeout(this.timer);
    this.night += 1;
    this.phase = 'nuit';
    this.deaths = [];
    this.wolfVotes = new Map();
    this.seerLook = null;
    this.victim = null;
    this.witch.saved = false;
    this.witch.killed = null;
    this.note(`Nuit ${this.night} — le village s’endort.`, 'night');
    this.arm(NIGHT_MS, () => this.closeNight());
    this.broadcast();
  }

  /**
   * Les loups désignent une victime.
   *
   * Ils votent entre eux, et se voient voter : c'est ce qui permet de se
   * mettre d'accord sans parler. En cas d'égalité, le serveur tranche au
   * hasard plutôt que de laisser la nuit s'éterniser.
   */
  wolfVote(userId, targetId) {
    if (this.phase !== 'nuit') return { ok: false, message: 'Ce n’est pas la nuit.' };
    if (this.roleOf(userId) !== 'loup' || !this.isAlive(userId)) {
      return { ok: false, message: 'Seuls les loups vivants désignent une victime.' };
    }
    if (!this.isAlive(targetId)) return { ok: false, message: 'Cette personne est déjà morte.' };
    if (this.roleOf(targetId) === 'loup') return { ok: false, message: 'Les loups ne se dévorent pas entre eux.' };

    this.wolfVotes.set(userId, targetId);
    this.broadcast();

    // Tous les loups ont voté : on n'attend pas le chronomètre.
    if (this.wolves().every((id) => this.wolfVotes.has(id))) this.settleWolves();
    return { ok: true };
  }

  settleWolves() {
    const tally = new Map();
    for (const target of this.wolfVotes.values()) {
      tally.set(target, (tally.get(target) || 0) + 1);
    }
    let best = 0;
    let picks = [];
    for (const [id, n] of tally) {
      if (n > best) { best = n; picks = [id]; }
      else if (n === best) picks.push(id);
    }
    if (!picks.length) {
      // Aucun loup n'a voté : personne ne meurt cette nuit. C'est rare et
      // c'est juste — on ne tue pas quelqu'un par défaut.
      this.victim = null;
    } else {
      const [roll] = fair.floats(this.serverSeed, this.code, 1000 + this.night, 1);
      this.victim = picks[Math.floor(roll * picks.length)];
    }
    this.broadcast();
  }

  /** La voyante regarde un rôle. Une seule personne par nuit. */
  seerLookAt(userId, targetId) {
    if (this.phase !== 'nuit') return { ok: false, message: 'Ce n’est pas la nuit.' };
    if (this.roleOf(userId) !== 'voyante' || !this.isAlive(userId)) {
      return { ok: false, message: 'Tu n’es pas la voyante.' };
    }
    if (this.seerLook) return { ok: false, message: 'Tu as déjà regardé cette nuit.' };
    if (targetId === userId) return { ok: false, message: 'Tu connais déjà ton propre rôle.' };
    if (!this.isAlive(targetId)) return { ok: false, message: 'Cette personne est morte.' };

    const role = this.roleOf(targetId);
    this.seerLook = { byId: userId, targetId, role };
    const seen = this.seerSeen.get(userId) || [];
    seen.push({ id: targetId, name: this.nameOf(targetId), role, night: this.night });
    this.seerSeen.set(userId, seen);
    this.broadcast();
    return { ok: true, role };
  }

  /**
   * La sorcière agit.
   *
   * Elle voit la victime des loups — c'est le seul moment où quelqu'un
   * d'autre qu'un loup la connaît — et décide de la sauver ou non. Elle
   * peut aussi empoisonner quelqu'un. Une potion de chaque, pour toute la
   * partie : c'est ce qui rend le choix difficile.
   */
  witchAct(userId, { heal = false, kill = null } = {}) {
    if (this.phase !== 'nuit') return { ok: false, message: 'Ce n’est pas la nuit.' };
    if (this.roleOf(userId) !== 'sorciere' || !this.isAlive(userId)) {
      return { ok: false, message: 'Tu n’es pas la sorcière.' };
    }

    if (heal) {
      if (!this.witch.heal) return { ok: false, message: 'Tu as déjà utilisé ta potion de vie.' };
      if (!this.victim) return { ok: false, message: 'Il n’y a personne à sauver cette nuit.' };
      this.witch.heal = false;
      this.witch.saved = true;
      this.note('La sorcière a utilisé sa potion de vie.', 'secret');
    }

    if (kill) {
      if (!this.witch.kill) return { ok: false, message: 'Tu as déjà utilisé ta potion de mort.' };
      if (!this.isAlive(kill)) return { ok: false, message: 'Cette personne est déjà morte.' };
      if (kill === userId) return { ok: false, message: 'Garde ta potion pour quelqu’un d’autre.' };
      this.witch.kill = false;
      this.witch.killed = kill;
    }

    this.broadcast();
    return { ok: true };
  }

  /** La sorcière passe son tour sans rien faire. */
  witchPass(userId) {
    if (this.roleOf(userId) !== 'sorciere') return { ok: false, message: 'Tu n’es pas la sorcière.' };
    this.witch.done = this.night;
    this.broadcast();
    return { ok: true };
  }

  closeNight() {
    clearTimeout(this.timer);
    if (this.phase !== 'nuit') return;
    if (!this.victim && this.wolfVotes.size) this.settleWolves();

    const dead = [];
    if (this.victim && !this.witch.saved) dead.push({ id: this.victim, how: 'loups' });
    if (this.witch.killed) dead.push({ id: this.witch.killed, how: 'potion' });

    this.lastNight = {
      night: this.night,
      saved: this.witch.saved,
      victim: this.victim,
      dead: dead.map((d) => ({ ...d, name: this.nameOf(d.id), role: this.roleOf(d.id) })),
    };

    this.kill(dead, () => this.beginDay());
  }

  /* ─── Mourir ───────────────────────────────────────────────────────── */

  /**
   * Applique une liste de morts, puis continue.
   *
   * Si un chasseur est dedans, tout s'arrête : il doit d'abord tirer. C'est
   * la seule interruption du jeu, et c'est le meilleur moment.
   */
  kill(list, next) {
    for (const d of list) {
      if (!this.isAlive(d.id)) continue;
      this.alive.delete(d.id);
      const player = this.playerOf(d.id);
      if (player) player.out = true;
      this.deadRoles.push({ id: d.id, name: this.nameOf(d.id), role: this.roleOf(d.id), how: d.how, night: this.night });
    }

    const hunter = list.find((d) => this.roleOf(d.id) === 'chasseur');
    if (hunter) {
      this.shot = { byId: hunter.id, then: next };
      this.phase = 'chasseur';
      this.note(`${this.nameOf(hunter.id)} était le chasseur — il tire une dernière fois.`, 'death');
      this.arm(SHOT_MS, () => this.hunterShoot(hunter.id, null, { auto: true }));
      this.broadcast();
      return;
    }

    const done = this.checkEnd();
    if (!done) next();
  }

  hunterShoot(userId, targetId, { auto = false } = {}) {
    if (!this.shot || this.shot.byId !== userId) return { ok: false, message: 'Ce n’est pas à toi de tirer.' };
    const next = this.shot.then;
    this.shot = null;
    clearTimeout(this.timer);

    if (targetId && this.isAlive(targetId)) {
      this.note(`Le chasseur emporte ${this.nameOf(targetId)} avec lui.`, 'death');
      this.alive.delete(targetId);
      const p = this.playerOf(targetId);
      if (p) p.out = true;
      this.deadRoles.push({ id: targetId, name: this.nameOf(targetId), role: this.roleOf(targetId), how: 'chasseur', night: this.night });

      // Un chasseur peut en tuer un autre : la règle s'applique en cascade.
      if (this.roleOf(targetId) === 'chasseur') {
        this.shot = { byId: targetId, then: next };
        this.phase = 'chasseur';
        this.arm(SHOT_MS, () => this.hunterShoot(targetId, null, { auto: true }));
        this.broadcast();
        return { ok: true };
      }
    } else if (auto) {
      this.note('Le chasseur n’a pas tiré à temps.', 'death');
    }

    if (!this.checkEnd()) next();
    return { ok: true };
  }

  /* ─── Le jour ──────────────────────────────────────────────────────── */

  beginDay() {
    clearTimeout(this.timer);
    this.phase = 'matin';

    const dead = (this.lastNight && this.lastNight.dead) || [];
    if (!dead.length) this.note('Au matin, personne n’est mort. Le village respire.', 'day');
    else {
      for (const d of dead) {
        this.note(this.revealRoles
          ? `${d.name} est mort${d.how === 'potion' ? ' empoisonné' : ' dévoré'} — c’était ${ROLES[d.role].name}.`
          : `${d.name} est mort${d.how === 'potion' ? ' empoisonné' : ' dévoré'}.`, 'death');
      }
    }

    this.arm(REVEAL_MS, () => this.beginDebate());
    this.broadcast();
  }

  beginDebate() {
    clearTimeout(this.timer);
    if (this.checkEnd()) return;
    this.phase = 'debat';
    this.note('Le débat est ouvert. Parlez-vous de vive voix — le site ne fait que compter.', 'day');
    this.arm(this.debateMs, () => this.beginVote());
    this.broadcast();
  }

  /** L'hôte peut couper court au débat quand tout le monde a parlé. */
  skipDebate(userId) {
    if (this.phase !== 'debat') return { ok: false, message: 'Le débat n’est pas en cours.' };
    if (userId !== this.hostId) return { ok: false, message: 'Seul l’hôte peut passer au vote.' };
    this.beginVote();
    return { ok: true };
  }

  beginVote() {
    clearTimeout(this.timer);
    if (this.checkEnd()) return;
    this.phase = 'vote';
    this.votes = new Map();
    this.note('Au vote. Qui envoie-t-on au bûcher ?', 'day');
    this.arm(VOTE_MS, () => this.closeVote());
    this.broadcast();
  }

  vote(userId, targetId) {
    if (this.phase !== 'vote') return { ok: false, message: 'Ce n’est pas l’heure du vote.' };
    if (!this.isAlive(userId)) return { ok: false, message: 'Les morts ne votent pas.' };
    if (targetId !== null && !this.isAlive(targetId)) return { ok: false, message: 'Cette personne est déjà morte.' };
    this.votes.set(userId, targetId);
    this.broadcast();
    if (this.livingIds().every((id) => this.votes.has(id))) this.closeVote();
    return { ok: true };
  }

  /**
   * Le dépouillement.
   *
   * En cas d'égalité, PERSONNE ne meurt. C'est la variante la plus jouée et
   * la plus honnête : tirer au sort entre deux accusés à égalité, c'est
   * faire décider le hasard d'une partie que les joueurs viennent de
   * décider de ne pas trancher.
   */
  closeVote() {
    clearTimeout(this.timer);
    if (this.phase !== 'vote') return;

    const tally = new Map();
    for (const target of this.votes.values()) {
      if (!target) continue;
      tally.set(target, (tally.get(target) || 0) + 1);
    }
    let best = 0;
    let picks = [];
    for (const [id, n] of tally) {
      if (n > best) { best = n; picks = [id]; }
      else if (n === best) picks.push(id);
    }

    this.lastVote = {
      counts: [...tally.entries()].map(([id, n]) => ({ id, name: this.nameOf(id), votes: n }))
        .sort((a, b) => b.votes - a.votes),
      tie: picks.length > 1,
      out: picks.length === 1 ? picks[0] : null,
    };

    this.phase = 'bucher';
    if (picks.length !== 1) {
      this.note(picks.length > 1
        ? 'Égalité : personne n’est envoyé au bûcher aujourd’hui.'
        : 'Aucun vote : personne n’est envoyé au bûcher.', 'day');
      this.arm(REVEAL_MS, () => this.beginNight());
      this.broadcast();
      return;
    }

    const out = picks[0];
    this.note(this.revealRoles
      ? `Le village brûle ${this.nameOf(out)} — c’était ${ROLES[this.roleOf(out)].name}.`
      : `Le village brûle ${this.nameOf(out)}.`, 'death');
    this.broadcast();
    this.kill([{ id: out, how: 'bucher' }], () => {
      // On revient explicitement au bûcher : si le brûlé était le chasseur,
      // `kill` a basculé la phase sur « chasseur » et personne ne l'aurait
      // remise — l'écran serait resté bloqué sur un tir déjà fait jusqu'à
      // ce que le minuteur de la nuit prenne le relais.
      this.phase = 'bucher';
      this.arm(REVEAL_MS, () => this.beginNight());
      this.broadcast();
    });
  }

  /* ─── Fin de partie ────────────────────────────────────────────────── */

  /**
   * Les loups gagnent quand ils sont aussi nombreux que les autres : à ce
   * moment-là, le vote ne peut plus jamais les éliminer.
   */
  checkEnd() {
    const wolves = this.wolves().length;
    const others = this.villagers().length;
    if (wolves > 0 && wolves < others) return false;
    if (wolves === 0) return this.finish('village');
    return this.finish('loups');
  }

  finish(camp) {
    clearTimeout(this.timer);
    this.phase = 'over';
    this.shot = null;

    const table = [...this.roles.entries()].map(([id, role]) => ({
      id,
      name: this.nameOf(id),
      role,
      roleName: ROLES[role].name,
      emoji: ROLES[role].emoji,
      camp: ROLES[role].camp,
      alive: this.isAlive(id),
      won: ROLES[role].camp === camp,
    })).sort((a, b) => Number(b.won) - Number(a.won) || a.name.localeCompare(b.name));

    this.result = {
      camp,
      nights: this.night,
      table,
      winnerIds: table.filter((t) => t.won).map((t) => t.id),
    };
    this.previousSeed = { serverSeed: this.serverSeed, serverSeedHash: this.serverSeedHash };
    this.note(camp === 'loups'
      ? 'Les loups ont mangé le village.'
      : 'Le village a éliminé tous les loups.', 'end');
    this.broadcast();
    if (this.onEnd) this.onEnd(this);
    return true;
  }

  winners() { return this.result ? this.result.winnerIds : []; }

  /* ─── Minuterie ────────────────────────────────────────────────────── */

  arm(ms, onTimeout) {
    clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { onTimeout(); } catch (err) { console.error('[loup]', err.message); }
    }, ms);
  }

  /** Reprendre après un redémarrage du serveur, chronomètre à neuf. */
  resume() {
    if (this.phase === 'lobby' || this.phase === 'over') return;
    const again = {
      nuit: () => this.arm(NIGHT_MS, () => this.closeNight()),
      matin: () => this.arm(REVEAL_MS, () => this.beginDebate()),
      debat: () => this.arm(this.debateMs, () => this.beginVote()),
      vote: () => this.arm(VOTE_MS, () => this.closeVote()),
      bucher: () => this.arm(REVEAL_MS, () => this.beginNight()),
      // Le chasseur perd son rappel `then` à la sérialisation : on le
      // remet sur la suite naturelle, la nuit suivante.
      chasseur: () => {
        if (this.shot) this.shot.then = () => this.beginNight();
        this.arm(SHOT_MS, () => this.shot && this.hunterShoot(this.shot.byId, null, { auto: true }));
      },
    }[this.phase];
    if (again) again();
    this.note('Le serveur a redémarré — la partie reprend.', 'info');
    this.broadcast();
  }

  /* ─── Ce que voit chaque joueur ────────────────────────────────────── */

  /**
   * L'état, construit POUR une personne.
   *
   * C'est le cœur du jeu : `role` n'est jamais que le sien, `wolves` n'est
   * rempli que pour un loup, `seen` que pour la voyante, la victime de la
   * nuit n'est visible que des loups et de la sorcière. Un spectateur — un
   * identifiant qui n'est à aucune place — ne reçoit rien de tout ça, et
   * c'est vérifié par le banc d'essai.
   */
  stateFor(playerId) {
    const base = this.baseState();
    const me = this.roleOf(playerId);
    const alive = this.isAlive(playerId);
    const isWolf = me === 'loup';

    const players = this.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      cosmetics: p.cosmetics,
      connected: p.connected,
      alive: this.isAlive(p.id),
      you: p.id === playerId,
      // Les loups se reconnaissent entre eux : c'est la règle, sans ça ils
      // ne pourraient pas se mettre d'accord sans parler.
      wolf: isWolf && this.roleOf(p.id) === 'loup' ? true : undefined,
      // Le rôle d'un mort est public quand l'hôte l'a réglé ainsi.
      role: (!this.isAlive(p.id) && this.revealRoles) || this.phase === 'over'
        ? this.roleOf(p.id) : undefined,
      voted: this.phase === 'vote' ? this.votes.has(p.id) : undefined,
      // Le vote des loups, visible des seuls loups.
      wolfVote: isWolf && this.phase === 'nuit' ? (this.wolfVotes.get(p.id) || null) : undefined,
    }));

    const isSeer = me === 'voyante';
    const isWitch = me === 'sorciere';

    return {
      ...base,
      night: this.night,
      players,
      roles: ROLES,
      deadline: this.deadline,
      serverNow: Date.now(),
      debateMs: this.debateMs,
      revealRoles: this.revealRoles,
      // La composition qu'aura le village avec le nombre actuel de joueurs.
      // Calculée ici et pas dans le navigateur : c'est une règle, et une
      // règle recopiée est une règle qui finira par diverger.
      compo: this.phase === 'lobby' ? preview(this.players.length) : null,
      counts: {
        alive: this.alive.size,
        // Combien de loups restent : le village le sait, c'est ce qui rend
        // le compte à rebours angoissant.
        wolves: this.phase === 'over' ? this.wolves().length : undefined,
      },
      lastNight: this.phase === 'matin' || this.phase === 'debat' || this.phase === 'vote'
        ? this.lastNight : null,
      lastVote: this.phase === 'bucher' ? this.lastVote : null,
      shot: this.shot ? { byId: this.shot.byId, byName: this.nameOf(this.shot.byId), mine: this.shot.byId === playerId } : null,
      you: {
        id: playerId,
        alive,
        role: me,
        roleName: me ? ROLES[me].name : null,
        emoji: me ? ROLES[me].emoji : null,
        blurb: me ? ROLES[me].blurb : null,
        camp: me ? ROLES[me].camp : null,
        voted: this.votes.get(playerId) || null,
        // Ce que la voyante a découvert, depuis le début.
        seen: isSeer ? (this.seerSeen.get(playerId) || []) : [],
        looked: isSeer ? Boolean(this.seerLook) : undefined,
        // La sorcière voit la victime des loups, et l'état de ses potions.
        witch: isWitch ? {
          heal: this.witch.heal,
          kill: this.witch.kill,
          victim: this.phase === 'nuit' && this.victim ? this.victim : null,
          victimName: this.phase === 'nuit' && this.victim ? this.nameOf(this.victim) : null,
          saved: this.witch.saved,
          killed: this.witch.killed,
        } : undefined,
        // Les loups voient qui ils sont en train de désigner.
        wolfTarget: isWolf ? (this.wolfVotes.get(playerId) || null) : undefined,
        victim: isWolf && this.phase === 'nuit' ? this.victim : undefined,
      },
      deadRoles: this.revealRoles || this.phase === 'over' ? this.deadRoles : [],
      log: this.log,
      result: this.result,
      fair: { serverSeedHash: this.serverSeedHash, previous: this.previousSeed },
    };
  }

  broadcast() {
    for (const player of this.players) {
      const state = this.stateFor(player.id);
      for (const socketId of player.sockets) this.io.to(socketId).emit('lg:state', state);
    }
    this.broadcastWatchers('lg:state');
  }

  destroy() {
    clearTimeout(this.timer);
    super.destroy();
  }
}

module.exports = { Loup, ROLES, MIN, MAX, composition, preview, shuffleFrom };
