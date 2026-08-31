'use strict';
/**
 * Sons de synthèse — aucun fichier audio, aucun CDN.
 * Tout est fabriqué à la volée avec l'API Web Audio : le site reste
 * léger et fonctionne même sans réseau une fois chargé.
 */

const SFX = (() => {
  let ctx = null;
  let master = null;
  let enabled = localStorage.getItem('pz-sound') !== 'off';

  function ready() {
    if (!enabled) return null;
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** Une note simple : forme d'onde, fréquence, enveloppe. */
  function tone(freq, { at = 0, dur = 0.12, type = 'sine', gain = 0.2, to = null, sweep = 'exponential' } = {}) {
    const c = ready();
    if (!c) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to && to !== freq) {
      if (sweep === 'linear') osc.frequency.linearRampToValueAtTime(to, t0 + dur);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /** Un bruit court, filtré : sert aux jetons, aux cartes, aux clics. */
  function noise({ at = 0, dur = 0.07, gain = 0.16, freq = 2200, q = 1.2, type = 'bandpass' } = {}) {
    const c = ready();
    if (!c) return;
    const t0 = c.currentTime + at;
    const frames = Math.max(1, Math.floor(c.sampleRate * dur));
    const buffer = c.createBuffer(1, frames, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t0);
  }

  const api = {
    toggle() {
      enabled = !enabled;
      localStorage.setItem('pz-sound', enabled ? 'on' : 'off');
      if (enabled) api.click();
      return enabled;
    },
    get enabled() { return enabled; },

    /* ── Interface ── */
    click() { noise({ dur: 0.035, gain: 0.09, freq: 3200, q: 2 }); },
    pick(step = 0) { tone(420 + step * 40, { dur: 0.07, type: 'triangle', gain: 0.13 }); },

    /* ── La mine ── */
    mine() {
      noise({ dur: 0.05, gain: 0.13, freq: 1400, q: 1 });
      tone(180 + Math.random() * 60, { dur: 0.09, type: 'square', gain: 0.07, to: 90 });
    },
    crit() {
      tone(660, { dur: 0.09, type: 'square', gain: 0.16 });
      tone(990, { at: 0.06, dur: 0.1, type: 'square', gain: 0.15 });
      tone(1320, { at: 0.13, dur: 0.16, type: 'triangle', gain: 0.16 });
    },
    upgrade() {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, { at: i * 0.055, dur: 0.13, type: 'triangle', gain: 0.15 }));
    },

    /* ── Casino ── */
    chip() { noise({ dur: 0.06, gain: 0.14, freq: 2600, q: 3 }); tone(1100, { dur: 0.05, gain: 0.06, type: 'sine' }); },
    card() { noise({ dur: 0.055, gain: 0.11, freq: 1800, q: 0.8, type: 'highpass' }); },
    tick() { noise({ dur: 0.02, gain: 0.07, freq: 4200, q: 6 }); },

    spin() {
      const c = ready();
      if (!c) return;
      for (let i = 0; i < 26; i++) {
        noise({ at: i * 0.09 * (1 + i * 0.03), dur: 0.02, gain: 0.06, freq: 3400, q: 5 });
      }
    },

    win(size = 1) {
      const base = [523, 659, 784, 1046, 1318];
      const n = Math.min(base.length, 2 + Math.round(size * 3));
      base.slice(0, n).forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.22, type: 'triangle', gain: 0.17 }));
    },
    lose() {
      tone(300, { dur: 0.16, type: 'sawtooth', gain: 0.12, to: 180 });
      tone(150, { at: 0.1, dur: 0.22, type: 'sine', gain: 0.1, to: 90 });
    },
    push() { tone(400, { dur: 0.12, type: 'sine', gain: 0.1 }); tone(400, { at: 0.13, dur: 0.12, type: 'sine', gain: 0.09 }); },

    /* ── Caisses ── */
    reelTick() { noise({ dur: 0.016, gain: 0.05, freq: 5200, q: 8 }); },
    reveal(rarity = 'common') {
      const map = {
        common: [392, 494],
        rare: [440, 554, 659],
        epic: [523, 659, 784, 988],
        legendary: [523, 659, 784, 1046, 1318],
        mythic: [659, 784, 988, 1318, 1568, 2093],
        cursed: [880, 830, 1245, 1661, 2093, 2489],
      };
      const notes = map[rarity] || map.common;
      notes.forEach((f, i) => tone(f, { at: i * 0.075, dur: 0.3, type: i > 2 ? 'triangle' : 'sine', gain: 0.16 }));
      if (rarity === 'mythic' || rarity === 'cursed') {
        tone(110, { dur: 0.9, type: 'sawtooth', gain: 0.08, to: 55 });
      }
    },

    /* ── Fanfare ── */
    fanfare() {
      const notes = [
        [523, 0], [659, 0.11], [784, 0.22], [1046, 0.33],
        [988, 0.5], [1046, 0.61], [1318, 0.74],
      ];
      notes.forEach(([f, at]) => {
        tone(f, { at, dur: 0.28, type: 'triangle', gain: 0.17 });
        tone(f / 2, { at, dur: 0.3, type: 'sine', gain: 0.08 });
      });
    },
  };

  return api;
})();

window.SFX = SFX;
