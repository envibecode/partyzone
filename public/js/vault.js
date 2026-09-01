'use strict';
/**
 * MEMEVAULT — les caisses.
 *
 * Deux choses comptent ici :
 *
 *  1. Le rouleau. Le serveur envoie, avec chaque tirage, une bande de 58
 *     vignettes dont la 50e est l'objet réellement gagné. On fait défiler
 *     la bande jusqu'à ce que cette vignette s'arrête sous l'aiguille.
 *     Ce qui défile autour, c'est vraiment ce qu'on aurait pu avoir : la
 *     bande est tirée dans la même caisse, avec les mêmes probabilités.
 *
 *  2. La collection. On affiche les SOIXANTE memes, tout le temps. Ceux
 *     qu'on n'a pas encore sont grisés — on voit donc ce qu'il reste à
 *     trouver — et les noms sont écrits en entier, sur deux lignes si
 *     nécessaire.
 */

(() => {
  const { $, $$, fmt, el } = PZ;

  let view = null;
  let filter = 'all';
  let freeTimer = null;

  /* ─── Bandeau du haut ─── */

  function renderBar(v) {
    const box = $('#vault-bar');
    box.replaceChildren();

    const stat = (value, label) => {
      const node = el('div', 'vault-stat');
      node.appendChild(el('b', null, value));
      node.appendChild(el('span', null, label));
      return node;
    };

    box.appendChild(stat(fmt(v.coins), 'pièces'));
    box.appendChild(stat(fmt(v.opened), 'caisses ouvertes'));
    box.appendChild(stat(`×${String(v.comboMult).replace('.', ',')}`, `combo ${v.combo}/${v.comboMax}`));
    box.appendChild(stat(`${v.collection.have}/${v.collection.total}`, 'memes trouvés'));

    const timer = el('div', 'vault-stat');
    timer.appendChild(el('b', 'free-timer', '—'));
    timer.firstElementChild.id = 'free-timer';
    timer.firstElementChild.style.fontSize = '14px';
    timer.appendChild(el('span', null, 'caisse gratuite'));
    box.appendChild(timer);

    const action = el('div', 'vault-stat action');
    const sell = el('button', 'btn btn-soft btn-block', v.duplicates ? `Revendre ${v.duplicates} doublon${v.duplicates > 1 ? 's' : ''}` : 'Aucun doublon');
    sell.disabled = !v.duplicates;
    sell.addEventListener('click', () => PZ.socket.emit('vault:sell'));
    action.appendChild(sell);
    box.appendChild(action);
  }

  /* ─── Les caisses ─── */

  function renderCases(v) {
    const box = $('#cases');
    box.replaceChildren();

    v.cases.forEach((c) => {
      const node = el('div', 'case');
      node.style.setProperty('--c', c.color);

      const isFree = c.id === v.freeCaseId && (v.freeReady || v.rescueReady);
      if (isFree) node.appendChild(el('span', 'free-badge', v.freeReady ? 'OFFERTE' : 'SECOURS'));

      const top = el('div', 'case-top');
      top.appendChild(el('span', 'case-emoji', c.emoji));
      const names = el('div');
      names.appendChild(el('div', 'case-name', c.name));
      names.appendChild(el('div', 'fine', isFree ? 'Gratuite maintenant' : `${fmt(c.price)} 🪙`));
      top.appendChild(names);
      node.appendChild(top);

      node.appendChild(el('p', 'case-blurb', c.blurb));

      const odds = el('div', 'case-odds');
      c.odds.forEach((o) => {
        const tag = el('span', null, `${o.name} ${String(o.percent).replace('.', ',')} %`);
        tag.style.color = o.color;
        odds.appendChild(tag);
      });
      node.appendChild(odds);

      const buy = el('div', 'case-buy');
      [1, 5].forEach((n) => {
        const btn = el('button', n === 1 ? 'btn btn-green' : 'btn btn-soft', n === 1 ? 'Ouvrir' : '×5');
        const cost = isFree && n === 1 ? 0 : c.price * (isFree ? n - 1 : n);
        btn.disabled = cost > v.coins;
        btn.addEventListener('click', () => pull(c.id, n));
        buy.appendChild(btn);
      });
      node.appendChild(buy);

      box.appendChild(node);
    });

  }

  /** Compte à rebours de la caisse offerte, affiché dans le bandeau. */
  function startFreeTimer(v) {
    if (freeTimer) clearInterval(freeTimer);
    const slot = $('#free-timer');
    if (!slot) return;
    if (v.freeReady) { slot.textContent = 'Caisse offerte disponible !'; return; }

    const offset = Date.now() - v.serverNow;
    const tick = () => {
      const left = v.freeAt - (Date.now() - offset);
      if (left <= 0) {
        clearInterval(freeTimer);
        freeTimer = null;
        PZ.socket.emit('vault:open');
        return;
      }
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      slot.textContent = `Caisse offerte dans ${m}:${String(s).padStart(2, '0')}`;
    };
    tick();
    freeTimer = setInterval(tick, 1000);
  }

  function pull(caseId, count) {
    SFX.chip();
    PZ.socket.emit('vault:pull', { caseId, count });
  }

  /* ═══════════ LE ROULEAU ═══════════ */

  const ITEM_W = 110;
  const GAP = 8;

  function itemNode(item, cls = 'reel-item') {
    const node = el('div', cls);
    node.style.setProperty('--rc', item.color || '#2f4553');
    node.appendChild(el('span', 'e', item.emoji));
    node.appendChild(el('span', 'n', item.name));
    return node;
  }

  /** Fait tourner la bande jusqu'à l'objet gagné, puis le révèle. */
  function spinReel(pull_, remaining) {
    let aborted = false;
    const wrap = el('div', 'reel-modal');

    const head = el('div', 'reel-head');
    head.appendChild(el('span', 'reel-title', remaining > 0 ? `Ouverture… encore ${remaining} après celle-ci` : 'Ouverture…'));
    // Cinq rouleaux d'affilée, c'est long quand on est pressé.
    const skip = el('button', 'link', remaining > 0 ? 'Tout révéler ›' : 'Révéler ›');
    skip.addEventListener('click', () => { aborted = true; queue.skipAll(pull_); });
    head.appendChild(skip);
    wrap.appendChild(head);

    const window_ = el('div', 'reel-window');
    const strip = el('div', 'reel-strip');
    pull_.reel.strip.forEach((it) => strip.appendChild(itemNode(it)));
    window_.appendChild(strip);
    window_.appendChild(el('div', 'reel-needle'));
    wrap.appendChild(window_);

    const prize = el('div', 'reel-prize');
    wrap.appendChild(prize);

    PZ.openModal(wrap, { closable: false });

    // Largeur réelle des vignettes (elles rétrécissent sur mobile).
    // offsetWidth, et surtout pas getBoundingClientRect : la fenêtre s'ouvre
    // avec une petite animation d'échelle, et le rectangle mesuré pendant
    // cette animation est plus petit que la vraie largeur — le rouleau
    // s'arrêterait alors à côté de la bonne vignette.
    const first = strip.firstElementChild;
    const w = first ? first.offsetWidth : ITEM_W;
    const step = w + GAP;

    const centre = window_.clientWidth / 2 - w / 2;
    // Un décalage aléatoire dans la vignette gagnante, pour que l'aiguille
    // ne tombe pas toujours pile au milieu : ça fait beaucoup plus vivant.
    const jitter = (Math.random() - 0.5) * w * 0.55;
    const target = pull_.reel.winIndex * step - centre + jitter;

    strip.style.transform = `translateX(${-(step * 2)}px)`;

    const DURATION = 4200;
    const startX = step * 2;
    const start = performance.now();
    let lastTick = -1;

    function frame(now) {
      const t = Math.min(1, (now - start) / DURATION);
      // Départ vif, arrivée qui traîne : la courbe qui fait tout le suspense.
      const e = 1 - Math.pow(1 - t, 4.2);
      const x = startX + (target - startX) * e;
      strip.style.transform = `translateX(${-x}px)`;

      const tick = Math.floor(x / step);
      if (tick !== lastTick) { lastTick = tick; SFX.reelTick(); }

      if (aborted) return;
      if (t < 1) requestAnimationFrame(frame);
      else reveal();
    }

    function reveal() {
      if (aborted) return;
      skip.remove();
      // On souligne la vignette qui s'est arrêtée sous l'aiguille.
      const won = strip.children[pull_.reel.winIndex];
      if (won) won.classList.add('won');

      prize.style.setProperty('--rc', pull_.color);
      prize.appendChild(el('div', 'e', pull_.emoji));
      prize.appendChild(el('div', 'n', pull_.name));
      const r = el('div', 'r', pull_.rarity);
      r.style.color = pull_.color;
      prize.appendChild(r);

      const gains = el('div', 'g');
      gains.appendChild(document.createTextNode('+'));
      gains.appendChild(el('b', null, `${fmt(pull_.xp)} XP`));
      if (pull_.dust) {
        gains.appendChild(document.createTextNode(' · doublon revendu +'));
        gains.appendChild(el('b', null, `${fmt(pull_.dust)} 🪙`));
      }
      if (pull_.mult > 1) gains.appendChild(document.createTextNode(` · combo ×${String(pull_.mult).replace('.', ',')}`));
      prize.appendChild(gains);

      if (pull_.isNew) prize.appendChild(el('div', 'new', 'NOUVEAU !'));

      prize.classList.add('show');
      SFX.reveal(pull_.r);
      if (['legendary', 'mythic', 'cursed'].includes(pull_.r)) PZ.confetti(pull_.r === 'cursed' ? 160 : 100);

      const close = el('button', 'btn btn-soft modal-close', remaining > 0 ? 'Suivante →' : 'Fermer');
      close.addEventListener('click', () => { close.disabled = true; next(); });
      wrap.appendChild(close);
      queue.autoTimer = setTimeout(next, remaining > 0 ? 1500 : 4000);
    }

    function next() {
      clearTimeout(queue.autoTimer);
      queue.step();
    }

    requestAnimationFrame(frame);
  }

  /**
   * File d'attente : une caisse ×5 enchaîne cinq rouleaux.
   *
   * Si de nouveaux tirages arrivent pendant qu'un rouleau tourne, on les
   * met à la suite au lieu de repartir de zéro — sinon l'animation en cours
   * se retrouverait à annoncer l'objet d'un autre tirage.
   */
  const queue = {
    pulls: [],
    running: false,
    autoTimer: null,
    start(pulls) {
      this.pulls.push(...pulls);
      if (!this.running) this.step();
    },
    step() {
      clearTimeout(this.autoTimer);
      const next = this.pulls.shift();
      if (!next) {
        this.running = false;
        PZ.closeModal();
        return;
      }
      this.running = true;
      spinReel(next, this.pulls.length);
    },
    /** Abandonne les animations et affiche d'un coup tout ce qui reste. */
    skipAll(current) {
      clearTimeout(this.autoTimer);
      const rest = [current, ...this.pulls].filter(Boolean);
      this.pulls = [];
      this.running = false;
      showRecap(rest);
    },
  };

  /** Récapitulatif : toutes les vignettes obtenues, d'un seul coup d'œil. */
  function showRecap(pulls) {
    const wrap = el('div', 'reel-modal');
    wrap.appendChild(el('div', 'reel-title', `${pulls.length} objet${pulls.length > 1 ? 's' : ''} obtenu${pulls.length > 1 ? 's' : ''}`));

    const grid = el('div', 'reel-multi');
    let best = 'common';
    const ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic', 'cursed'];
    pulls.forEach((x) => {
      const node = el('div', 'mi');
      node.style.setProperty('--rc', x.color);
      node.appendChild(el('span', 'e', x.emoji));
      node.appendChild(el('span', 'n', x.name));
      if (x.isNew) node.appendChild(el('span', 'new-dot', 'NEW'));
      grid.appendChild(node);
      if (ORDER.indexOf(x.r) > ORDER.indexOf(best)) best = x.r;
    });
    wrap.appendChild(grid);

    const xp = pulls.reduce((s, x) => s + x.xp, 0);
    const dust = pulls.reduce((s, x) => s + x.dust, 0);
    const line = el('div', 'reel-prize show');
    const g = el('div', 'g');
    g.appendChild(document.createTextNode('+'));
    g.appendChild(el('b', null, `${fmt(xp)} XP`));
    if (dust) {
      g.appendChild(document.createTextNode(' · doublons revendus +'));
      g.appendChild(el('b', null, `${fmt(dust)} 🪙`));
    }
    line.appendChild(g);
    wrap.appendChild(line);

    const close = el('button', 'btn btn-soft modal-close', 'Fermer');
    close.addEventListener('click', () => PZ.closeModal());
    wrap.appendChild(close);

    PZ.openModal(wrap, { closable: true });
    SFX.reveal(best);
    if (['legendary', 'mythic', 'cursed'].includes(best)) PZ.confetti(110);
  }

  /* ═══════════ LA COLLECTION ═══════════ */

  function renderCollection(v) {
    $('#coll-count').textContent = `${v.collection.have}/${v.collection.total}`;

    const rar = $('#coll-rarities');
    rar.replaceChildren();
    v.collection.byRarity.forEach((r) => {
      const tag = el('span', null, `${r.name} ${r.have}/${r.total}`);
      tag.style.color = r.color;
      tag.style.borderColor = r.have === r.total ? r.color : '';
      rar.appendChild(tag);
    });

    const box = $('#collection');
    box.replaceChildren();

    // On parcourt les 60 memes, pas seulement ceux qu'on possède : c'est
    // toute la carte au trésor, avec les cases encore vides.
    const items = v.items.filter((m) => {
      if (filter === 'have') return m.count > 0;
      if (filter === 'miss') return m.count === 0;
      return true;
    });

    if (!items.length) {
      box.appendChild(el('div', 'empty', filter === 'miss' ? 'Collection complète. Chapeau.' : 'Rien ici pour l’instant.'));
      return;
    }

    items.forEach((m) => {
      const owned = m.count > 0;
      const node = el('div', `coll-item${owned ? '' : ' locked'}`);
      node.style.setProperty('--rc', m.color);
      // L'emoji est toujours celui du meme : verrouillé, il est juste éteint.
      node.appendChild(el('span', 'e', m.emoji));
      node.appendChild(el('span', 'n', m.name));
      node.appendChild(el('span', 'r', m.rarity));
      if (m.count > 1) node.appendChild(el('span', 'c', `×${m.count}`));
      node.dataset.tip = owned
        ? `${m.name} — ${m.rarity} · ${m.count} exemplaire${m.count > 1 ? 's' : ''}`
        : `${m.name} — ${m.rarity} · pas encore trouvé`;
      box.appendChild(node);
    });
  }

  $('#coll-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    $$('#coll-filter .seg').forEach((b) => b.classList.toggle('active', b === btn));
    filter = btn.dataset.r;
    if (view) renderCollection(view);
  });

  /* ─── Branchement ─── */

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__vaultBound) return;
    socket.__vaultBound = true;

    socket.on('vault:state', ({ vault, result }) => {
      view = vault;
      renderBar(vault);
      renderCases(vault);
      renderCollection(vault);
      startFreeTimer(vault);

      if (result && !result.ok) {
        PZ.toast(result.message, 'error');
        return;
      }
      if (result && result.pulls) queue.start(result.pulls);
      else if (result && result.coins) PZ.toast(`Doublons revendus : +${fmt(result.coins)} 🪙`, 'success');
    });
  }

  PZ.views.vault = {
    enter() {
      bind();
      PZ.socket.emit('vault:open');
    },
    leave() {
      if (freeTimer) clearInterval(freeTimer);
      freeTimer = null;
    },
  };
})();
