'use strict';
/**
 * ROULETTE européenne, en tours partagés.
 *
 * Tout le site mise sur la même roue. Le serveur envoie l'état complet à
 * chaque changement ; le client se contente de le dessiner et d'animer la
 * rotation vers le numéro déjà décidé.
 */

(() => {
  const { $, fmt, el } = PZ;

  const canvas = $('#rl-canvas');
  const ctx = canvas.getContext('2d');
  const SIZE = canvas.width;

  let state = null;
  let wheel = [];
  let angle = 0;        // rotation courante, en radians
  let spinFrom = 0;
  let spinTo = 0;
  let spinStart = 0;
  let spinDur = 0;
  let raf = null;
  let timerRaf = null;
  let lastPhase = null;

  const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

  const FILL = { red: '#c0392b', black: '#263a47', green: '#0a8f3c' };

  /* ─── La roue ─── */

  function drawWheel() {
    if (!wheel.length) return;
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const outer = SIZE / 2 - 6;
    const inner = outer * 0.68;
    const slice = (Math.PI * 2) / wheel.length;

    ctx.clearRect(0, 0, SIZE, SIZE);

    // Jante
    ctx.beginPath();
    ctx.arc(cx, cy, outer + 4, 0, Math.PI * 2);
    ctx.fillStyle = '#2f4553';
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    wheel.forEach((n, i) => {
      const a0 = i * slice - Math.PI / 2 - slice / 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, outer, a0, a0 + slice);
      ctx.closePath();
      ctx.fillStyle = FILL[colorOf(n)];
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.10)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.save();
      ctx.rotate(a0 + slice / 2);
      ctx.translate(outer - 16, 0);
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#fff';
      ctx.font = '700 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(n), 0, 0);
      ctx.restore();
    });

    ctx.restore();

    // Moyeu
    ctx.beginPath();
    ctx.arc(cx, cy, inner * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = '#0f212e';
    ctx.fill();
    ctx.strokeStyle = '#2f4553';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Repère du haut
    ctx.beginPath();
    ctx.moveTo(cx - 9, 2);
    ctx.lineTo(cx + 9, 2);
    ctx.lineTo(cx, 24);
    ctx.closePath();
    ctx.fillStyle = '#00e701';
    ctx.fill();
  }

  function spinTo_(index, ms) {
    const slice = (Math.PI * 2) / wheel.length;
    // On veut que la case `index` finisse sous le repère du haut.
    const target = -index * slice;
    const turns = 6;
    spinFrom = angle;
    spinTo = target - turns * Math.PI * 2 + Math.ceil((angle - target) / (Math.PI * 2)) * Math.PI * 2;
    spinStart = performance.now();
    spinDur = ms;
    if (!raf) raf = requestAnimationFrame(animate);
  }

  function animate(now) {
    const t = Math.min(1, (now - spinStart) / spinDur);
    const e = 1 - Math.pow(1 - t, 3.4); // décélération franche
    angle = spinFrom + (spinTo - spinFrom) * e;
    drawWheel();
    if (t < 1) raf = requestAnimationFrame(animate);
    else raf = null;
  }

  /* ─── Le tapis ─── */

  function buildTable() {
    const box = $('#rl-table');
    box.replaceChildren();

    const nums = el('div', 'rl-nums');
    const zero = el('button', 'rl-cell green', '0');
    zero.dataset.type = 'straight';
    zero.dataset.value = '0';
    nums.appendChild(zero);

    // Trois lignes de douze, comme sur un vrai tapis.
    for (let row = 2; row >= 0; row--) {
      for (let col = 0; col < 12; col++) {
        const n = col * 3 + row + 1;
        const cell = el('button', `rl-cell ${colorOf(n)}`, String(n));
        cell.dataset.type = 'straight';
        cell.dataset.value = String(n);
        nums.appendChild(cell);
      }
    }
    box.appendChild(nums);

    const dozens = el('div', 'rl-outs');
    [['1re douzaine', 1], ['2e douzaine', 2], ['3e douzaine', 3]].forEach(([label, v]) => {
      const cell = el('button', 'rl-cell out', label);
      cell.dataset.type = 'dozen';
      cell.dataset.value = String(v);
      dozens.appendChild(cell);
    });
    box.appendChild(dozens);

    const outs = el('div', 'rl-outs six');
    [
      ['1–18', 'low', null], ['Pair', 'even', null], ['Rouge', 'red', null],
      ['Noir', 'black', null], ['Impair', 'odd', null], ['19–36', 'high', null],
    ].forEach(([label, type]) => {
      const cell = el('button', `rl-cell ${type === 'red' ? 'red' : type === 'black' ? 'black' : 'out'}`, label);
      cell.dataset.type = type;
      outs.appendChild(cell);
    });
    box.appendChild(outs);

    const cols = el('div', 'rl-outs');
    [1, 2, 3].forEach((v) => {
      const cell = el('button', 'rl-cell out', `Colonne ${v}`);
      cell.dataset.type = 'column';
      cell.dataset.value = String(v);
      cols.appendChild(cell);
    });
    box.appendChild(cols);
  }

  $('#rl-table').addEventListener('click', (e) => {
    const cell = e.target.closest('.rl-cell');
    if (!cell) return;
    if (!state || state.phase !== 'betting') return PZ.toast('Les mises sont fermées. Attends le tour suivant.', 'warn');

    const amount = Math.floor(Number($('#rl-chip').value) || 0);
    if (amount > (PZ.profile ? PZ.profile.coins : 0)) {
      return PZ.toast('Pas assez de pièces. Va miner.', 'error');
    }
    SFX.chip();
    PZ.socket.emit('roulette:bet', {
      type: cell.dataset.type,
      value: cell.dataset.value != null ? Number(cell.dataset.value) : null,
      amount,
    });
  });

  $('#rl-clear').addEventListener('click', () => PZ.socket.emit('roulette:clear'));
  $('#rl-rebet').addEventListener('click', () => PZ.socket.emit('roulette:rebet'));

  /* ─── Mode auto ─── */
  /* On repose la mise précédente à chaque nouvelle phase de mises. Tout
     passe par les mêmes messages qu'un clic à la main : le serveur ne fait
     aucune confiance particulière au mode auto. */

  let auto = false;
  const autoBtn = $('#rl-auto');
  autoBtn.addEventListener('click', () => {
    auto = !auto;
    autoBtn.textContent = `Auto : ${auto ? 'on' : 'off'}`;
    autoBtn.classList.toggle('on', auto);
    PZ.toast(auto ? 'Mode auto : ta mise sera reposée à chaque tour.' : 'Mode auto coupé.', 'info');
  });

  /* ─── Configurations enregistrées ─── */

  $('#rl-save').addEventListener('click', () => {
    if (!state || !state.you || !state.you.bets.length) {
      return PZ.toast('Pose d’abord des jetons sur le tapis.', 'warn');
    }
    const name = prompt('Nom de la configuration ?', `Setup ${(setups.length + 1)}`);
    if (name === null) return;
    PZ.socket.emit('roulette:setup-save', { name: name.trim() || 'Sans nom' });
  });

  let setups = [];

  function renderSetups() {
    const box = $('#rl-setups');
    box.replaceChildren();
    if (!setups.length) {
      box.appendChild(el('span', 'fine', 'Pose des jetons puis enregistre-les ici.'));
      return;
    }
    setups.forEach((s) => {
      const chip = el('div', 'setup-chip');
      const use = el('button', 'setup-use');
      use.appendChild(el('b', null, s.name));
      use.appendChild(el('span', null, `${fmt(s.total)} ¤ · ${s.bets.length} mise${s.bets.length > 1 ? 's' : ''}`));
      use.addEventListener('click', () => PZ.socket.emit('roulette:setup-apply', { name: s.name }));
      chip.appendChild(use);

      const del = el('button', 'setup-del', '✕');
      del.title = 'Supprimer';
      del.addEventListener('click', () => PZ.socket.emit('roulette:setup-delete', { name: s.name }));
      chip.appendChild(del);

      box.appendChild(chip);
    });
  }

  /* ─── Affichage de l'état ─── */

  const PHASE_TEXT = {
    betting: 'Faites vos jeux',
    spinning: 'Rien ne va plus…',
    result: 'Résultat',
  };

  function render(s) {
    const first = !state;
    state = s;

    if (!wheel.length) {
      wheel = s.wheel;
      drawWheel();
    }

    $('#rl-phase').textContent = `${PHASE_TEXT[s.phase] || '…'} · tour n° ${s.round}`;
    $('#rl-players').textContent = s.players;
    $('#rl-rtp').textContent = `${String(s.rtp).replace('.', ',')} %`;
    $('#rl-hash').textContent = s.serverSeedHash;
    $('#rl-chip').max = s.maxBet;
    $('#rl-chip').min = s.minBet;

    // La roue ne tourne qu'au moment où la phase bascule.
    if (s.phase === 'spinning' && lastPhase !== 'spinning' && s.result) {
      SFX.spin();
      // Le serveur crédite les gains dès qu'il a le numéro, donc avant que
      // la bille s'arrête à l'écran. Si on laissait le solde bouger, on
      // saurait qu'on a gagné avant de voir le résultat : on gèle
      // l'affichage jusqu'à l'annonce.
      PZ.freezeCoins();
      spinTo_(s.result.index, Math.max(1200, s.deadline - s.serverNow));
    }
    if (s.phase === 'betting' && lastPhase && lastPhase !== 'betting') {
      $('#rl-result').replaceChildren();
    }
    if (first && s.result) {
      const slice = (Math.PI * 2) / s.wheel.length;
      angle = -s.result.index * slice;
      drawWheel();
    }

    // Bille sortie
    const res = $('#rl-result');
    if (s.phase !== 'betting' && s.result) {
      if (s.phase === 'result') {
        res.replaceChildren(el('b', s.result.color, String(s.result.number)));
      }
    }

    renderHistory(s.history);
    renderMyBets(s);
    renderTable(s);
    renderTicker(s.lastWinners);
    highlight(s);

    $('#rl-rebet').disabled = !s.canRebet;

    // Mode auto : dès qu'un nouveau tour de mises s'ouvre, on repose.
    if (auto && s.phase === 'betting' && lastPhase && lastPhase !== 'betting') {
      if (s.canRebet) PZ.socket.emit('roulette:rebet');
    }

    if (s.phase === 'result' && lastPhase !== 'result') {
      PZ.unfreezeCoins();
      const you = s.you;
      if (you && you.payout != null) {
        if (you.payout > 0) {
          SFX.win(Math.min(1, you.payout / Math.max(1, you.staked * 6)));
          PZ.toast(`Tu récupères ${fmt(you.payout)} ¤ !`, 'success');
          if (you.payout >= you.staked * 8) PZ.confetti(110);
        } else if (you.staked > 0) {
          SFX.lose();
        }
      }
    }

    lastPhase = s.phase;
    startTimer();
  }

  /**
   * Le bandeau des gagnants du tour précédent.
   *
   * C'est ce qui donne l'impression qu'il y a du monde à la table : on voit
   * défiler les pseudos et ce que chacun a ramassé au dernier tirage.
   */
  function renderTicker(last) {
    const box = $('#rl-ticker');
    if (!last || !last.players.length) {
      box.replaceChildren();
      box.classList.remove('on');
      return;
    }
    box.classList.add('on');

    const build = () => {
      const strip = el('div', 'ticker-strip');
      const head = el('span', 'ticker-head');
      head.appendChild(el('b', `n ${last.color}`, String(last.number)));
      head.appendChild(el('span', null, `tour n° ${last.round}`));
      strip.appendChild(head);

      last.players.forEach((w) => {
        const item = el('span', 'ticker-item');
        const img = new Image(22, 22);
        img.src = PZ.avatarUrl(w);
        img.alt = '';
        item.appendChild(img);
        item.appendChild(el('b', null, w.name));
        item.appendChild(el('span', 'g', `+${fmt(w.payout)} ¤`));
        strip.appendChild(item);
      });
      return strip;
    };

    // Deux copies à la suite : le défilement peut boucler sans à-coup.
    box.replaceChildren(build(), build());
  }

  /** Qui a misé quoi, à côté du tapis. */
  function renderTable(s) {
    const list = $('#rl-players-list');
    list.replaceChildren();
    if (!s.table.length) {
      list.appendChild(el('li', 'empty', 'Personne n’a encore misé.'));
      return;
    }
    s.table.forEach((p) => {
      const li = el('li');
      if (p.you) li.classList.add('you');
      const img = new Image(26, 26);
      img.src = PZ.avatarUrl(p);
      img.alt = '';
      li.appendChild(img);
      const nameNode = el('span', 'n', p.name);
      li.appendChild(nameNode);
      if (PZ.applyCosmetics) PZ.applyCosmetics(li, p.cosmetics, { avatar: img, name: nameNode });
      li.appendChild(el('b', null, `${fmt(p.staked)} ¤`));
      list.appendChild(li);
    });
  }

  function renderHistory(history) {
    const box = $('#rl-history');
    box.replaceChildren();
    history.slice(0, 18).forEach((h) => {
      box.appendChild(el('span', h.color, String(h.number)));
    });
  }

  function renderMyBets(s) {
    const list = $('#rl-bets');
    list.replaceChildren();
    const you = s.you;
    if (!you || !you.bets.length) {
      list.appendChild(el('li', 'empty', 'Clique sur le tapis.'));
      $('#rl-staked').textContent = '0';
      return;
    }
    const detail = you.detail || null;
    you.bets.forEach((b, i) => {
      const li = el('li');
      if (detail && detail[i]) li.classList.add(detail[i].won ? 'won' : 'lost');
      li.appendChild(el('span', null, b.label));
      li.appendChild(el('b', null, `${fmt(b.amount)} ¤`));
      list.appendChild(li);
    });
    $('#rl-staked').textContent = fmt(you.staked);
  }

  /**
   * Les jetons sur le tapis.
   *
   * On montre les siens en chiffres, et les têtes de tous ceux qui ont misé
   * sur la même case — c'est ce qui fait qu'on sent les autres joueurs.
   */
  function highlight(s) {
    const cells = PZ.$$('#rl-table .rl-cell');
    const mine = new Map();
    if (s.you) {
      for (const b of s.you.bets) mine.set(`${b.type}:${b.value}`, b.amount);
    }
    const winners = new Set();
    if (s.phase === 'result' && s.you && s.you.detail) {
      s.you.detail.forEach((d) => { if (d.won) winners.add(`${d.type}:${d.value}`); });
    }

    cells.forEach((cell) => {
      const key = `${cell.dataset.type}:${cell.dataset.value != null ? Number(cell.dataset.value) : null}`;
      cell.querySelectorAll('.chip, .cell-faces').forEach((n) => n.remove());

      const amount = mine.get(key);
      if (amount) cell.appendChild(el('span', 'chip', PZ.fmtShort(amount)));

      const board = s.board && s.board[key];
      if (board) {
        const others = board.players.filter((p) => !p.you);
        if (others.length) {
          const faces = el('span', 'cell-faces');
          others.slice(0, 3).forEach((p) => {
            const img = new Image(18, 18);
            img.src = PZ.avatarUrl(p);
            img.alt = '';
            faces.appendChild(img);
          });
          faces.dataset.tip = `${fmt(board.total)} ¤ misés par ${board.players.map((p) => p.name).join(', ')}`;
          cell.appendChild(faces);
        }
      }

      cell.classList.toggle('won', winners.has(key));
      cell.classList.toggle('busy', Boolean(board));
    });
  }

  /* ─── Chronomètre ─── */

  function startTimer() {
    if (timerRaf) cancelAnimationFrame(timerRaf);
    const s = state;
    if (!s) return;
    const total = { betting: 20000, spinning: 7000, result: 6000 }[s.phase] || 1;
    const offset = Date.now() - s.serverNow;
    const step = () => {
      const left = Math.max(0, s.deadline - (Date.now() - offset));
      $('#rl-bar').style.width = `${(left / total) * 100}%`;
      if (left > 0 && state === s) timerRaf = requestAnimationFrame(step);
    };
    step();
  }

  /* ─── Branchement ─── */

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__rlBound) return;
    socket.__rlBound = true;
    socket.on('roulette:state', render);
    socket.on('roulette:setups', ({ setups: list }) => {
      setups = list || [];
      renderSetups();
    });
  }

  buildTable();

  PZ.chat.mount({
    log: $('#rl-chat-log'),
    form: $('#rl-chat-form'),
    input: $('#rl-chat-input'),
  });

  PZ.views.roulette = {
    enter() {
      bind();
      PZ.socket.emit('roulette:join');
      PZ.socket.emit('roulette:setups');
    },
    leave() {
      if (PZ.socket) PZ.socket.emit('roulette:leave');
      if (timerRaf) cancelAnimationFrame(timerRaf);
      timerRaf = null;
      // On ne laisse jamais le solde gelé en quittant l'écran.
      PZ.unfreezeCoins();
    },
  };
})();
