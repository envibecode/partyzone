'use strict';
/**
 * LA MACHINE À SOUS — « LES COPAINS ».
 *
 * Le serveur renvoie la grille complète, les lignes gagnantes et le détail
 * du tour bonus. Le navigateur ne fait que la mise en scène : les rouleaux
 * s'arrêtent l'un après l'autre sur des symboles déjà décidés.
 */

(() => {
  const { $, $$, fmt, el } = PZ;

  let config = null;
  let spinning = false;
  let auto = false;
  let autoTimer = null;

  const board = $('#slots');
  const banner = $('#sl-banner');
  const history = $('#sl-history');

  /* ─── Construction du plateau ─── */

  function build() {
    board.replaceChildren();
    for (let r = 0; r < config.reels; r++) {
      const reel = el('div', 'reel');
      reel.dataset.reel = String(r);
      const strip = el('div', 'reel-cells');
      for (let row = 0; row < config.rows; row++) {
        const cell = el('div', 'cell');
        cell.appendChild(el('span', 'sym', '🍀'));
        strip.appendChild(cell);
      }
      reel.appendChild(strip);
      board.appendChild(reel);
    }
    $('#sl-rtp').textContent = `${String(config.rtp).replace('.', ',')} %`;
    // « 1,359 % » se lit comme mille trois cent cinquante-neuf pour cent avec
    // la virgule française. On annonce donc la fréquence en clair.
    $('#sl-bonus').textContent = `≈ 1 tour sur ${Math.round(100 / config.bonusRate)}`;
    buildLines();
    updateTotal();
  }

  /**
   * Les dix lignes de paiement, dessinées en petit sous les rouleaux : on
   * voit d'un coup d'œil où il faut que ça s'aligne, plutôt que de le
   * deviner quand une ligne gagne.
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

  /** Fait clignoter la ligne gagnante dans la petite légende. */
  function markLines(wins) {
    const nodes = [...$('#sl-lines').children];
    nodes.forEach((n) => n.classList.remove('hit'));
    wins.forEach((w) => { if (nodes[w.line]) nodes[w.line].classList.add('hit'); });
  }

  const SYMBOL = {};
  function indexSymbols() {
    config.symbols.forEach((s) => { SYMBOL[s.id] = s; });
    SYMBOL[config.scatter.id] = config.scatter;
  }

  function emojiOf(id) {
    return (SYMBOL[id] && SYMBOL[id].emoji) || '❔';
  }

  /* ─── L'animation ─── */

  /** Fait défiler un rouleau puis le pose sur ses trois symboles. */
  function spinReel(reelIndex, ids, delay) {
    return new Promise((resolve) => {
      const reel = board.children[reelIndex];
      const cells = [...reel.querySelectorAll('.cell')];
      reel.classList.add('spinning');

      const pool = Object.keys(SYMBOL);
      let ticks = 0;
      const roll = setInterval(() => {
        cells.forEach((c) => {
          c.querySelector('.sym').textContent = emojiOf(pool[(Math.random() * pool.length) | 0]);
        });
        if (++ticks % 3 === 0) SFX.tick();
      }, 55);

      setTimeout(() => {
        clearInterval(roll);
        reel.classList.remove('spinning');
        reel.classList.add('landed');
        cells.forEach((c, i) => {
          c.querySelector('.sym').textContent = emojiOf(ids[i]);
          c.dataset.id = ids[i];
        });
        setTimeout(() => reel.classList.remove('landed'), 260);
        SFX.chip();
        resolve();
      }, delay);
    });
  }

  /** Affiche une grille complète, rouleau après rouleau. */
  async function showGrid(grid, fast = false) {
    board.querySelectorAll('.cell').forEach((c) => c.classList.remove('win', 'dim'));
    const jobs = grid.map((column, i) =>
      spinReel(i, column, (fast ? 180 : 480) + i * (fast ? 90 : 210))
    );
    await Promise.all(jobs);
  }

  /** Met en avant les cases gagnantes d'une ligne. */
  function highlight(wins) {
    const cells = board.querySelectorAll('.cell');
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

  /* ─── Historique ─── */

  let round = 0;
  function pushHistory(result) {
    const empty = history.querySelector('.empty');
    if (empty) empty.remove();
    round++;

    const up = result.payout >= result.staked;
    const row = el('div', `pk-hrow ${up ? 'up' : 'down'}`);
    row.appendChild(el('span', 'm', result.bonus.length ? `#${round} 📣` : `#${round}`));
    row.appendChild(el('span', 'g', `${up ? '+' : ''}${fmt(result.profit)}`));
    row.appendChild(el('span', 'p', `${fmt(result.payout)} 🪙`));
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
    clearBanner();

    await showGrid(result.spin.grid);

    markLines(result.spin.wins);
    if (result.spin.wins.length) {
      highlight(result.spin.wins);
      const best = result.spin.wins.reduce((a, b) => (b.gain > a.gain ? b : a));
      say(`${best.emoji} ${best.name} ×${best.count} — +${fmt(result.spin.total)} 🪙`, 'win');
      SFX.win(Math.min(1, result.spin.total / Math.max(1, result.staked * 3)));
    }

    // Le tour bonus : on le rejoue à l'écran, plus vite.
    if (result.bonus.length) {
      showScatters(result.spin.scatters);
      say(`📣 ${result.bonus.length} TOURS OFFERTS · tout ×${result.bonusMult}`, 'bonus');
      SFX.fanfare();
      PZ.confetti(90);
      await wait(1400);

      for (let i = 0; i < result.bonus.length; i++) {
        const b = result.bonus[i];
        say(`Tour offert ${i + 1}/${result.bonus.length}${b.gain ? ` — +${fmt(b.gain)} 🪙` : ''}`, 'bonus');
        await showGrid(b.grid, true);
        if (b.wins.length) {
          highlight(b.wins);
          SFX.win(0.6);
        }
        await wait(520);
      }
      say(`Bonus terminé : +${fmt(result.payout)} 🪙 au total`, 'bonus');
    } else if (!result.spin.wins.length) {
      say('Rien cette fois.', '');
      SFX.lose();
    }

    $('#sl-last').textContent = `${result.profit >= 0 ? '+' : ''}${fmt(result.profit)} 🪙`;
    $('#sl-last').style.color = result.profit >= 0 ? 'var(--green)' : 'var(--red)';
    pushHistory(result);

    spinning = false;
    $('#sl-spin').disabled = false;

    if (auto) autoTimer = setTimeout(spin, 900);
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

  $('#sl-table').addEventListener('click', () => {
    if (!config) return;
    const box = el('div', 'sl-paytable');
    box.appendChild(el('h2', null, 'Table des gains'));
    box.appendChild(el('p', 'fine',
      `Multiplicateurs de la mise par ligne, pour 3, 4 et 5 symboles alignés depuis la gauche. ` +
      `Redistribution mesurée sur ${config.measuredOn.toLocaleString('fr-FR')} tours simulés : ` +
      `${String(config.rtp).replace('.', ',')} %.`));

    const grid = el('div', 'pay-grid');
    const head = el('div', 'pay-row head');
    ['Symbole', '3', '4', '5'].forEach((h) => head.appendChild(el('span', null, h)));
    grid.appendChild(head);

    [...config.symbols].reverse().forEach((s) => {
      const row = el('div', 'pay-row');
      const name = el('span', 'pay-name');
      name.appendChild(el('i', null, s.emoji));
      name.appendChild(el('span', null, s.name + (s.wild ? ' (joker)' : '')));
      row.appendChild(name);
      s.pay.forEach((v) => row.appendChild(el('span', 'pay-v', `×${String(v).replace('.', ',')}`)));
      grid.appendChild(row);
    });

    const sc = el('div', 'pay-row scatter');
    const scName = el('span', 'pay-name');
    scName.appendChild(el('i', null, config.scatter.emoji));
    scName.appendChild(el('span', null, `${config.scatter.name} — n’importe où`));
    sc.appendChild(scName);
    [3, 4, 5].forEach((n) => sc.appendChild(el('span', 'pay-v', `×${config.scatter.pay[n]}`)));
    grid.appendChild(sc);

    box.appendChild(grid);
    box.appendChild(el('p', 'fine',
      `Le ping paie sur la mise TOTALE, pas par ligne. Trois d’entre eux ouvrent ` +
      `${config.bonusSpins} tours offerts avec tout multiplié par ${config.bonusMult} — ` +
      `ça arrive dans ${String(config.bonusRate).replace('.', ',')} % des tours.`));

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
    leave() { stopAuto(); },
  };
})();
