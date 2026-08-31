/* ══════════════════════════════════════════════════════════
   PIXEL FARM — rendu client.

   Le serveur possède la vérité (pièces, pousse, eau) ; ici on
   se contente d'afficher et d'animer entre deux réponses. Les
   barres de progression avancent toutes seules grâce au champ
   `readyAt` envoyé par le serveur, donc pas besoin de spammer
   le réseau pour voir les plantes grandir.
   ══════════════════════════════════════════════════════════ */
window.PZFarm = (() => {
  let state = null;
  let socket = null;
  let selectedSeed = 'wheat';
  let raf = null;
  let log = [];
  let onProfile = () => {};

  const $ = (sel, root = document) => root.querySelector(sel);

  function init(sock, opts = {}) {
    socket = sock;
    onProfile = opts.onProfile || (() => {});

    socket.on('farm:state', (payload) => {
      state = payload.farm;
      if (payload.me) onProfile(payload.me);

      if (payload.offline && payload.offline.harvested) {
        pushLog(
          `🏚️ La grange a récolté ${payload.offline.harvested} parcelle(s) pendant ton absence : +${payload.offline.coins} pièces, +${payload.offline.xp} XP`,
          true
        );
      }
      if (payload.result && payload.result.message) {
        pushLog(payload.result.message, payload.result.ok);
      }
      render();
    });
  }

  function open() {
    if (!socket) return;
    socket.emit('farm:open');
    if (!state) renderLoading();
  }

  function close() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  function act(action, payload = {}) {
    socket.emit('farm:action', { action, payload });
  }

  function pushLog(message, ok) {
    log.unshift({ message, ok });
    log = log.slice(0, 4);
  }

  /* ─── Rendu ─────────────────────────────────────────── */

  function renderLoading() {
    $('#farm-root').innerHTML = '<div class="stage"><p class="c-dim">CHARGEMENT DE LA FERME…</p></div>';
  }

  function esc(str) {
    return window.PZ.util.esc(str);
  }

  function fmtDuration(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm' + String(s % 60).padStart(2, '0');
    return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
  }

  function render() {
    if (!state) return renderLoading();
    const root = $('#farm-root');
    const seed = state.seeds.find((s) => s.id === selectedSeed) || state.seeds[0];
    const readyCount = state.plots.filter((p) => p.seed && p.progress >= 1).length;
    const freeCount = state.plots.filter((p) => !p.seed).length;

    root.innerHTML = `
      <div class="farm-head">
        <div class="farm-res">
          <span class="res coins">🪙 <b id="f-coins">${state.coins}</b></span>
          <span class="res water">💧 <b id="f-water">${state.water}</b>/${state.waterMax}</span>
          <span class="res xp">🌱 <b>${state.harvested}</b> RÉCOLTES</span>
        </div>
        <div class="farm-actions">
          <button class="btn btn-green btn-mini" data-act="harvest-all" ${readyCount ? '' : 'disabled'}>
            ⛏ RÉCOLTER (${readyCount})
          </button>
          <button class="btn btn-ghost btn-mini" data-act="plant-all" ${freeCount && seed && !seed.locked ? '' : 'disabled'}>
            🌱 TOUT PLANTER
          </button>
        </div>
      </div>

      <div class="farm-cols">
        <div>
          <div class="farm-grid" id="farm-grid">
            ${state.plots.map(plotHtml).join('')}
            ${state.nextPlotPrice !== null
              ? `<button class="plot empty" data-act="buy-plot" title="Défricher une parcelle">
                   <span class="plot-icon">➕</span>
                   <span class="plot-label c-yellow">${state.nextPlotPrice} 🪙</span>
                 </button>`
              : ''}
          </div>

          <div class="farm-log" id="farm-log">
            ${log.length
              ? log.map((l) => `<div class="${l.ok ? 'ok' : 'ko'}">${esc(l.message)}</div>`).join('')
              : '<div>Clique sur une parcelle vide pour planter, sur une pousse pour l’arroser, sur une plante mûre pour la récolter.</div>'}
          </div>
        </div>

        <div class="stack">
          <div class="frame">
            <div class="frame-title">GRAINES</div>
            <div class="seed-list">
              ${state.seeds.map(seedHtml).join('')}
            </div>
          </div>

          <div class="frame">
            <div class="frame-title">BOUTIQUE</div>
            <div class="shop-list">
              ${state.upgrades.map(shopHtml).join('')}
            </div>
          </div>
        </div>
      </div>`;

    wire();
    animate();
  }

  function plotHtml(plot) {
    if (!plot.seed) {
      return `<button class="plot empty" data-plot="${plot.index}" data-act="plant">
        <span class="plot-icon">🕳</span>
        <span class="plot-label c-dim">PLANTER</span>
      </button>`;
    }
    const ready = plot.progress >= 1;
    return `<button class="plot ${ready ? 'ready' : ''}" data-plot="${plot.index}" data-act="${ready ? 'harvest' : 'water'}" data-ready-at="${plot.readyAt}">
      <span class="plot-icon ${ready ? '' : 'grow'}" style="${ready ? '' : `transform:scale(${(0.45 + plot.progress * 0.55).toFixed(2)})`}">${plot.icon}</span>
      <span class="plot-label ${ready ? 'c-green' : ''}">${ready ? 'RÉCOLTER' : plot.name}</span>
      ${ready ? '' : '<span class="drops">💧</span>'}
      <span class="plot-bar"><i style="width:${Math.round(plot.progress * 100)}%"></i></span>
    </button>`;
  }

  function seedHtml(seed) {
    const on = seed.id === selectedSeed;
    return `<button class="seed ${on ? 'on' : ''}" data-seed="${seed.id}" ${seed.locked ? 'disabled' : ''}>
      <span class="seed-icon">${seed.locked ? '🔒' : seed.icon}</span>
      <span>
        <span class="seed-name">${esc(seed.name)}</span><br>
        <span class="seed-meta">${seed.locked
          ? `débloqué au niveau ${seed.level}`
          : `${fmtDuration(seed.growMs)} → ${seed.yield.coins} 🪙 · ${seed.yield.xp} XP`}</span>
      </span>
      <span class="seed-cost">${seed.locked ? 'LVL ' + seed.level : seed.cost + ' 🪙'}</span>
    </button>`;
  }

  function shopHtml(up) {
    const maxed = up.price === null;
    const afford = !maxed && state.coins >= up.price;
    return `<button class="shop" data-upgrade="${up.id}" ${maxed || !afford ? 'disabled' : ''}>
      <span class="shop-icon">${up.icon}</span>
      <span>
        <span class="shop-name">${esc(up.name)}</span>
        <span class="shop-lvl">LV.${up.level}/${up.max}</span><br>
        <span class="shop-meta">${maxed ? esc(up.effect) : '→ ' + esc(up.next || up.effect)}</span>
      </span>
      <span class="shop-cost">${maxed ? 'MAX' : up.price + ' 🪙'}</span>
    </button>`;
  }

  /* ─── Interactions ──────────────────────────────────── */

  function wire() {
    document.querySelectorAll('#farm-root [data-plot]').forEach((el) => {
      el.addEventListener('click', () => {
        const index = Number(el.dataset.plot);
        const action = el.dataset.act;
        if (action === 'plant') act('plant', { plot: index, seed: selectedSeed });
        else if (action === 'water') {
          el.classList.remove('watered');
          void el.offsetWidth;
          el.classList.add('watered');
          act('water', { plot: index });
        } else act('harvest', { plot: index });
      });
    });

    document.querySelectorAll('#farm-root [data-act="harvest-all"], #farm-root [data-act="plant-all"], #farm-root [data-act="buy-plot"]').forEach((el) => {
      el.addEventListener('click', () => act(el.dataset.act, { seed: selectedSeed }));
    });

    document.querySelectorAll('#farm-root [data-seed]').forEach((el) => {
      el.addEventListener('click', () => {
        selectedSeed = el.dataset.seed;
        render();
      });
    });

    document.querySelectorAll('#farm-root [data-upgrade]').forEach((el) => {
      el.addEventListener('click', () => act('upgrade', { id: el.dataset.upgrade }));
    });
  }

  /**
   * Fait avancer les barres et la jauge d'eau entre deux messages du serveur :
   * on connaît `readyAt`, donc l'affichage reste juste sans nouvel aller-retour.
   */
  function animate() {
    if (raf) cancelAnimationFrame(raf);
    const startedAt = Date.now();
    const offset = Date.now() - state.serverNow;

    const step = () => {
      if (!state || !document.getElementById('farm-grid')) return;
      const now = Date.now() - offset;

      state.plots.forEach((plot) => {
        if (!plot.seed) return;
        const el = document.querySelector(`#farm-root [data-plot="${plot.index}"]`);
        if (!el) return;
        const bar = el.querySelector('.plot-bar i');
        const remain = plot.readyAt - now;
        const grown = remain <= 0;
        if (bar) {
          const ratio = grown ? 1 : Math.max(0, Math.min(1, 1 - remain / plot.growMs));
          bar.style.width = Math.round(ratio * 100) + '%';
        }
        if (grown && !el.classList.contains('ready')) {
          el.classList.add('ready');
          el.dataset.act = 'harvest';
          const label = el.querySelector('.plot-label');
          if (label) { label.textContent = 'RÉCOLTER'; label.classList.add('c-green'); }
          const icon = el.querySelector('.plot-icon');
          if (icon) { icon.style.transform = ''; icon.classList.remove('grow'); }
          const btn = document.querySelector('#farm-root [data-act="harvest-all"]');
          if (btn) btn.disabled = false;
        }
      });

      // jauge d'eau : +1 toutes les `waterEveryMs`
      const water = Math.min(state.waterMax, state.water + Math.floor((Date.now() - startedAt) / state.waterEveryMs));
      const wEl = document.getElementById('f-water');
      if (wEl) wEl.textContent = water;

      raf = requestAnimationFrame(step);
    };
    step();
  }

  return { init, open, close, render };
})();
