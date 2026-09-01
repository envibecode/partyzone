'use strict';
/**
 * PLINKO.
 *
 * Le serveur décide du chemin complet de chaque bille AVANT de répondre :
 * une suite de gauches et de droites tirée de la graine. L'animation ne
 * fait que rejouer ce chemin — elle ne décide de rien. C'est pour ça que
 * la bille tombe toujours pile dans la bonne case.
 */

(() => {
  const { $, fmt, el } = PZ;

  const canvas = $('#pk-canvas');
  const ctx = canvas.getContext('2d');
  const bucketBox = $('#pk-buckets');

  const W = canvas.width;
  const H = canvas.height;

  let config = null;
  let rows = 16;
  let risk = 'medium';
  let pegs = [];
  let balls = [];
  let raf = null;

  /* ─── Géométrie ─── */

  const TOP = 40;
  // Les cases du bas sont juste sous la dernière rangée de picots : on garde
  // le strict nécessaire pour la bille qui tombe dedans.
  const BOTTOM = H - 6;

  function layout() {
    pegs = [];
    const rowGap = (BOTTOM - TOP) / rows;
    // On étale la pyramide sur presque toute la largeur : les cases du bas
    // sont alors assez larges pour afficher « 110× » sans le couper.
    const colGap = Math.min(rowGap * 1.4, (W - 50) / (rows + 1));
    for (let r = 0; r < rows; r++) {
      const count = r + 3;
      const y = TOP + r * rowGap;
      for (let c = 0; c < count; c++) {
        pegs.push({ x: W / 2 + (c - (count - 1) / 2) * colGap, y, r: Math.max(2.5, colGap * 0.09) });
      }
    }
    return { rowGap, colGap };
  }

  /** Position horizontale d'une bille après `step` rangées sur son chemin. */
  function xAt(path, step, colGap) {
    let offset = 0;
    for (let i = 0; i < step; i++) offset += path[i] ? 0.5 : -0.5;
    return W / 2 + offset * colGap;
  }

  /* ─── Dessin ─── */

  const RISK_HUE = { low: 150, medium: 40, high: 0 };

  function bucketColor(i) {
    const n = rows + 1;
    const edge = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2); // 0 au centre, 1 aux bords
    const hue = RISK_HUE[risk];
    return `hsl(${hue - edge * 20 + 20 * (1 - edge)}, ${45 + edge * 45}%, ${38 + edge * 20}%)`;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    for (const p of pegs) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = '#b1bad3';
      ctx.fill();
    }

    for (const b of balls) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = '#f5b544';
      ctx.shadowColor = 'rgba(245,181,68,.8)';
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function loop() {
    const { rowGap, colGap } = layoutCache;
    let alive = false;

    for (const b of balls) {
      if (b.done) continue;
      alive = true;
      // Cadence de chute : assez lente pour qu'on suive la bille, assez
      // rapide pour que dix billes ne prennent pas quinze secondes.
      b.t += 0.075;

      const step = Math.min(rows, Math.floor(b.t));
      const frac = Math.min(1, b.t - step);

      if (step > b.lastStep && step <= rows) {
        b.lastStep = step;
        SFX.tick();
      }

      const x0 = xAt(b.path, Math.min(step, rows), colGap);
      const x1 = xAt(b.path, Math.min(step + 1, rows), colGap);
      // Interpolation douce, avec un petit rebond vertical sur chaque picot.
      const e = frac * frac * (3 - 2 * frac);
      b.x = x0 + (x1 - x0) * e;
      b.y = TOP + (step + frac) * rowGap - Math.sin(frac * Math.PI) * rowGap * 0.16;

      // Arrivée en bas : on encaisse et on retire la bille du plateau.
      // Elle n'a plus rien à y faire, et à dix billes le plateau devenait
      // illisible.
      if (b.t >= rows) {
        b.done = true;
        landed(b);
      }
    }

    balls = balls.filter((b) => !b.done);
    draw();

    if (alive || balls.length) raf = requestAnimationFrame(loop);
    else { raf = null; draw(); }
  }

  let layoutCache = { rowGap: 30, colGap: 30 };

  function landed(ball) {
    const node = bucketBox.children[ball.bucket];
    if (node) {
      node.classList.remove('hit');
      void node.offsetWidth;
      node.classList.add('hit');
    }
    pushHistory(ball);
    if (ball.multiplier >= 1) SFX.win(Math.min(1, ball.multiplier / 20));
    else SFX.lose();
  }

  /* ─── L'historique : ce que chaque bille a rapporté ─── */

  const history = $('#pk-history');

  function pushHistory(ball) {
    const empty = history.querySelector('.empty');
    if (empty) empty.remove();

    const row = el('div', `pk-hrow ${ball.win >= ball.stake ? 'up' : 'down'}`);
    row.appendChild(el('span', 'm', `${ball.multiplier}×`));
    row.appendChild(el('span', 'g', `${ball.win >= ball.stake ? '+' : ''}${fmt(ball.win - ball.stake)}`));
    row.appendChild(el('span', 'p', `${fmt(ball.win)} 🪙`));

    history.prepend(row);
    while (history.children.length > 40) history.lastElementChild.remove();
  }

  /* ─── Cases du bas ─── */

  function renderBuckets() {
    const table = config.tables[rows][risk];
    bucketBox.replaceChildren();

    // Les cases doivent tomber pile sous les colonnes de picots : on leur
    // donne exactement la largeur occupée par la pyramide, en pourcentage
    // de la toile (qui se réduit elle-même sur les petits écrans).
    const span = ((rows + 1) * layoutCache.colGap) / W;
    bucketBox.style.width = `${(span * 100).toFixed(2)}%`;

    // Avec seize rangées les cases sont étroites : on rétrécit le texte
    // plutôt que de le laisser se faire couper.
    bucketBox.style.setProperty('--bs', rows >= 16 ? '10px' : rows >= 12 ? '11.5px' : '13px');

    table.multipliers.forEach((m, i) => {
      // À trois chiffres le « × » ne rentre plus : le contexte suffit.
      const node = el('div', 'pk-bucket', m >= 100 ? String(m) : `${m}×`);
      node.style.background = bucketColor(i);
      bucketBox.appendChild(node);
    });
    $('#pk-rtp').textContent = `${String(table.rtp).replace('.', ',')} %`;
  }

  function refresh() {
    rows = Number($('#pk-rows').value) || 16;
    risk = $('#pk-risk').value;
    layoutCache = layout();
    renderBuckets();
    draw();
  }

  $('#pk-rows').addEventListener('change', refresh);
  $('#pk-risk').addEventListener('change', refresh);

  /* ─── Jouer ─── */

  const playBtn = $('#pk-play');

  playBtn.addEventListener('click', () => {
    const bet = Math.floor(Number($('#pk-bet').value) || 0);
    const count = Math.max(1, Math.min(10, Math.floor(Number($('#pk-balls').value) || 1)));
    if (!PZ.profile) return;
    if (bet * count > PZ.profile.coins) {
      return PZ.toast(`Il te manque ${fmt(bet * count - PZ.profile.coins)} pièces. Va miner.`, 'error');
    }
    SFX.chip();
    playBtn.disabled = true;
    PZ.socket.emit('plinko:play', { bet, rows, risk, balls: count });
  });

  function drop(result) {
    result.drops.forEach((d, i) => {
      balls.push({
        path: d.path,
        bucket: d.bucket,
        multiplier: d.multiplier,
        win: d.win,
        stake: result.staked / result.drops.length,
        x: W / 2, y: TOP, r: Math.max(4, layoutCache.colGap * 0.2),
        t: -i * 1.5, lastStep: -1, done: false,
      });
    });
    if (!raf) raf = requestAnimationFrame(loop);

    const profit = result.profit;
    $('#pk-last').textContent = `${profit >= 0 ? '+' : ''}${fmt(profit)} 🪙`;
    $('#pk-last').style.color = profit >= 0 ? 'var(--green)' : 'var(--red)';

    const best = Math.max(...result.drops.map((d) => d.multiplier));
    if (best >= 20) setTimeout(() => PZ.confetti(90), 900);
  }

  /* ─── Branchement ─── */

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__pkBound) return;
    socket.__pkBound = true;

    socket.on('plinko:state', (data) => {
      config = data.config;
      $('#pk-bet').min = config.minBet;
      $('#pk-balls').max = config.maxBalls;
      refresh();
    });

    socket.on('plinko:result', (result) => {
      playBtn.disabled = false;
      if (result.ok) drop(result);
    });

    socket.on('toast', () => { playBtn.disabled = false; });
  }

  PZ.views.plinko = {
    enter() {
      bind();
      PZ.socket.emit('plinko:open');
      if (config) { refresh(); }
    },
    leave() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      balls = [];
    },
  };
})();
