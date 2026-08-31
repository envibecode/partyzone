/* ═══════════ Quiz culture G — rendu client ═══════════ */
window.PZGames = window.PZGames || {};

window.PZGames.quiz = (() => {
  let lastPhase = null;

  function render(root, state, ctx) {
    const u = ctx.util;

    if (state.phase === 'results') {
      root.innerHTML = `
        <div class="stage">
          <h2 class="reveal-title">🏆 Résultats</h2>
          <div class="scoreboard">${u.scoreboard(state.ranking)}</div>
          ${state.history && state.history.length ? `
            <details style="width:min(560px,100%);text-align:left">
              <summary class="muted small" style="cursor:pointer;padding:.5rem 0">Revoir les réponses</summary>
              <div class="desc-list">
                ${state.history.map((h) => `
                  <div class="desc-item">
                    <span style="flex:1">${u.esc(h.question)}</span>
                    <span class="desc-word">${u.esc(h.answer)}</span>
                  </div>`).join('')}
              </div>
            </details>` : ''}
          ${ctx.isHost ? '<button class="btn btn-primary" data-act="back">Retour au salon</button>' : '<p class="muted small">En attente de l’hôte…</p>'}
        </div>`;
      wire(root, ctx);
      lastPhase = state.phase;
      return;
    }

    if (state.phase === 'countdown') {
      root.innerHTML = `
        ${hud(state)}
        <div class="stage">
          <div class="countdown" id="cd">…</div>
          <p class="muted">Question ${state.round} — prépare tes doigts 🧠</p>
        </div>`;
      u.tickCountdown(root.querySelector('#cd'), state.deadline, state.serverNow);
      lastPhase = state.phase;
      return;
    }

    const solved = state.solved;
    root.innerHTML = `
      ${hud(state)}
      <div class="stage">
        <span class="badge">${u.esc(state.category || '')}</span>
        <p class="question-text">${u.esc(state.question || '')}</p>
        <div class="answer-mask">${u.esc(state.hint || '')}</div>

        ${state.phase === 'reveal'
          ? `<div class="reveal-sub">Réponse : <strong style="color:var(--lime)">${u.esc(state.revealed || '')}</strong></div>`
          : solved
            ? `<div class="reveal-sub">✅ Trouvé en ${(state.you.ms / 1000).toFixed(1)} s — <strong style="color:var(--lime)">+${state.you.points}</strong></div>`
            : `<form class="guess-form" data-form="guess">
                 <input class="input" id="qz-guess" placeholder="Ta réponse…" autocomplete="off" spellcheck="false">
                 <button class="btn btn-primary" type="submit">Go</button>
               </form>`}

        <div class="scoreboard">
          ${state.board.length
            ? state.board.map((b) => `
              <div class="sb-row">
                <span class="sb-rank">${medal(b.rank)}</span>
                <span></span>
                <span class="sb-name">${u.esc(b.name)}</span>
                <span class="sb-score">${(b.ms / 1000).toFixed(1)}s · +${b.points}</span>
              </div>`).join('')
            : '<p class="muted small">Personne n’a encore trouvé…</p>'}
        </div>
        <p class="muted small">${state.answeredCount}/${state.playerCount} joueurs ont répondu</p>
      </div>`;

    u.tickTimer(root.querySelector('[data-timer]'), state.deadline, state.serverNow);
    wire(root, ctx);

    const input = root.querySelector('#qz-guess');
    if (input && lastPhase !== 'playing') setTimeout(() => input.focus(), 60);
    lastPhase = state.phase;
  }

  function medal(rank) {
    return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
  }

  function hud(state) {
    return `<div class="hud">
      <span class="badge">🧠 Question ${state.round}/${state.totalRounds}</span>
      <div class="timer-wrap"><div class="timer-bar" data-timer></div></div>
      <span class="badge" data-clock>—</span>
    </div>`;
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
