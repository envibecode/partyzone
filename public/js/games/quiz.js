/* ═══════════ Quiz culture G — rendu client ═══════════ */
window.PZGames = window.PZGames || {};

window.PZGames.quiz = (() => {
  let lastPhase = null;

  function hud(state) {
    return `<div class="hud">
      <span class="badge2">? ${state.round}/${state.totalRounds}</span>
      <span class="badge2 c-${state.difficulty.color}">${state.difficulty.name} x${state.difficulty.mult}</span>
      <div class="timer-wrap"><div class="timer-bar" data-timer></div></div>
      <span class="badge2" data-clock>—</span>
    </div>`;
  }

  function medal(rank) {
    return rank === 1 ? '1ST' : rank === 2 ? '2ND' : rank === 3 ? '3RD' : rank + 'TH';
  }

  function render(root, state, ctx) {
    const u = ctx.util;

    /* ── Résultats ── */
    if (state.phase === 'results') {
      root.innerHTML = `
        ${hud(state)}
        <div class="stage">
          <h2 class="reveal-title c-yellow">HIGH SCORES</h2>
          <div class="scoreboard">${u.scoreboard(state.ranking)}</div>
          ${state.history && state.history.length ? `
            <details style="width:min(560px,100%);text-align:left">
              <summary class="c-dim tiny" style="cursor:pointer;padding:6px 0">▸ REVOIR LES RÉPONSES</summary>
              <div class="desc-list">
                ${state.history.map((h) => `<div class="desc-item"><span style="flex:1">${u.esc(h.question)}</span><span class="desc-word">${u.esc(h.answer)}</span></div>`).join('')}
              </div>
            </details>` : ''}
          ${ctx.isHost ? '<button class="btn btn-pink" data-act="back">RETOUR AU SALON</button>' : '<p class="c-dim tiny">EN ATTENTE DE L’HÔTE…</p>'}
        </div>`;
      wire(root, ctx);
      lastPhase = state.phase;
      return;
    }

    /* ── Compte à rebours ── */
    if (state.phase === 'countdown') {
      root.innerHTML = `
        ${hud(state)}
        <div class="stage">
          <div class="countdown c-green" id="cd">…</div>
          <p class="c-dim">QUESTION ${state.round} — PRÊT ?</p>
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
          <span class="badge2 c-yellow">${u.esc(state.category || '')}</span>
          <p class="question-text">${u.esc(state.question || '')}</p>
          ${u.choices(state.choices || [], {
            picked: state.yourPick,
            correct: revealing ? state.correctIndex : null,
            disabled: answered || revealing,
          })}
          ${answered && !revealing
            ? `<p class="${state.yourResult.correct ? 'c-green' : 'c-pink'}">${state.yourResult.correct ? `✔ +${state.yourResult.points} POINTS` : '✘ RATÉ'}</p>`
            : ''}
          ${revealing ? `<p class="reveal-sub">RÉPONSE : <b class="c-green">${u.esc(state.revealed || '')}</b></p>` : ''}
          ${boardHtml(state, u)}
          <p class="c-dim tiny">${state.answeredCount}/${state.playerCount} ONT RÉPONDU · touches A · B · C · D</p>
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
        <span class="badge2 c-yellow">${u.esc(state.category || '')}</span>
        <p class="question-text">${u.esc(state.question || '')}</p>
        <div class="answer-mask">${u.esc(state.hint || '')}</div>
        ${revealing
          ? `<p class="reveal-sub">RÉPONSE : <b class="c-green">${u.esc(state.revealed || '')}</b></p>`
          : solved
            ? `<p class="c-green">✔ TROUVÉ EN ${(state.you.ms / 1000).toFixed(1)}s — +${state.you.points}</p>`
            : `<form class="guess-form" data-form="guess">
                 <input class="input" id="qz-guess" placeholder="TA RÉPONSE…" autocomplete="off" spellcheck="false">
                 <button class="btn btn-pink" type="submit">OK</button>
               </form>`}
        ${boardHtml(state, u)}
        <p class="c-dim tiny">${state.answeredCount}/${state.playerCount} ONT RÉPONDU</p>
      </div>`;

    u.tickTimer(root.querySelector('[data-timer]'), state.deadline, state.serverNow);
    wire(root, ctx);
    const input = root.querySelector('#qz-guess');
    if (input && lastPhase !== 'playing') setTimeout(() => input.focus(), 60);
    lastPhase = state.phase;
  }

  function boardHtml(state, u) {
    if (!state.board || !state.board.length) return '<p class="c-dim tiny">PERSONNE N’A ENCORE TROUVÉ…</p>';
    return `<div class="scoreboard">${state.board
      .map(
        (b) => `<div class="sb-row">
          <span class="sb-rank">${medal(b.rank)}</span><span></span>
          <span class="sb-name">${u.esc(b.name)}</span>
          <span class="sb-score">${(b.ms / 1000).toFixed(1)}s +${b.points}</span>
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

  function leave() { lastPhase = null; }

  return { render, feedback, leave };
})();
