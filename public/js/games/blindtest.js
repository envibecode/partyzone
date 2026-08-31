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
    } else if (state.phase !== 'playing' && currentVideo) {
      stopAudio();
    }
  }

  function hud(state) {
    return `<div class="hud">
      <span class="badge2">♪ ${state.round}/${state.totalRounds}</span>
      <span class="badge2 c-${state.difficulty.color}">${state.difficulty.name} x${state.difficulty.mult}</span>
      <div class="timer-wrap"><div class="timer-bar" data-timer></div></div>
      <span class="badge2" data-clock>—</span>
    </div>`;
  }

  function render(root, state, ctx) {
    handleAudio(state);
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
              <summary class="c-dim tiny" style="cursor:pointer;padding:6px 0">▸ REVOIR LES ${state.history.length} TITRES</summary>
              <div class="desc-list">
                ${state.history.map((h) => `<div class="desc-item"><span class="c-dim tiny">#${h.round}</span><span>${u.esc(h.artist)} — ${u.esc(h.title)}</span></div>`).join('')}
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
          <div class="vinyl"></div>
          <div class="countdown c-pink" id="cd">…</div>
          <p class="c-dim">MONTE LE SON — MANCHE ${state.round}</p>
        </div>`;
      u.tickCountdown(root.querySelector('#cd'), state.deadline, state.serverNow);
      lastPhase = state.phase;
      return;
    }

    /* ── Révélation ── */
    if (state.phase === 'reveal') {
      const r = state.revealed || {};
      root.innerHTML = `
        ${hud(state)}
        <div class="stage">
          ${r.thumbnail ? `<img class="thumb" src="${u.esc(r.thumbnail)}" alt="">` : '<div class="vinyl"></div>'}
          <div>
            <div class="reveal-title c-green">${u.esc(r.title || '')}</div>
            <div class="reveal-sub">${u.esc(r.artist || '')}</div>
          </div>
          ${state.answerMode === 'choice' && state.choices
            ? u.choices(state.choices, { picked: state.yourPick, correct: state.correctIndex, disabled: true })
            : ''}
          <div class="scoreboard">${u.scoreboard(state.ranking.slice(0, 5))}</div>
        </div>`;
      lastPhase = state.phase;
      return;
    }

    /* ── En jeu : QCM ── */
    if (state.answerMode === 'choice') {
      const answered = state.yourPick !== null && state.yourPick !== undefined;
      root.innerHTML = `
        ${hud(state)}
        <div class="stage">
          <div class="vinyl spin"></div>
          <div class="eq"><i></i><i></i><i></i><i></i><i></i></div>
          <p class="c-dim">QUEL EST CE MORCEAU ? <span class="tiny">(touches A · B · C · D)</span></p>
          ${u.choices(state.choices || [], { picked: state.yourPick, correct: null, disabled: answered })}
          ${answered
            ? `<p class="${state.yourResult.correct ? 'c-green' : 'c-pink'}">${state.yourResult.correct ? `✔ BONNE RÉPONSE +${state.yourResult.points}` : '✘ RATÉ — attends la révélation'}</p>`
            : ''}
          <div class="hud" style="justify-content:center">
            <span class="badge2 c-dim">${state.answeredCount}/${state.playerCount} ONT RÉPONDU</span>
            ${volumeControl()}
          </div>
        </div>`;
      u.tickTimer(root.querySelector('[data-timer]'), state.deadline, state.serverNow);
      wire(root, ctx);
      lastPhase = state.phase;
      return;
    }

    /* ── En jeu : saisie ── */
    const wantTitle = state.mode !== 'artist';
    const wantArtist = state.mode !== 'title';
    const you = state.you || {};
    const done = (!wantTitle || you.title) && (!wantArtist || you.artist);

    root.innerHTML = `
      ${hud(state)}
      <div class="stage">
        <div class="vinyl spin"></div>
        <div class="eq"><i></i><i></i><i></i><i></i><i></i></div>
        <div class="answers">
          ${wantTitle ? slot('TITRE', state.hint.title, you.title, u) : ''}
          ${wantArtist ? slot('ARTISTE', state.hint.artist, you.artist, u) : ''}
        </div>
        <form class="guess-form" data-form="guess">
          <input class="input" id="bt-guess" placeholder="TITRE OU ARTISTE…" autocomplete="off" spellcheck="false" ${done ? 'disabled' : ''}>
          <button class="btn btn-pink" type="submit" ${done ? 'disabled' : ''}>OK</button>
        </form>
        <div class="hud" style="justify-content:center">
          <button class="btn btn-mini btn-ghost" data-act="skip" ${state.youVotedSkip ? 'disabled' : ''}>⏭ PASSER (${state.skipVotes}/${state.skipNeeded})</button>
          ${volumeControl()}
        </div>
      </div>`;

    u.tickTimer(root.querySelector('[data-timer]'), state.deadline, state.serverNow);
    wire(root, ctx);
    const input = root.querySelector('#bt-guess');
    if (input && lastPhase !== 'playing') setTimeout(() => input.focus(), 60);
    lastPhase = state.phase;
  }

  function volumeControl() {
    return `<label class="badge2">🔊 <input type="range" min="0" max="100" value="${window.PZYouTube.getVolume()}" data-act="volume" style="width:80px;vertical-align:middle"></label>`;
  }

  function slot(label, value, found, u) {
    return `<div class="answer-slot ${found ? 'found' : ''}">
      <span class="lbl">${label}</span>
      <span class="val">${found ? '✔ ' : ''}${u.esc(value || '')}</span>
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

    root.querySelectorAll('[data-choice]').forEach((btn) => {
      btn.addEventListener('click', () => ctx.send('pick', { index: Number(btn.dataset.choice) }));
    });

    const skip = root.querySelector('[data-act="skip"]');
    if (skip) skip.addEventListener('click', () => ctx.send('skip', {}));

    const vol = root.querySelector('[data-act="volume"]');
    if (vol) vol.addEventListener('input', (e) => window.PZYouTube.setVolume(e.target.value));

    const back = root.querySelector('[data-act="back"]');
    if (back) back.addEventListener('click', () => ctx.stopGame());
  }

  function feedback(root, data) {
    const input = root.querySelector('#bt-guess');
    if (!input) return;
    input.classList.remove('wrong', 'right');
    void input.offsetWidth;
    input.classList.add(data.ok ? 'right' : 'wrong');
    setTimeout(() => input.classList.remove('wrong', 'right'), 500);
  }

  function leave() {
    stopAudio();
    lastPhase = null;
  }

  return { render, feedback, leave };
})();
