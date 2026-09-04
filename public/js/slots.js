'use strict';
/**
 * LA MACHINE À SOUS — « HORSE HOUSE ».
 *
 * Le serveur renvoie la grille complète, les lignes gagnantes, et le bonus
 * entier — tour par tour, portes collantes comprises. Le navigateur ne
 * décide de rien : il met en scène un résultat déjà écrit. C'est ce qui
 * permet de couper l'animation, de recharger la page, ou d'avoir un
 * navigateur bricolé, sans que ça change un seul gain.
 *
 * DEUX CHOSES À MONTRER, ET IL FAUT LES MONTRER BIEN
 * ──────────────────────────────────────────────────
 *  · LE MULTIPLICATEUR. Une porte d'écurie porte un ×2 ou un ×3 en badge.
 *    Quand une ligne gagne avec plusieurs portes, on annonce le total —
 *    « ×5 » — parce que c'est le chiffre que le joueur doit retrouver, et
 *    que l'addition des multiplicateurs est la règle la moins intuitive du
 *    jeu.
 *
 *  · LES PORTES COLLANTES. Pendant les tours offerts, une porte posée ne
 *    doit visiblement PAS retourner : elle reste, elle pulse doucement, et
 *    le rouleau tourne autour d'elle. Si l'animation la faisait tourner
 *    comme les autres, on perdrait exactement ce qui rend le bonus tendu.
 */

(() => {
  const { $, fmt, el } = PZ;

  let config = null;
  let spinning = false;
  let auto = false;
  let autoTimer = null;

  const board = $('#slots');
  const banner = $('#sl-banner');
  const history = $('#sl-history');

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ─── Les symboles ─── */

  /** Les cartes partagent la même planche de bois ; la lettre est écrite dessus. */
  const CARDS = new Set(['A', 'K', 'Q', 'J', '10']);

  const SYMBOL = {};
  function indexSymbols() {
    config.symbols.forEach((s) => { SYMBOL[s.id] = s; });
    SYMBOL[config.wild.id] = { ...config.wild, wild: true };
    SYMBOL[config.scatter.id] = { ...config.scatter, scatter: true };
  }

  function nameOf(id) {
    return (SYMBOL[id] && SYMBOL[id].name) || id;
  }

  /**
   * Peint une case. On remplace le contenu au lieu de recréer le nœud : les
   * rouleaux tournent à dix-huit images par seconde, et recréer trois cents
   * éléments SVG par seconde ferait ramer les téléphones.
   */
  function paint(cell, id, mult = 0, sticky = false) {
    cell.dataset.id = id;
    cell.classList.toggle('is-wild', id === 'wild');
    cell.classList.toggle('is-scatter', id === 'scatter');
    cell.classList.toggle('is-sticky', Boolean(sticky));

    const use = cell.querySelector('use');
    use.setAttribute('href', `#hs-${CARDS.has(id) ? 'card' : id}`);

    const letter = cell.querySelector('.sl-letter');
    letter.textContent = CARDS.has(id) ? id : '';

    const badge = cell.querySelector('.sl-mult');
    badge.textContent = mult ? `×${mult}` : '';
    badge.hidden = !mult;
  }

  /* ─── Construction du plateau ─── */

  function build() {
    board.replaceChildren();
    for (let r = 0; r < config.reels; r++) {
      const reel = el('div', 'reel');
      reel.dataset.reel = String(r);
      const strip = el('div', 'reel-cells');
      for (let row = 0; row < config.rows; row++) {
        const cell = el('div', 'cell');
        cell.innerHTML = '<svg class="sl-sym" viewBox="0 0 64 64" aria-hidden="true"><use href="#hs-oats"/></svg>'
          + '<b class="sl-letter"></b><i class="sl-mult" hidden></i>';
        strip.appendChild(cell);
      }
      reel.appendChild(strip);
      board.appendChild(reel);
    }

    $('#sl-rtp').textContent = `${String(config.rtp).replace('.', ',')} %`;
    // « 1,08 % » se lit mal en fréquence : on l'annonce en clair.
    $('#sl-bonus').textContent = `≈ 1 tour sur ${Math.round(100 / config.bonusRate)}`;
    $('#sl-lines-label').textContent = `${config.lines} lignes fixes · total misé`;
    $('#sl-bet').min = config.minBet;
    $('#sl-bet').max = config.maxBet;
    buildLines();
    updateTotal();
  }

  /**
   * Les vingt lignes, dessinées en petit sous les rouleaux : on voit d'un
   * coup d'œil où il faut que ça s'aligne, plutôt que de le deviner quand
   * une ligne gagne.
   */
  function buildLines() {
    const box = $('#sl-lines');
    box.replaceChildren();
    config.paylines.forEach((line, i) => {
      const node = el('div', 'sl-line');
      node.dataset.tip = `Ligne ${i + 1}`;
      const grid = el('div', 'sl-line-grid');
      for (let row = 0; row < config.rows; row++) {
        for (let reel = 0; reel < config.reels; reel++) {
          grid.appendChild(el('span', line[reel] === row ? 'on' : ''));
        }
      }
      node.appendChild(grid);
      node.appendChild(el('span', 'sl-line-n', String(i + 1)));
      box.appendChild(node);
    });
  }

  function markLines(wins) {
    const nodes = [...$('#sl-lines').children];
    nodes.forEach((n) => n.classList.remove('hit'));
    wins.forEach((w) => { if (nodes[w.line]) nodes[w.line].classList.add('hit'); });
  }

  /* ─── L'animation ─── */

  /** Les symboles qui défilent pendant qu'un rouleau tourne. */
  function poolFor(reel) {
    const ids = config.symbols.map((s) => s.id);
    if (config.wildReels.includes(reel)) ids.push('wild');
    if (config.scatterReels.includes(reel)) ids.push('scatter');
    return ids;
  }

  /**
   * Fait défiler un rouleau puis le pose sur ses trois symboles.
   *
   * `keep` liste les rangées qui ne doivent PAS tourner : ce sont les
   * portes collantes du bonus. C'est tout l'enjeu visuel de la
   * fonctionnalité — une porte qui reste immobile pendant que le reste du
   * rouleau défile derrière elle.
   */
  function spinReel(reelIndex, column, delay, keep = new Set()) {
    return new Promise((resolve) => {
      const reel = board.children[reelIndex];
      const cells = [...reel.querySelectorAll('.cell')];
      const moving = cells.filter((_, i) => !keep.has(i));
      if (moving.length) reel.classList.add('spinning');

      const pool = poolFor(reelIndex);
      let ticks = 0;
      const roll = setInterval(() => {
        moving.forEach((c) => {
          const id = pool[(Math.random() * pool.length) | 0];
          paint(c, id, id === 'wild' ? (Math.random() < 0.34 ? 3 : 2) : 0);
        });
        if (++ticks % 3 === 0) SFX.tick();
      }, 55);

      setTimeout(() => {
        clearInterval(roll);
        reel.classList.remove('spinning');
        reel.classList.add('landed');
        cells.forEach((c, i) => paint(c, column[i].id, column[i].mult || 0, column[i].sticky));
        setTimeout(() => reel.classList.remove('landed'), 260);
        if (moving.length) {
          SFX.hoof();
          // Une porte qui vient de tomber claque. Une porte déjà collée
          // n'est pas tombée : elle ne claque pas une deuxième fois.
          if (column.some((c, i) => c.id === 'wild' && !c.sticky && !keep.has(i))) SFX.door();
        }
        resolve();
      }, delay);
    });
  }

  /** Affiche une grille complète, rouleau après rouleau. */
  async function showGrid(grid, { fast = false, sticky = null } = {}) {
    board.querySelectorAll('.cell').forEach((c) => c.classList.remove('win', 'dim'));
    const jobs = grid.map((column, i) => {
      const keep = new Set();
      if (sticky) {
        column.forEach((cell, row) => { if (cell.sticky) keep.add(row); });
      }
      return spinReel(i, column, (fast ? 200 : 470) + i * (fast ? 90 : 200), keep);
    });
    await Promise.all(jobs);
  }

  /** Met en avant les cases gagnantes. */
  function highlight(wins) {
    if (!wins.length) return;
    board.querySelectorAll('.cell').forEach((c) => c.classList.add('dim'));
    wins.forEach((w) => {
      w.rows.forEach((row, reel) => {
        const cell = board.children[reel].querySelectorAll('.cell')[row];
        if (cell) { cell.classList.remove('dim'); cell.classList.add('win'); }
      });
    });
  }

  function showScatters(scatters) {
    scatters.forEach(({ reel, row }) => {
      const cell = board.children[reel].querySelectorAll('.cell')[row];
      if (cell) { cell.classList.remove('dim'); cell.classList.add('win'); }
    });
  }

  /* ─── Le bandeau du haut ─── */

  function say(text, kind = '') {
    banner.className = `sl-banner on ${kind}`;
    banner.textContent = text;
  }
  function clearBanner() {
    banner.className = 'sl-banner';
    banner.textContent = '';
  }

  /** La phrase d'une ligne gagnante, multiplicateur compris. */
  function winLabel(win, total) {
    const mult = win.mult > 1 ? ` ×${win.mult}` : '';
    return `${nameOf(win.symbol)} ×${win.count}${mult} — +${fmt(total)} ¤`;
  }

  /* ─── Historique ─── */

  let round = 0;
  function pushHistory(result) {
    const empty = history.querySelector('.empty');
    if (empty) empty.remove();
    round++;

    const up = result.payout >= result.staked;
    const row = el('div', `pk-hrow ${up ? 'up' : 'down'}`);
    row.appendChild(el('span', 'm', result.free.length ? `#${round} 🐴` : `#${round}`));
    row.appendChild(el('span', 'g', `${up ? '+' : ''}${fmt(result.profit)}`));
    row.appendChild(el('span', 'p', `${fmt(result.payout)} ¤`));
    history.prepend(row);
    while (history.children.length > 40) history.lastElementChild.remove();
  }

  /* ─── Un tour ─── */

  function updateTotal() {
    if (!config) return;
    const perLine = Math.max(config.minBet, Math.floor(Number($('#sl-bet').value) || 0));
    $('#sl-total').textContent = fmt(perLine * config.lines);
  }
  $('#sl-bet').addEventListener('input', updateTotal);
  $('#sl-bet').addEventListener('change', updateTotal);

  async function play(result) {
    spinning = true;
    $('#sl-spin').disabled = true;
    board.classList.remove('free');
    clearBanner();

    await showGrid(result.spin.grid);

    markLines(result.spin.wins);
    if (result.spin.wins.length) {
      highlight(result.spin.wins);
      const best = result.spin.wins.reduce((a, b) => (b.gain > a.gain ? b : a));
      say(winLabel(best, result.spin.total), 'win');
      SFX.win(Math.min(1, result.spin.total / Math.max(1, result.staked * 3)));
    }

    /*
     * LE BONUS, REJOUÉ À L'ÉCRAN.
     *
     * On le rejoue plus vite que le jeu de base, mais on ne le résume pas :
     * l'intérêt du bonus, c'est de voir la grille se remplir de portes tour
     * après tour. Sauter directement au total le viderait de sa substance.
     */
    if (result.free.length) {
      showScatters(result.spin.scatters);
      say(`🐴 ${config.freeSpins} TOURS OFFERTS — les portes restent en place`, 'bonus');
      SFX.neigh();
      SFX.fanfare();
      PZ.confetti(90);
      await wait(1500);

      board.classList.add('free');
      let running = 0;

      for (let i = 0; i < result.free.length; i++) {
        const b = result.free[i];
        running += b.total;
        const doors = b.grid.reduce((n, col) => n + col.filter((c) => c.id === 'wild').length, 0);
        say(`Tour ${b.index} · ${b.left} restant${b.left > 1 ? 's' : ''}`
          + (doors ? ` · ${doors} porte${doors > 1 ? 's' : ''}` : '')
          + (running ? ` · +${fmt(running)} ¤` : ''), 'bonus');

        await showGrid(b.grid, { fast: true, sticky: true });
        if (b.wins.length) {
          highlight(b.wins);
          SFX.win(0.6);
        }
        if (b.added) {
          showScatters(b.scatters);
          say(`🍀 Trois fers de plus — +${b.added} tours offerts !`, 'bonus');
          SFX.fanfare();
          await wait(1100);
        }
        await wait(520);
      }

      board.classList.remove('free');
      say(`Bonus terminé : +${fmt(result.payout)} ¤`
        + (result.extraSpins ? ` en ${result.free.length} tours` : ''), 'bonus');
      if (result.payout > result.staked * 20) { PZ.confetti(160); SFX.neigh(); }
    } else if (!result.spin.wins.length) {
      say('Rien cette fois.', '');
      SFX.lose();
    }

    // Le plafond ne rogne presque jamais rien — mais quand il le fait, on
    // le dit. Un gain amputé sans explication passerait pour un bug.
    if (result.capped) {
      say(`Plafond atteint : ${fmt(result.payout)} ¤ versés `
        + `(${config.maxWinX}× la mise, sur ${fmt(result.uncapped)} ¤ calculés)`, 'bonus');
    }

    $('#sl-last').textContent = `${result.profit >= 0 ? '+' : ''}${fmt(result.profit)} ¤`;
    $('#sl-last').style.color = result.profit >= 0 ? 'var(--green)' : 'var(--red)';
    pushHistory(result);

    spinning = false;
    $('#sl-spin').disabled = false;

    if (auto) autoTimer = setTimeout(spin, 900);
  }

  function spin() {
    if (spinning || !config) return;
    const perLine = Math.floor(Number($('#sl-bet').value) || 0);
    const total = perLine * config.lines;
    if (!PZ.profile) return;
    if (total > PZ.profile.coins) {
      stopAuto();
      return PZ.toast(`Il te manque ${fmt(total - PZ.profile.coins)} pièces. Va miner.`, 'error');
    }
    SFX.chip();
    PZ.socket.emit('slots:spin', { bet: perLine });
  }

  $('#sl-spin').addEventListener('click', spin);

  function stopAuto() {
    auto = false;
    clearTimeout(autoTimer);
    $('#sl-auto').textContent = 'Auto : off';
    $('#sl-auto').classList.remove('on');
  }

  $('#sl-auto').addEventListener('click', () => {
    auto = !auto;
    $('#sl-auto').textContent = `Auto : ${auto ? 'on' : 'off'}`;
    $('#sl-auto').classList.toggle('on', auto);
    if (auto && !spinning) spin();
  });

  /* ─── La table des gains ─── */

  function symbolNode(id) {
    const wrap = el('span', 'pay-sym');
    wrap.innerHTML = `<svg viewBox="0 0 64 64"><use href="#hs-${CARDS.has(id) ? 'card' : id}"/></svg>`;
    if (CARDS.has(id)) wrap.appendChild(el('b', 'pay-letter', id));
    return wrap;
  }

  $('#sl-table').addEventListener('click', () => {
    if (!config) return;
    const box = el('div', 'sl-paytable');
    box.appendChild(el('h2', null, 'Horse House — la table des gains'));
    box.appendChild(el('p', 'fine',
      'Multiplicateurs de la mise PAR LIGNE, pour 3, 4 et 5 symboles alignés depuis la gauche. '
      + `Redistribution mesurée sur ${config.measuredOn.toLocaleString('fr-FR')} tours simulés : `
      + `${String(config.rtp).replace('.', ',')} %. Plafond de gain : ${config.maxWinX}× la mise totale.`));

    const grid = el('div', 'pay-grid');
    const head = el('div', 'pay-row head');
    ['Symbole', '3', '4', '5'].forEach((h) => head.appendChild(el('span', null, h)));
    grid.appendChild(head);

    // Une seule ligne pour les cinq cartes : elles partagent le barème, et
    // cinq lignes identiques ne disent rien de plus.
    const shown = config.symbols.filter((s) => s.tier !== 'low');
    shown.forEach((s) => {
      const row = el('div', 'pay-row');
      const name = el('span', 'pay-name');
      name.appendChild(symbolNode(s.id));
      name.appendChild(el('span', null, s.name));
      row.appendChild(name);
      s.pay.forEach((v) => row.appendChild(el('span', 'pay-v', `×${String(v).replace('.', ',')}`)));
      grid.appendChild(row);
    });

    const low = config.symbols.find((s) => s.tier === 'low');
    if (low) {
      const row = el('div', 'pay-row');
      const name = el('span', 'pay-name');
      name.appendChild(symbolNode('A'));
      name.appendChild(el('span', null, 'A · K · Q · J · 10'));
      row.appendChild(name);
      low.pay.forEach((v) => row.appendChild(el('span', 'pay-v', `×${String(v).replace('.', ',')}`)));
      grid.appendChild(row);
    }
    box.appendChild(grid);

    const rules = el('div', 'sl-rules');
    const rule = (id, title, text) => {
      const node = el('div', 'sl-rule');
      node.appendChild(symbolNode(id));
      const body = el('div');
      body.appendChild(el('b', null, title));
      body.appendChild(el('span', null, text));
      node.appendChild(body);
      return node;
    };
    rules.appendChild(rule('wild', 'La porte d’écurie',
      `Rouleaux ${config.wildReels.map((r) => r + 1).join(', ')} seulement. Elle remplace tout sauf le fer `
      + `à cheval, et arrive avec un ×${config.multipliers.join(' ou un ×')}. Plusieurs portes sur la même `
      + 'ligne ADDITIONNENT leurs multiplicateurs : ×2 et ×3 font ×5, pas ×6.'));
    rules.appendChild(rule('scatter', 'Le fer à cheval porte-bonheur',
      `Un sur chacun des rouleaux ${config.scatterReels.map((r) => r + 1).join(', ')} ouvre `
      + `${config.freeSpins} tours offerts. Pendant ces tours, chaque porte qui tombe RESTE en place `
      + `jusqu’à la fin, multiplicateur compris. Trois fers de plus rajoutent ${config.retrigger} tours.`));
    box.appendChild(rules);

    const close = el('button', 'btn btn-soft modal-close', 'Fermer');
    close.addEventListener('click', PZ.closeModal);
    box.appendChild(close);
    PZ.openModal(box);
  });

  /* ─── Branchement ─── */

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__slBound) return;
    socket.__slBound = true;

    socket.on('slots:state', (data) => {
      config = data.config;
      indexSymbols();
      build();
    });

    socket.on('slots:result', (result) => {
      if (result.ok) play(result);
      else { spinning = false; $('#sl-spin').disabled = false; }
    });
  }

  PZ.views.slots = {
    enter() {
      bind();
      PZ.socket.emit('slots:open');
    },
    leave() { stopAuto(); board.classList.remove('free'); },
  };
})();
