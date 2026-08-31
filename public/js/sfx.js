/* ══════════════════════════════════════════════════════════
   Sons et confettis.

   Tous les sons sont synthétisés à la volée avec la Web Audio
   API : aucun fichier à télécharger, aucun CDN, et ça reste
   parfaitement synchrone avec le jeu. Les navigateurs exigent
   un geste de l'utilisateur avant de laisser sortir du son :
   le contexte audio est donc créé au premier clic.
   ══════════════════════════════════════════════════════════ */

window.PZSfx = (() => {
  let ctx = null;
  let master = null;
  let muted = false;

  try {
    muted = localStorage.getItem('pz-muted') === '1';
  } catch {}

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.35;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Le premier geste de l'utilisateur débloque l'audio pour toute la session.
  ['pointerdown', 'keydown'].forEach((ev) =>
    window.addEventListener(ev, () => ensure(), { once: true, passive: true })
  );

  function setMuted(value) {
    muted = Boolean(value);
    try { localStorage.setItem('pz-muted', muted ? '1' : '0'); } catch {}
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.35, ctx.currentTime, 0.02);
    return muted;
  }
  function isMuted() { return muted; }

  /**
   * Une note simple. `type` change le timbre : 'sine' rond et doux,
   * 'square' rétro, 'sawtooth' agressif.
   */
  function tone(freq, { at = 0, dur = 0.14, type = 'sine', gain = 0.5, slideTo = null } = {}) {
    const c = ensure();
    if (!c || muted) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /** Souffle de bruit blanc, pour les « whoosh » d'ouverture. */
  function noise({ at = 0, dur = 0.35, gain = 0.25, from = 1200, to = 180 } = {}) {
    const c = ensure();
    if (!c || muted) return;
    const t0 = c.currentTime + at;
    const frames = Math.floor(c.sampleRate * dur);
    const buffer = c.createBuffer(1, frames, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    filter.Q.value = 1.2;
    const env = c.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(env).connect(master);
    src.start(t0);
  }

  function arpeggio(freqs, { step = 0.09, dur = 0.2, type = 'triangle', gain = 0.45 } = {}) {
    freqs.forEach((f, i) => tone(f, { at: i * step, dur, type, gain }));
  }

  /* ─── La bibliothèque de sons ───────────────────────── */

  const sfx = {
    click() {
      tone(520, { dur: 0.05, type: 'square', gain: 0.18 });
    },

    /** Bonne réponse : deux notes qui montent, franches. */
    correct() {
      tone(660, { dur: 0.1, type: 'triangle', gain: 0.5 });
      tone(990, { at: 0.09, dur: 0.18, type: 'triangle', gain: 0.45 });
    },

    /** Mauvaise réponse : un buzz qui descend, court, sans être punitif. */
    wrong() {
      tone(210, { dur: 0.22, type: 'sawtooth', gain: 0.3, slideTo: 90 });
      tone(150, { at: 0.04, dur: 0.2, type: 'square', gain: 0.16 });
    },

    /** Décompte avant une manche. */
    tick(last = false) {
      tone(last ? 880 : 440, { dur: last ? 0.2 : 0.07, type: 'square', gain: last ? 0.4 : 0.2 });
    },

    /** Quelqu'un a trouvé avant toi. */
    ping() {
      tone(1180, { dur: 0.08, type: 'sine', gain: 0.22 });
    },

    levelUp() {
      arpeggio([523, 659, 784, 1047], { step: 0.08, dur: 0.26, type: 'triangle', gain: 0.4 });
    },

    /** Fanfare de fin de partie. */
    victory() {
      arpeggio([523, 659, 784], { step: 0.11, dur: 0.22, type: 'triangle', gain: 0.42 });
      arpeggio([1047, 1047], { step: 0.14, dur: 0.5, type: 'triangle', gain: 0.4 });
      tone(392, { at: 0.33, dur: 0.6, type: 'sine', gain: 0.3 });
      tone(523, { at: 0.33, dur: 0.6, type: 'sine', gain: 0.24 });
    },

    /** Le souffle pendant que la caisse s'ouvre. */
    caseOpen() {
      noise({ dur: 0.5, gain: 0.22, from: 300, to: 2400 });
      tone(180, { dur: 0.45, type: 'sawtooth', gain: 0.14, slideTo: 520 });
    },

    /** Le son du butin, d'autant plus grandiose que l'item est rare. */
    reveal(rarity) {
      switch (rarity) {
        case 'cursed':
          noise({ dur: 0.9, gain: 0.3, from: 90, to: 3000 });
          arpeggio([523, 784, 1047, 1568, 2093], { step: 0.1, dur: 0.5, type: 'sine', gain: 0.42 });
          tone(65, { at: 0.1, dur: 1.2, type: 'sawtooth', gain: 0.2 });
          break;
        case 'mythic':
          arpeggio([659, 988, 1319, 1976], { step: 0.09, dur: 0.4, type: 'triangle', gain: 0.42 });
          noise({ dur: 0.5, gain: 0.18, from: 400, to: 2600 });
          break;
        case 'legendary':
          arpeggio([523, 784, 1047], { step: 0.09, dur: 0.34, type: 'triangle', gain: 0.4 });
          break;
        case 'epic':
          arpeggio([440, 660], { step: 0.08, dur: 0.26, type: 'triangle', gain: 0.35 });
          break;
        case 'rare':
          tone(587, { dur: 0.18, type: 'triangle', gain: 0.32 });
          break;
        default:
          tone(330, { dur: 0.11, type: 'sine', gain: 0.22 });
      }
    },

    coins() {
      arpeggio([1046, 1318, 1568], { step: 0.05, dur: 0.12, type: 'square', gain: 0.2 });
    },

    setMuted,
    isMuted,
    unlock: ensure,
  };

  return sfx;
})();

/* ══════════════════════════════════════════════════════════
   Confettis — un petit système de particules sur canvas.
   Pas de bibliothèque : une centaine de rectangles qui
   tombent, tournent et disparaissent.
   ══════════════════════════════════════════════════════════ */

window.PZConfetti = (() => {
  const COLORS = ['#ff4d6d', '#ffb020', '#25f4c8', '#4da3ff', '#b56cff', '#ffffff'];
  let canvas = null;
  let ctx = null;
  let particles = [];
  let raf = null;

  function mount() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'confetti-layer';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Lance une salve. `origin` est en fractions de l'écran (0..1).
   */
  function fire({ count = 130, origin = { x: 0.5, y: 0.35 }, spread = 1, power = 1 } = {}) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    mount();
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = 0; i < count; i++) {
      const angle = (Math.random() - 0.5) * Math.PI * 1.1 * spread - Math.PI / 2;
      const speed = (5 + Math.random() * 9) * power;
      particles.push({
        x: origin.x * w,
        y: origin.y * h,
        vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 2,
        vy: Math.sin(angle) * speed,
        w: 5 + Math.random() * 7,
        h: 8 + Math.random() * 8,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 1,
        decay: 0.006 + Math.random() * 0.008,
      });
    }
    if (particles.length > 900) particles = particles.slice(-900);
    if (!raf) loop();
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      p.vy += 0.28; // gravité
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= p.decay;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    if (!particles.length) {
      cancelAnimationFrame(raf);
      raf = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  /** Pluie de confettis prolongée, pour un podium. */
  function celebrate() {
    fire({ count: 120, origin: { x: 0.5, y: 0.4 } });
    setTimeout(() => fire({ count: 70, origin: { x: 0.2, y: 0.5 }, power: 0.9 }), 260);
    setTimeout(() => fire({ count: 70, origin: { x: 0.8, y: 0.5 }, power: 0.9 }), 480);
    setTimeout(() => fire({ count: 90, origin: { x: 0.5, y: 0.3 } }), 900);
  }

  return { fire, celebrate };
})();
