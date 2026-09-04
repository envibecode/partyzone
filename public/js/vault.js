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
 *  2. La collection. On affiche les 518 objets, tout le temps. Ceux qu'on
 *     n'a pas encore sont grisés — on voit donc ce qu'il reste à trouver —
 *     et les noms sont écrits en entier, sur deux lignes si nécessaire.
 *
 *  3. Les cadeaux. Une caisse offerte arrive sous forme de bon : on l'ouvre
 *     quand on veut, avec exactement la même animation.
 */

(() => {
  const { $, $$, fmt, el } = PZ;

  let view = null;
  let filter = 'all';
  let category = 'all';
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
    box.appendChild(stat(`${v.collection.have}/${v.collection.total}`, 'objets trouvés'));

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

    // Deux familles : les caisses générales, qui piochent dans les 518 objets,
    // et les caisses à thème, qui ne tirent que dans une catégorie. Les
    // mélanger dans une seule grille rendrait le choix illisible.
    const general = v.cases.filter((c) => !c.themed);
    const themed = v.cases.filter((c) => c.themed);

    const title = (text, hint) => {
      const node = el('div', 'case-group');
      node.appendChild(el('h3', null, text));
      node.appendChild(el('span', 'fine', hint));
      box.appendChild(node);
    };

    title('Caisses générales', 'Tout le catalogue, toutes catégories confondues.');
    general.forEach((c) => box.appendChild(caseNode(c, v)));

    if (themed.length) {
      title('Caisses à thème', 'Même prix, mais elles ne tirent que dans leur catégorie — le moyen le plus rapide de compléter une ligne.');
      themed.forEach((c) => box.appendChild(caseNode(c, v)));
    }
  }

  function caseNode(c, v) {
    {
      const node = el('div', `case${c.themed ? ' themed' : ''}`);
      node.style.setProperty('--c', c.color);

      const isFree = c.id === v.freeCaseId && (v.freeReady || v.rescueReady);
      if (isFree) node.appendChild(el('span', 'free-badge', v.freeReady ? 'OFFERTE' : 'SECOURS'));

      const top = el('div', 'case-top');
      top.appendChild(el('span', 'case-emoji', c.emoji));
      const names = el('div');
      names.appendChild(el('div', 'case-name', c.name));
      names.appendChild(el('div', 'fine', isFree ? 'Gratuite maintenant' : `${fmt(c.price)} ¤`));
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

      return node;
    }
  }

  /* ─── Les catégories de la collection ─── */

  function renderCats(v) {
    const box = $('#coll-cats');
    box.replaceChildren();

    const all = el('button', `coll-cat${category === 'all' ? ' on' : ''}`);
    all.appendChild(el('span', null, '🌐 Tout'));
    all.appendChild(el('b', null, `${v.collection.have}/${v.collection.total}`));
    all.addEventListener('click', () => { category = 'all'; renderCats(v); renderCollection(v); });
    box.appendChild(all);

    v.collection.byCategory.forEach((c) => {
      const node = el('button', `coll-cat${category === c.id ? ' on' : ''}`);
      node.appendChild(el('span', null, `${c.icon} ${c.name}`));
      node.appendChild(el('b', null, `${c.have}/${c.total}`));
      node.dataset.tip = `${c.name} — ${c.have} trouvé${c.have > 1 ? 's' : ''} sur ${c.total}`;
      node.addEventListener('click', () => { category = c.id; renderCats(v); renderCollection(v); });
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
  const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic', 'cursed'];

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
        gains.appendChild(el('b', null, `${fmt(pull_.dust)} ¤`));
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


  /* ═══════════ L'OUVERTURE MULTIPLE ═══════════ */

  /**
   * Cinq ou dix caisses d'un coup.
   *
   * Les jouer l'une après l'autre prendrait vingt secondes pour cinq, et on
   * finit par cliquer « tout révéler » sans rien regarder. On les fait donc
   * tourner TOUTES EN MÊME TEMPS, sur des lignes empilées, et on les fait
   * s'arrêter les unes après les autres — c'est le suspense d'une seule
   * ouverture, multiplié, au lieu de cinq attentes à la suite.
   */
  function spinMulti(pulls) {
    const wrap = el('div', 'multi-modal');

    const head = el('div', 'reel-head');
    head.appendChild(el('span', 'reel-title', `Ouverture de ${pulls.length} caisses`));
    const skip = el('button', 'link', 'Tout révéler ›');
    head.appendChild(skip);
    wrap.appendChild(head);

    const rows = el('div', 'multi-rows');
    const needle = el('div', 'multi-needle');
    rows.appendChild(needle);

    const lines = pulls.map((pull) => {
      const row = el('div', 'mreel');
      const window_ = el('div', 'reel-window mini');
      const strip = el('div', 'reel-strip');
      pull.reel.strip.forEach((it) => strip.appendChild(itemNode(it, 'reel-item mini')));
      window_.appendChild(strip);
      row.appendChild(window_);
      rows.appendChild(row);
      return { pull, row, window_, strip };
    });

    wrap.appendChild(rows);

    const prize = el('div', 'multi-prize');
    wrap.appendChild(prize);

    PZ.openModal(wrap, { closable: false });

    // Mesure APRÈS ouverture, et via offsetWidth : la fenêtre s'ouvre avec une
    // animation d'échelle, et un rectangle mesuré pendant cette animation
    // renverrait une largeur trop petite — les rouleaux s'arrêteraient tous
    // légèrement à côté de la bonne vignette.
    const first = lines[0] && lines[0].strip.firstElementChild;
    const w = first ? first.offsetWidth : 78;
    const step = w + GAP;

    let landed = 0;
    let stopped = false;

    function land(line, index) {
      if (line.done) return;
      line.done = true;
      const won = line.strip.children[line.pull.reel.winIndex];
      if (won) won.classList.add('won');
      line.row.classList.add('landed');
      line.row.style.setProperty('--rc', line.pull.color);
      SFX.reveal(line.pull.r);

      const tag = el('div', 'mreel-tag');
      tag.style.setProperty('--rc', line.pull.color);
      tag.appendChild(el('b', null, line.pull.name));
      tag.appendChild(el('span', null, line.pull.rarity));
      if (line.pull.isNew) tag.appendChild(el('i', 'new-dot', 'NEW'));
      line.row.appendChild(tag);

      landed++;
      if (landed === lines.length) finish();
      void index;
    }

    function finish() {
      if (stopped) return;
      stopped = true;
      skip.remove();

      const xp = pulls.reduce((sum, x) => sum + x.xp, 0);
      const dust = pulls.reduce((sum, x) => sum + x.dust, 0);
      const best = pulls.reduce((a, b) => (RARITY_ORDER.indexOf(b.r) > RARITY_ORDER.indexOf(a.r) ? b : a));

      const line = el('div', 'g');
      line.appendChild(document.createTextNode('+'));
      line.appendChild(el('b', null, `${fmt(xp)} XP`));
      if (dust) {
        line.appendChild(document.createTextNode(' · doublons revendus +'));
        line.appendChild(el('b', null, `${fmt(dust)} ¤`));
      }
      const news = pulls.filter((x) => x.isNew).length;
      if (news) {
        line.appendChild(document.createTextNode(` · ${news} nouveau${news > 1 ? 'x' : ''}`));
      }
      prize.appendChild(line);
      prize.classList.add('show');

      const close = el('button', 'btn btn-soft modal-close', 'Fermer');
      close.addEventListener('click', () => PZ.closeModal());
      wrap.appendChild(close);

      if (['legendary', 'mythic', 'cursed'].includes(best.r)) {
        PZ.confetti(best.r === 'cursed' ? 200 : 120);
        SFX.fanfare();
      }
    }

    skip.addEventListener('click', () => {
      lines.forEach((line, i) => {
        line.strip.style.transform = `translateX(${-target(line)}px)`;
        land(line, i);
      });
    });

    function target(line) {
      const centre = line.window_.clientWidth / 2 - w / 2;
      if (line.target === undefined) {
        const jitter = (Math.random() - 0.5) * w * 0.5;
        line.target = line.pull.reel.winIndex * step - centre + jitter;
      }
      return line.target;
    }

    const START_X = step * 2;
    const BASE_MS = 3200;
    const GAP_MS = 420; // ce qui décale l'arrêt d'une ligne à la suivante
    const start = performance.now();

    lines.forEach((line) => { line.strip.style.transform = `translateX(${-START_X}px)`; });

    function frame(now) {
      // Une nouvelle ouverture a remplacé celle-ci dans la fenêtre : on
      // s'arrête là. Sans ce garde-fou, l'ancienne animation continuerait à
      // tourner indéfiniment sur des éléments qui ne sont plus dans la page.
      if (!wrap.isConnected) return;

      let running = false;
      lines.forEach((line, i) => {
        if (line.done) return;
        const duration = BASE_MS + i * GAP_MS;
        const t = Math.min(1, (now - start) / duration);
        const e = 1 - Math.pow(1 - t, 4.2);
        const x = START_X + (target(line) - START_X) * e;
        line.strip.style.transform = `translateX(${-x}px)`;

        const tick = Math.floor(x / step);
        if (tick !== line.tick) { line.tick = tick; if (i === 0) SFX.reelTick(); }

        if (t < 1) running = true;
        else land(line, i);
      });
      if (running && !stopped) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /**
   * File d'attente : une caisse seule garde son grand rouleau.
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
      // Une seule caisse : le grand rouleau, plein écran. Plusieurs : elles
      // tournent toutes ensemble, ce qui est à la fois plus rapide et plus
      // spectaculaire que cinq attentes à la suite.
      if (pulls.length > 1) return spinMulti(pulls);
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
    const ORDER = RARITY_ORDER;
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
      g.appendChild(el('b', null, `${fmt(dust)} ¤`));
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

    // On parcourt les 518 objets, pas seulement ceux qu'on possède : c'est
    // toute la carte au trésor, avec les cases encore vides.
    const items = v.items.filter((m) => {
      if (category !== 'all' && m.cat !== category) return false;
      if (filter === 'have') return m.count > 0;
      if (filter === 'miss') return m.count === 0;
      return true;
    });

    if (!items.length) {
      box.appendChild(el('div', 'empty', filter === 'miss' ? 'Rien ne manque ici. Chapeau.' : 'Rien ici pour l’instant.'));
      return;
    }

    // 518 vignettes, c'est beaucoup de nœuds : on les assemble hors de la
    // page et on ne touche au document qu'une seule fois à la fin.
    const frag = document.createDocumentFragment();

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
      frag.appendChild(node);
    });

    box.appendChild(frag);
  }

  /* ═══════════ LES CADEAUX ═══════════ */

  function renderGifts(g) {
    const panel = $('#gifts');
    const list = $('#gift-list');
    list.replaceChildren();

    panel.classList.toggle('hidden', !g.gifts.length);

    g.gifts.forEach((gift) => {
      const node = el('button', `gift${gift.admin ? ' admin' : ''}`);
      node.appendChild(el('span', 'g-emoji', gift.emoji));
      node.appendChild(el('span', 'g-name', `${gift.count} × ${gift.caseName}`));
      node.appendChild(el('span', 'g-from', gift.admin ? `de l’${gift.from}` : `de ${gift.from}`));
      node.addEventListener('click', () => {
        node.disabled = true;
        SFX.chip();
        PZ.socket.emit('gift:claim', { id: gift.id });
      });
      list.appendChild(node);
    });

    $('#gift-note').textContent =
      `Tu paies le prix normal de la caisse. Plafond : ${fmt(g.dailyLimit)} pièces de cadeaux par jour ` +
      `(${fmt(g.left)} restantes aujourd’hui), ${g.maxPerGift} caisses maximum d’un coup. ` +
      `Ces limites existent pour qu’on ne puisse pas vider un compte dans un autre.`;
  }

  /** Le menu déroulant des caisses offrables, rempli depuis l'état du coffre. */
  function fillGiftCases(v) {
    const select = $('#gift-case');
    const keep = select.value;
    select.replaceChildren();
    v.cases.forEach((c) => {
      const opt = el('option', null, `${c.emoji} ${c.name} — ${fmt(c.price)} ¤`);
      opt.value = c.id;
      select.appendChild(opt);
    });
    if (keep) select.value = keep;
  }

  $('#gift-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const to = $('#gift-to').value.trim();
    if (!to) return PZ.toast('À qui veux-tu l’offrir ?', 'error');
    PZ.socket.emit('gift:send', {
      to,
      caseId: $('#gift-case').value,
      count: Math.max(1, Math.min(10, Number($('#gift-count').value) || 1)),
    });
    $('#gift-to').value = '';
  });

  /* ═══════════ LES PALIERS DÉCROCHÉS ═══════════ */

  /**
   * Une médaille tombe pendant une ouverture : on l'annonce ici, sur place,
   * plutôt que d'attendre que le joueur pense à aller voir la page des
   * médailles.
   */
  function celebrate(tiers) {
    tiers.forEach((tier, i) => {
      setTimeout(() => {
        PZ.toast(`${tier.icon} ${tier.name} débloqué : ${tier.need} objets trouvés.`, 'success');
        SFX.fanfare();
        PZ.confetti(110);
      }, 600 + i * 1400);
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

    socket.on('vault:state', ({ vault, result, medals }) => {
      view = vault;
      renderBar(vault);
      renderCases(vault);
      renderCats(vault);
      renderCollection(vault);
      startFreeTimer(vault);
      fillGiftCases(vault);

      if (result && !result.ok) {
        PZ.toast(result.message, 'error');
        return;
      }
      if (result && result.pulls) queue.start(result.pulls);
      else if (result && result.coins) PZ.toast(`Doublons revendus : +${fmt(result.coins)} ¤`, 'success');

      if (medals && medals.length) celebrate(medals);
    });

    socket.on('gift:list', renderGifts);

    // L'annonce du cadeau est faite ailleurs (app.js, elle doit passer même
    // hors de cette page) ; ici on se contente de rafraîchir la liste pour
    // qu'il devienne ouvrable sans recharger.
    socket.on('gift:received', () => PZ.socket.emit('gift:list'));
  }

  PZ.views.vault = {
    enter() {
      bind();
      PZ.socket.emit('vault:open');
      PZ.socket.emit('gift:list');
    },
    leave() {
      if (freeTimer) clearInterval(freeTimer);
      freeTimer = null;

      // On quitte la page pendant qu'un rouleau tourne : la fenêtre suivrait
      // le joueur jusque sur la roulette. On coupe la file et on ferme.
      if (queue.running || queue.pulls.length) {
        clearTimeout(queue.autoTimer);
        queue.pulls = [];
        queue.running = false;
        PZ.closeModal();
      }
    },
  };
})();
