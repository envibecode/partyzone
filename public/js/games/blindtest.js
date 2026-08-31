/* ═══════════ Blind Test — rendu client ═══════════ */
window.PZGames = window.PZGames || {};

window.PZGames.blindtest = (() => {
  let currentVideo = null;
  let lastPhase = null;
  let celebrated = false;

  function stopAudio() {
    currentVideo = null;
    window.PZYouTube.stop();
  }

  /**
   * La musique continue pendant la révélation : répondre ne coupe rien,
   * et on profite du morceau jusqu'à la manche suivante.
   */
  function handleAudio(state) {
    const playing = state.phase === 'playing' || state.phase === 'reveal';
    if (playing && state.video && state.video.id) {
      if (currentVideo !== state.video.id) {
        currentVideo = state.video.id;
        window.PZYouTube.play(state.video.id, state.video.startFraction);
      }
    } else if (!playing && currentVideo) {
      stopAudio();
    }
  }

  function hud(state) {
    const d = state.difficulty;
    return `<div class="hud">
      <span class="tag">♪ Manche ${state.round}/${state.totalRounds}</span>
      <span class="tag t-${d.color}">${d.name} ×${d.mult}</span>
      <div class="timer-wrap"><div class="timer-bar" data-timer></div></div>
      <span class="tag" data-clock>—</span>
    </div>`;
  }

  function render(root, state, ctx) {
    handleAudio(state);
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
              <summary class="fine" style="padding:6px 0">▸ Revoir les ${state.history.length} titres</summary>
              <div class="desc-list">
                ${state.history.map((h) => `<div class="desc-item"><span class="fine">#${h.round}</span><span>${u.esc(h.artist)} — ${u.esc(h.title)}</span></div>`).join('')}
              </div>
            </details>` : ''}
          ${ctx.isHost ? '<button class="btn btn-primary" data-act="back">Retour au salon</button>' : '<p class="fine">En attente de l’hôte…</p>'}
        </div>`;
      wire(root, ctx);
      lastPhase = state.phase;
      return;
    }
    celebrated = false;

    /* ── Compte à rebours ── */
    if (state.phase === 'countdown') {
      root.innerHTML = `
        ${hud(state)}
        <div class="stage">
          <div class="disc"></div>
          <div class="countdown" id="cd">…</div>
          <p class="muted">Monte le son — manche ${state.round}</p>
        </div>`;
      u.tickCountdown(root.querySelector('#cd'), state.deadline, state.serverNow);
      lastPhase = state.phase;
      return;
    }

    /* ── Révélation (la musique tourne toujours) ── */
    if (state.phase === 'reveal') {
      const r = state.revealed || {};
      root.innerHTML = `
        ${hud(state)}
        <div class="stage">
          ${r.thumbnail ? `<img class="thumb" src="${u.esc(r.thumbnail)}" alt="">` : '<div class="disc spin"></div>'}
          <div>
            <div class="reveal-title">${u.esc(r.title || '')}</div>
            <div class="reveal-sub">${u.esc(r.artist || '')}</div>
          </div>
          ${state.answerMode === 'choice' && state.choices
            ? u.choices(state.choices, { picked: state.yourPick, correct: state.correctIndex, disabled: true })
            : ''}
          <div class="scoreboard">${u.scoreboard(state.ranking.slice(0, 5))}</div>
          <p class="fine">🔊 Le morceau continue jusqu’à la manche suivante.</p>
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
          <div class="disc spin"></div>
          <div class="eq"><i></i><i></i><i></i><i></i><i></i></div>
          <p class="muted">Quel est ce morceau ? <span class="fine">(touches A · B · C · D)</span></p>
          ${u.choices(state.choices || [], { picked: state.yourPick, correct: null, disabled: answered })}
          ${answered
            ? `<p style="color:${state.yourResult.correct ? 'var(--good)' : 'var(--accent)'}">${state.yourResult.correct
                ? `✔ Bonne réponse — +${state.yourResult.points}`
                : '✘ Raté — la musique continue, attends la révélation'}</p>`
            : ''}
          <div class="hud" style="justify-content:center">
            <span class="tag">${state.answeredCount}/${state.playerCount} ont répondu</span>
            ${volume()}
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
        <div class="disc spin"></div>
        <div class="eq"><i></i><i></i><i></i><i></i><i></i></div>
        <div class="answers">
          ${wantTitle ? slot('Titre', state.hint.title, you.title, u) : ''}
          ${wantArtist ? slot('Artiste', state.hint.artist, you.artist, u) : ''}
        </div>
        <form class="guess-form" data-form="guess">
          <input class="input" id="bt-guess" placeholder="Titre ou artiste…" autocomplete="off" spellcheck="false" ${done ? 'disabled' : ''}>
          <button class="btn btn-primary" type="submit" ${done ? 'disabled' : ''}>OK</button>
        </form>
        <div class="hud" style="justify-content:center">
          <button class="btn btn-soft btn-sm" data-act="skip" ${state.youVotedSkip ? 'disabled' : ''}>⏭ Passer (${state.skipVotes}/${state.skipNeeded})</button>
          ${volume()}
        </div>
      </div>`;

    u.tickTimer(root.querySelector('[data-timer]'), state.deadline, state.serverNow);
    wire(root, ctx);
    const input = root.querySelector('#bt-guess');
    if (input && lastPhase !== 'playing') setTimeout(() => input.focus(), 60);
    lastPhase = state.phase;
  }

  function volume() {
    return `<label class="tag">🔊 <input type="range" min="0" max="100" value="${window.PZYouTube.getVolume()}" data-act="volume" style="width:84px;vertical-align:middle"></label>`;
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
    celebrated = false;
  }

  return { render, feedback, leave };
})();
