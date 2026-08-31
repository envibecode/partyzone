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
    highlight(s);

    if (s.phase === 'result' && lastPhase !== 'result') {
      const you = s.you;
      if (you && you.payout != null) {
        if (you.payout > 0) {
          SFX.win(Math.min(1, you.payout / Math.max(1, you.staked * 6)));
          PZ.toast(`Tu récupères ${fmt(you.payout)} 🪙 !`, 'success');
          if (you.payout >= you.staked * 8) PZ.confetti(110);
        } else if (you.staked > 0) {
          SFX.lose();
        }
      }
    }

    lastPhase = s.phase;
    startTimer();
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
      li.appendChild(el('b', null, `${fmt(b.amount)} 🪙`));
      list.appendChild(li);
    });
    $('#rl-staked').textContent = fmt(you.staked);
  }

  /** Jetons posés sur le tapis + surlignage des cases gagnantes. */
  function highlight(s) {
    const cells = PZ.$$('#rl-table .rl-cell');
    const byKey = new Map();
    if (s.you) {
      for (const b of s.you.bets) byKey.set(`${b.type}:${b.value}`, b.amount);
    }
    const winners = new Set();
    if (s.phase === 'result' && s.you && s.you.detail) {
      s.you.detail.forEach((d) => { if (d.won) winners.add(`${d.type}:${d.value}`); });
    }

    cells.forEach((cell) => {
      const key = `${cell.dataset.type}:${cell.dataset.value != null ? Number(cell.dataset.value) : null}`;
      const old = cell.querySelector('.chip');
      if (old) old.remove();
      const amount = byKey.get(key);
      if (amount) cell.appendChild(el('span', 'chip', fmt(amount)));
      cell.classList.toggle('won', winners.has(key));
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
  }

  buildTable();

  PZ.views.roulette = {
    enter() {
      bind();
      PZ.socket.emit('roulette:join');
    },
    leave() {
      if (PZ.socket) PZ.socket.emit('roulette:leave');
      if (timerRaf) cancelAnimationFrame(timerRaf);
      timerRaf = null;
    },
  };
})();
