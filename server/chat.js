'use strict';
/**
 * CHAT EN DIRECT.
 *
 * Un seul salon pour tout le site, comme la colonne de droite d'un casino
 * en ligne. L'historique tient en mémoire : au redémarrage du serveur il
 * repart à zéro, et c'est très bien — personne ne relit un chat de la
 * veille, et ça évite de stocker les messages des gens.
 *
 * La modération est volontairement simple mais réelle : une limite de
 * cadence par joueur, un filtre sur les liens, la possibilité de couper la
 * parole à quelqu'un depuis le panel admin, et la suppression d'un message.
 */
const crypto = require('crypto');
const store = require('./store');
const medals = require('./medals');

const HISTORY = 60;          // messages gardés et envoyés aux arrivants
const MAX_LENGTH = 240;
const MIN_GAP_MS = 900;      // délai minimum entre deux messages d'un même joueur
const BURST = 4;             // messages tolérés d'affilée avant d'imposer le délai
const BURST_WINDOW_MS = 12000;
const REPEAT_WINDOW = 3;     // on refuse de répéter son propre message

/** Un lien reste lisible, mais il n'est pas cliquable côté client. */
const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;

class Chat {
  constructor(io) {
    this.io = io;
    this.messages = [];
    this.rate = new Map();  // userId → { last, count, windowStart }
    this.muted = new Map(); // userId → { until, reason }
  }

  /* ─── Modération ─── */

  isMuted(userId, now = Date.now()) {
    const entry = this.muted.get(userId);
    if (!entry) return null;
    if (entry.until <= now) {
      this.muted.delete(userId);
      return null;
    }
    return entry;
  }

  mute(userId, minutes, reason = '') {
    const until = Date.now() + Math.max(1, Number(minutes) || 10) * 60000;
    this.muted.set(userId, { until, reason: String(reason).slice(0, 120) });
    return until;
  }

  unmute(userId) {
    return this.muted.delete(userId);
  }

  /** Retire un message et prévient tout le monde de le faire disparaître. */
  remove(id) {
    const index = this.messages.findIndex((m) => m.id === id);
    if (index < 0) return false;
    this.messages.splice(index, 1);
    this.io.emit('chat:remove', { id });
    return true;
  }

  clear() {
    this.messages = [];
    this.io.emit('chat:history', { messages: [] });
  }

  /* ─── Cadence ─── */

  /**
   * Renvoie null si le joueur peut parler, sinon un message d'explication.
   * On tolère une petite rafale (on écrit souvent trois lignes de suite),
   * puis on impose un délai.
   */
  throttle(userId, now = Date.now()) {
    let entry = this.rate.get(userId);
    if (!entry || now - entry.windowStart > BURST_WINDOW_MS) {
      entry = { last: 0, count: 0, windowStart: now };
      this.rate.set(userId, entry);
    }

    if (entry.count >= BURST && now - entry.last < MIN_GAP_MS) {
      const wait = Math.ceil((MIN_GAP_MS - (now - entry.last)) / 1000) || 1;
      return `Doucement — attends ${wait} seconde${wait > 1 ? 's' : ''}.`;
    }

    entry.last = now;
    entry.count += 1;
    return null;
  }

  /* ─── Envoi ─── */

  say(user, profile, text, { isAdmin = false } = {}) {
    const now = Date.now();

    const muted = this.isMuted(user.id, now);
    if (muted) {
      const left = Math.ceil((muted.until - now) / 60000);
      return {
        ok: false,
        message: `Tu ne peux pas écrire pendant encore ${left} min.${muted.reason ? ` (${muted.reason})` : ''}`,
      };
    }

    let clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return { ok: false, message: 'Message vide.' };
    if (clean.length > MAX_LENGTH) clean = clean.slice(0, MAX_LENGTH);

    // Un message identique au précédent, c'est du spam neuf fois sur dix.
    const recent = this.messages.slice(0, REPEAT_WINDOW).filter((m) => m.userId === user.id);
    if (recent.some((m) => m.text === clean)) {
      return { ok: false, message: 'Tu viens déjà d’écrire ça.' };
    }

    const blocked = this.throttle(user.id, now);
    if (blocked) return { ok: false, message: blocked };

    const level = store.levelFromXp(profile.xp);
    const message = {
      id: crypto.randomBytes(6).toString('hex'),
      userId: user.id,
      name: user.name,
      avatar: user.avatar || null,
      level: level.level,
      title: store.rankTitle(level.level),
      admin: Boolean(isAdmin),
      // Les parures voyagent avec le message : une médaille qu'on est seul à
      // voir ne sert à rien, et le chat est l'endroit le plus regardé du site.
      cosmetics: medals.publicCosmetics(profile),
      // Les liens sont conservés mais neutralisés : le client les affiche
      // en texte, jamais en lien cliquable.
      text: clean.replace(LINK, (m) => m.replace(/\./g, '·')),
      at: now,
    };

    this.messages.unshift(message);
    this.messages.length = Math.min(this.messages.length, HISTORY);
    this.io.emit('chat:message', message);
    return { ok: true, message };
  }

  /** Une ligne du croupier, sans auteur humain : gros gains, annonces. */
  system(text, kind = 'info') {
    const message = {
      id: crypto.randomBytes(6).toString('hex'),
      userId: null,
      name: 'PartyZone',
      avatar: null,
      level: 0,
      title: '',
      system: true,
      kind,
      text: String(text).slice(0, MAX_LENGTH),
      at: Date.now(),
    };
    this.messages.unshift(message);
    this.messages.length = Math.min(this.messages.length, HISTORY);
    this.io.emit('chat:message', message);
    return message;
  }

  history() {
    // Le client affiche du plus ancien au plus récent : on lui rend dans cet ordre.
    return [...this.messages].reverse();
  }
}

module.exports = { Chat, MAX_LENGTH };
