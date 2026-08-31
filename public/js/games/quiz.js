/* ═══════════ Quiz culture G — rendu client ═══════════ */
window.PZGames = window.PZGames || {};

window.PZGames.quiz = (() => {
  let lastPhase = null;
  let celebrated = false;

  function hud(state) {
    const d = state.difficulty;
    return `<div class="hud">
      <span class="tag">Question ${state.round}/${state.totalRounds}</span>
      <span class="tag t-${d.color}">${d.name} ×${d.mult}</span>
      <div class="timer-wrap"><div class="timer-bar" data-timer></div></div>
      <span class="tag" data-clock>—</span>
    </div>`;
  }

  function render(root, state, ctx) {
    const u = ctx.util;

    /* ── Résultats : podium, confettis, fanfare ── */
    if (state.phase === 'results') {
      if (!celebrated) {
        celebrated = true;
        window.PZSfx.victory();
        window.PZConfetti.celebrate();
      }
      root.innerHTML = `
        <div class="stage">
          <h2 class="reveal-title">🏆 Fin de la partie</h2>
          ${u.podium(state.ranking)}
          <div class="scoreboard">${u.scoreboard(state.ranking)}</div>
          ${state.history && state.history.length ? `
            <details style="width:min(560px,100%);text-align:left">
              <summary class="fine" style="padding:6px 0">▸ Revoir les réponses</summary>
              <div class="desc-list">
                ${state.history.map((h) => `<div class="desc-item"><span style="flex:1">${u.esc(h.question)}</span><span class="desc-word">${u.esc(h.answer)}</span></div>`).join('')}
              </div>
            </details>` : ''}
          ${ctx.isHost ? '<button class="btn btn-primary" data-act="back">Retour au salon</button>' : '<p class="fine">En attente de l’hôte…</p>'}
        </div>`;
      wire(root, ctx);
      lastPhase = state.phase;
      return;
    }
    celebrated = false;

    if (state.phase === 'countdown') {
      root.innerHTML = `
        ${hud(state)}
        <div class="stage">
          <div class="countdown" id="cd">…</div>
          <p class="muted">Question ${state.round} — prêt ?</p>
        </div>`;
      u.tickCountdown(root.querySelector('#cd'), state.deadline, state.serverNow);
      lastPhase = state.phase;
      return;
    }

    const revealing = state.phase === 'reveal';

    /* ── QCM ── */
    if (state.answerMode === 'choice') {
      const answered = state.yourPick !== null && state.yourPick !== undefined;
      root.innerHTML = `
        ${hud(state)}
        <div class="stage">
          <span class="tag t-yellow">${u.esc(state.category || '')}</span>
          <p class="question-text">${u.esc(state.question || '')}</p>
          ${u.choices(state.choices || [], {
            picked: state.yourPick,
            correct: revealing ? state.correctIndex : null,
            disabled: answered || revealing,
          })}
          ${answered && !revealing
            ? `<p style="color:${state.yourResult.correct ? 'var(--good)' : 'var(--accent)'}">${state.yourResult.correct ? `✔ +${state.yourResult.points} points` : '✘ Raté'}</p>`
            : ''}
          ${revealing ? `<p class="reveal-sub">Réponse : <b style="color:var(--good)">${u.esc(state.revealed || '')}</b></p>` : ''}
          ${board(state, u)}
          <p class="fine">${state.answeredCount}/${state.playerCount} ont répondu · touches A · B · C · D</p>
        </div>`;
      u.tickTimer(root.querySelector('[data-timer]'), state.deadline, state.serverNow);
      wire(root, ctx);
      lastPhase = state.phase;
      return;
    }

    /* ── Saisie ── */
    const solved = state.solved;
    root.innerHTML = `
      ${hud(state)}
      <div class="stage">
        <span class="tag t-yellow">${u.esc(state.category || '')}</span>
        <p class="question-text">${u.esc(state.question || '')}</p>
        <div class="answer-mask">${u.esc(state.hint || '')}</div>
        ${revealing
          ? `<p class="reveal-sub">Réponse : <b style="color:var(--good)">${u.esc(state.revealed || '')}</b></p>`
          : solved
            ? `<p style="color:var(--good)">✔ Trouvé en ${(state.you.ms / 1000).toFixed(1)}s — +${state.you.points}</p>`
            : `<form class="guess-form" data-form="guess">
                 <input class="input" id="qz-guess" placeholder="Ta réponse…" autocomplete="off" spellcheck="false">
                 <button class="btn btn-primary" type="submit">OK</button>
               </form>`}
        ${board(state, u)}
        <p class="fine">${state.answeredCount}/${state.playerCount} ont répondu</p>
      </div>`;

    u.tickTimer(root.querySelector('[data-timer]'), state.deadline, state.serverNow);
    wire(root, ctx);
    const input = root.querySelector('#qz-guess');
    if (input && lastPhase !== 'playing') setTimeout(() => input.focus(), 60);
    lastPhase = state.phase;
  }

  function board(state, u) {
    if (!state.board || !state.board.length) return '<p class="fine">Personne n’a encore trouvé…</p>';
    return `<div class="scoreboard">${state.board
      .map(
        (b) => `<div class="sb-row">
          <span class="sb-rank">${u.ordinal(b.rank - 1)}</span><span></span>
          <span class="sb-name">${u.esc(b.name)}</span>
          <span class="sb-score">${(b.ms / 1000).toFixed(1)}s · +${b.points}</span>
        </div>`
      )
      .join('')}</div>`;
  }

  function wire(root, ctx) {
    const form = root.querySelector('[data-form="guess"]');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = form.querySelector('input');
        const text = input.value.trim();
        if (!text) return;
        ctx.send('guess', { text });
        input.value = '';
      });
    }
    root.querySelectorAll('[data-choice]').forEach((btn) => {
      btn.addEventListener('click', () => ctx.send('pick', { index: Number(btn.dataset.choice) }));
    });
    const back = root.querySelector('[data-act="back"]');
    if (back) back.addEventListener('click', () => ctx.stopGame());
  }

  function feedback(root, data) {
    const input = root.querySelector('#qz-guess');
    if (!input) return;
    input.classList.remove('wrong', 'right');
    void input.offsetWidth;
    input.classList.add(data.ok ? 'right' : 'wrong');
    setTimeout(() => input.classList.remove('wrong', 'right'), 500);
  }

  function leave() {
    lastPhase = null;
    celebrated = false;
  }

  return { render, feedback, leave };
})();
