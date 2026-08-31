/* ═══════════ Blind Test — rendu client ═══════════ */
window.PZGames = window.PZGames || {};

window.PZGames.blindtest = (() => {
  let currentVideo = null;
  let lastPhase = null;

  function stopAudio() {
    currentVideo = null;
    window.PZYouTube.stop();
  }

  function handleAudio(state) {
    const v = state.video;
    if (state.phase === 'playing' && v && v.id) {
      if (currentVideo !== v.id) {
        currentVideo = v.id;
        window.PZYouTube.play(v.id, v.startFraction);
      }
    } else if (state.phase !== 'playing') {
      if (currentVideo) stopAudio();
    }
  }

  function render(root, state, ctx) {
    handleAudio(state);
    const u = ctx.util;

    if (state.phase === 'results') {
      root.innerHTML = `
        ${hud(state, u)}
        <div class="stage">
          <h2 class="reveal-title">🏆 Résultats</h2>
          <div class="scoreboard">${u.scoreboard(state.ranking)}</div>
          ${state.history && state.history.length ? `
            <details style="width:min(560px,100%);text-align:left">
              <summary class="muted small" style="cursor:pointer;padding:.5rem 0">Revoir les ${state.history.length} titres</summary>
              <div class="desc-list">
                ${state.history.map((h) => `
                  <div class="desc-item">
                    <span class="muted small">#${h.round}</span>
                    <span>${u.esc(h.artist)} — <strong>${u.esc(h.title)}</strong></span>
                  </div>`).join('')}
              </div>
            </details>` : ''}
          ${ctx.isHost ? '<button class="btn btn-primary" data-act="back">Retour au salon</button>' : '<p class="muted small">En attente de l’hôte…</p>'}
        </div>`;
      wireCommon(root, ctx);
      lastPhase = state.phase;
      return;
    }

    if (state.phase === 'countdown') {
      root.innerHTML = `
        ${hud(state, u)}
        <div class="stage">
          <div class="vinyl"></div>
          <div class="countdown" id="cd">…</div>
          <p class="muted">Monte le son 🔊 la manche ${state.round} arrive</p>
        </div>`;
      u.tickCountdown(root.querySelector('#cd'), state.deadline, state.serverNow);
      lastPhase = state.phase;
      return;
    }

    if (state.phase === 'reveal') {
      const r = state.revealed || {};
      root.innerHTML = `
        ${hud(state, u)}
        <div class="stage">
          ${r.thumbnail ? `<img class="thumb" src="${u.esc(r.thumbnail)}" alt="">` : '<div class="vinyl"></div>'}
          <div>
            <div class="reveal-title">${u.esc(r.title || '')}</div>
            <div class="reveal-sub">${u.esc(r.artist || '')}</div>
          </div>
          <div class="scoreboard">${u.scoreboard(state.ranking.slice(0, 5))}</div>
        </div>`;
      lastPhase = state.phase;
      return;
    }

    /* ── En jeu ── */
    const wantTitle = state.mode !== 'artist';
    const wantArtist = state.mode !== 'title';
    const you = state.you || {};

    root.innerHTML = `
      ${hud(state, u)}
      <div class="stage">
        <div class="vinyl spin"></div>
        <div class="eq"><i></i><i></i><i></i><i></i><i></i></div>
        <div class="answers">
          ${wantTitle ? slot('Titre', state.hint.title, you.title) : ''}
          ${wantArtist ? slot('Artiste', state.hint.artist, you.artist) : ''}
        </div>
        <form class="guess-form" data-form="guess">
          <input class="input" id="bt-guess" placeholder="Titre ou artiste…" autocomplete="off" spellcheck="false" ${you.title && you.artist ? 'disabled' : ''}>
          <button class="btn btn-primary" type="submit" ${you.title && you.artist ? 'disabled' : ''}>Valider</button>
        </form>
        <div class="hud" style="justify-content:center">
          <button class="btn btn-mini btn-ghost" data-act="skip" ${state.youVotedSkip ? 'disabled' : ''}>
            ⏭ Passer (${state.skipVotes}/${state.skipNeeded})
          </button>
          <label class="badge" style="gap:.5rem">🔊
            <input type="range" min="0" max="100" value="${window.PZYouTube.getVolume()}" data-act="volume" style="width:90px">
          </label>
        </div>
      </div>`;

    u.tickTimer(root.querySelector('[data-timer]'), state.deadline, state.serverNow);
    wireCommon(root, ctx);

    const input = root.querySelector('#bt-guess');
    if (input && lastPhase !== 'playing') setTimeout(() => input.focus(), 60);
    lastPhase = state.phase;
  }

  function slot(label, value, found) {
    return `<div class="answer-slot ${found ? 'found' : ''}">
      <span class="lbl">${label}</span>
      <span class="val">${found ? '✅ ' : ''}${window.PZ.util.esc(value || '')}</span>
    </div>`;
  }

  function hud(state, u) {
    return `<div class="hud">
      <span class="badge">🎧 Manche ${state.round}/${state.totalRounds}</span>
      <div class="timer-wrap"><div class="timer-bar" data-timer></div></div>
      <span class="badge" data-clock>—</span>
    </div>`;
  }

  function wireCommon(root, ctx) {
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
    const skip = root.querySelector('[data-act="skip"]');
    if (skip) skip.addEventListener('click', () => ctx.send('skip', {}));

    const vol = root.querySelector('[data-act="volume"]');
    if (vol) vol.addEventListener('input', (e) => window.PZYouTube.setVolume(e.target.value));

    const back = root.querySelector('[data-act="back"]');
    if (back) back.addEventListener('click', () => ctx.stopGame());
  }

  /** Retour visuel immédiat sur la saisie (bonne / mauvaise réponse). */
  function feedback(root, data) {
    const input = root.querySelector('#bt-guess');
    if (!input) return;
    input.classList.remove('wrong', 'right');
    void input.offsetWidth;
    input.classList.add(data.ok ? 'right' : 'wrong');
    setTimeout(() => input.classList.remove('wrong', 'right'), 500);
  }

  function leave() { stopAudio(); lastPhase = null; }

  return { render, feedback, leave };
})();
