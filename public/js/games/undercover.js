/* ═══════════ Undercover — rendu client ═══════════ */
window.PZGames = window.PZGames || {};

window.PZGames.undercover = (() => {
  let celebrated = false;

  const ROLE_UI = {
    civil: { emoji: '🧑‍🤝‍🧑', label: 'Civil', hint: 'Décris ton mot sans le dire. Repère celui qui sonne faux.' },
    undercover: { emoji: '🕵️', label: 'Undercover', hint: 'Ton mot est légèrement différent. Reste vague, fonds-toi dans la masse.' },
    mrwhite: { emoji: '🎭', label: 'Mr White', hint: 'Tu n’as aucun mot. Écoute, improvise, et devine.' },
  };

  let lastPhase = null;

  function render(root, state, ctx) {
    const u = ctx.util;
    const you = state.you || {};
    const spectator = !state.you;
    if (state.phase !== 'result') lastPhase = state.phase;
    if (state.phase !== 'over') celebrated = false;

    if (spectator && state.phase !== 'over') {
      root.innerHTML = `
        ${hud(state, u)}
        <div class="stage">
          <div style="font-size:2.6rem">👀</div>
          <h2 class="reveal-title">Tu es spectateur</h2>
          <p class="fine">La partie a commencé sans toi — tu joues à la prochaine.</p>
          <div class="uc-grid">${state.players.map((p) => card(p, state, u, false)).join('')}</div>
          ${state.descriptions.length ? `<div class="desc-list">${descriptions(state, u)}</div>` : ''}
        </div>`;
      u.tickTimer(root.querySelector('[data-timer]'), state.deadline, state.serverNow);
      return;
    }

    if (state.phase === 'roles') {
      const r = ROLE_UI[you.role] || ROLE_UI.civil;
      root.innerHTML = `
        <div class="stage">
          <div class="role-card ${you.role === 'mrwhite' ? 'role-mrwhite' : ''}">
            <div style="font-size:2.6rem">${r.emoji}</div>
            <div class="role-name">${r.label}</div>
            <div class="role-word">${you.word ? u.esc(you.word) : '???'}</div>
            <p class="role-hint">${r.hint}</p>
          </div>
          <p class="fine">${state.counts.civil} civils · ${state.counts.undercover} undercover${state.counts.mrwhite ? ` · ${state.counts.mrwhite} Mr White` : ''}</p>
          <div class="countdown" id="cd" style="font-size:2.4rem">…</div>
        </div>`;
      u.tickCountdown(root.querySelector('#cd'), state.deadline, state.serverNow);
      return;
    }

    if (state.phase === 'over') {
      const winLabel = state.winner === 'civils' ? '🧑‍🤝‍🧑 Les civils gagnent !'
        : state.winner === 'mrwhite' ? '🎭 Mr White vole la victoire !'
        : '🕵️ Les imposteurs gagnent !';
      if (!celebrated) {
        celebrated = true;
        window.PZSfx.victory();
        window.PZConfetti.celebrate();
      }
      root.innerHTML = `
        <div class="stage">
          <h2 class="reveal-title">${winLabel}</h2>
          ${u.podium(state.ranking)}
          <p class="reveal-sub">Mot des civils : <strong style="color:var(--good)">${u.esc(state.words.civil)}</strong><br>
             Mot undercover : <strong style="color:var(--accent)">${u.esc(state.words.undercover)}</strong></p>
          <div class="uc-grid">${state.players.map((p) => card(p, state, u, false)).join('')}</div>
          <div class="scoreboard">${u.scoreboard(state.ranking)}</div>
          ${ctx.isHost ? '<button class="btn btn-primary" data-act="back">RETOUR AU SALON</button>' : '<p class="fine">En attente de l’hôte…</p>'}
        </div>`;
      wire(root, ctx);
      return;
    }

    if (state.phase === 'mrwhite') {
      const mine = you.isMrWhiteGuessing;
      root.innerHTML = `
        ${hud(state, u)}
        <div class="stage">
          <div style="font-size:3rem">🎭</div>
          <h2 class="reveal-title">${u.esc(state.pendingMrWhiteName || 'Mr White')} était Mr White !</h2>
          ${mine
            ? `<p class="reveal-sub">Dernière chance : quel était le mot des civils ?</p>
               <form class="guess-form" data-form="mrwhite">
                 <input class="input" placeholder="Le mot des civils…" autocomplete="off" autofocus>
                 <button class="btn btn-primary" type="submit">Deviner</button>
               </form>`
            : '<p class="reveal-sub">Il tente de deviner le mot des civils…</p>'}
        </div>`;
      u.tickTimer(root.querySelector('[data-timer]'), state.deadline, state.serverNow);
      wire(root, ctx);
      return;
    }

    if (state.phase === 'result') {
      const r = state.lastResult || {};
      if (lastPhase !== 'result') {
        lastPhase = 'result';
        r.tie ? window.PZSfx.ping() : window.PZSfx.wrong();
      }
      root.innerHTML = `
        <div class="stage">
          ${r.tie
            ? '<h2 class="reveal-title">🤝 Égalité — personne n’est éliminé</h2>'
            : `<div style="font-size:3rem">${ROLE_UI[r.eliminated.role].emoji}</div>
               <h2 class="reveal-title">${u.esc(r.eliminated.name)} est éliminé</h2>
               <p class="reveal-sub">C’était un <strong>${ROLE_UI[r.eliminated.role].label}</strong>${r.eliminated.word ? ` — son mot : <strong style="color:var(--good)">${u.esc(r.eliminated.word)}</strong>` : ''}</p>`}
          ${state.mrWhiteGuess ? `<p class="fine">Proposition de Mr White : « ${u.esc(state.mrWhiteGuess.guess)} » — ${state.mrWhiteGuess.correct ? '✅' : '❌'}</p>` : ''}
          <div class="uc-grid">${state.players.map((p) => card(p, state, u, false)).join('')}</div>
        </div>`;
      return;
    }

    /* ── Description & vote ── */
    const isVote = state.phase === 'vote';
    const canAct = you.alive;

    root.innerHTML = `
      ${hud(state, u)}
      <div class="stage">
        <div class="role-card ${you.role === 'mrwhite' ? 'role-mrwhite' : ''}" style="padding:1rem 1.4rem;animation:none">
          <div class="role-name">Ton mot</div>
          <div class="role-word" style="font-size:clamp(1.3rem,5vw,2rem)">${you.word ? u.esc(you.word) : '🎭 aucun'}</div>
        </div>

        ${isVote
          ? `<h2 class="reveal-title">🗳️ Qui est l’imposteur ?</h2>
             <p class="fine">${canAct ? 'Clique sur un joueur pour voter.' : 'Tu es éliminé — tu regardes.'}</p>`
          : you.isSpeaker
            ? `<h2 class="reveal-title">🎤 À toi ! Donne UN mot</h2>
               <form class="guess-form" data-form="describe">
                 <input class="input" maxlength="40" placeholder="Un seul mot…" autocomplete="off" autofocus>
                 <button class="btn btn-primary" type="submit">Envoyer</button>
               </form>`
            : `<h2 class="reveal-title">🎤 Tour de table — manche ${state.round}</h2>
               <p class="fine">${speakerName(state, u)}</p>`}

        <div class="uc-grid">${state.players.map((p) => card(p, state, u, isVote && canAct && p.alive && p.id !== ctx.me)).join('')}</div>

        ${state.descriptions.length ? `<div class="desc-list">${descriptions(state, u)}</div>` : ''}
      </div>`;

    u.tickTimer(root.querySelector('[data-timer]'), state.deadline, state.serverNow);
    wire(root, ctx);
  }

  function speakerName(state, u) {
    const sp = state.players.find((p) => p.speaking);
    return sp ? `${u.esc(sp.name)} réfléchit…` : 'En attente…';
  }

  function card(p, state, u, votable) {
    const you = state.you || {};
    const picked = you.votedFor === p.id;
    const roleTxt = p.role ? (ROLE_UI[p.role] || {}).label : '';
    return `<div class="uc-card ${p.alive ? '' : 'dead'} ${p.speaking ? 'speaking' : ''} ${votable ? 'votable' : ''} ${picked ? 'picked' : ''}" data-vote="${votable ? p.id : ''}">
      ${p.votesReceived ? `<span class="uc-badge">${p.votesReceived}</span>` : ''}
      ${u.avatar(p, 'lg')}
      <span class="uc-name">${u.esc(p.name)}</span>
      <span class="uc-role">${p.voted && state.phase === 'vote' ? '✔ a voté' : roleTxt || (p.alive ? '' : 'éliminé')}</span>
    </div>`;
  }

  function descriptions(state, u) {
    let html = '';
    let round = 0;
    for (const d of state.descriptions) {
      if (d.round !== round) {
        round = d.round;
        html += `<div class="desc-round">Manche ${round}</div>`;
      }
      html += `<div class="desc-item">
        <span>${u.esc(d.name)}</span>
        <span class="desc-word">${u.esc(d.word)}</span>
      </div>`;
    }
    return html;
  }

  function hud(state, u) {
    const label = { describe: '🎤 Description', vote: '🗳️ Vote', mrwhite: '🎭 Mr White' }[state.phase] || '';
    return `<div class="hud">
      <span class="tag">${label} · manche ${state.round}</span>
      <div class="timer-wrap"><div class="timer-bar" data-timer></div></div>
      <span class="tag" data-clock>—</span>
    </div>`;
  }

  function wire(root, ctx) {
    const desc = root.querySelector('[data-form="describe"]');
    if (desc) {
      desc.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = desc.querySelector('input');
        const word = input.value.trim();
        if (!word) return;
        ctx.send('describe', { word });
        input.value = '';
      });
    }
    const mw = root.querySelector('[data-form="mrwhite"]');
    if (mw) {
      mw.addEventListener('submit', (e) => {
        e.preventDefault();
        ctx.send('mrwhite-guess', { text: mw.querySelector('input').value.trim() });
      });
    }
    root.querySelectorAll('[data-vote]').forEach((el) => {
      const id = el.getAttribute('data-vote');
      if (!id) return;
      el.addEventListener('click', () => ctx.send('vote', { targetId: id }));
    });
    const back = root.querySelector('[data-act="back"]');
    if (back) back.addEventListener('click', () => ctx.stopGame());
  }

  function leave() {
    celebrated = false;
  }

  return { render, leave };
})();
