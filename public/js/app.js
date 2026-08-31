/* ══════════════════════════════════════════════════════════
   PARTYZONE — logique client
   ══════════════════════════════════════════════════════════ */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = {
    user: null,
    profile: null,
    room: null,
    game: null,
    meId: null,
    selectedGame: 'blindtest',
    playlist: null,
    categories: [],
    difficulties: { blindtest: [], quiz: [] },
    importing: false,
    screen: 'auth',
  };

  let socket = null;

  /* ═══════════ Utilitaires partagés ═══════════ */

  const loops = new Set();
  function clearLoops() {
    for (const id of loops) cancelAnimationFrame(id);
    loops.clear();
  }

  const util = {
    esc(str) {
      return String(str == null ? '' : str).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
      );
    },

    initials(name) {
      return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    },

    avatar(user, size = '') {
      if (!user) return '';
      const cls = `avatar ${size}`;
      if (user.avatar) return `<img class="${cls}" src="${util.esc(user.avatar)}" alt="">`;
      return `<span class="${cls}">${util.esc(util.initials(user.name))}</span>`;
    },

    scoreboard(list) {
      if (!list || !list.length) return '<p class="c-dim">PAS ENCORE DE SCORE</p>';
      return list
        .map(
          (p, i) => `<div class="sb-row">
            <span class="sb-rank">${i === 0 ? '1ST' : i === 1 ? '2ND' : i === 2 ? '3RD' : i + 1 + 'TH'}</span>
            ${util.avatar(p)}
            <span class="sb-name">${util.esc(p.name)}</span>
            <span class="sb-score">${p.score}</span>
          </div>`
        )
        .join('');
    },

    /** Barre de temps synchronisée sur l'horloge du serveur. */
    tickTimer(bar, deadline, serverNow) {
      if (!bar || !deadline) return;
      const offset = Date.now() - (serverNow || Date.now());
      const hud = bar.closest('.hud');
      const clock = hud ? hud.querySelector('[data-clock]') : null;
      const total = Math.max(1, deadline - serverNow);
      const step = () => {
        const left = deadline - (Date.now() - offset);
        const ratio = Math.max(0, Math.min(1, left / total));
        bar.style.width = ratio * 100 + '%';
        bar.classList.toggle('warn', ratio < 0.5 && ratio >= 0.25);
        bar.classList.toggle('crit', ratio < 0.25);
        if (clock) clock.textContent = Math.max(0, Math.ceil(left / 1000)) + 'S';
        if (left > 0) loops.add(requestAnimationFrame(step));
      };
      step();
    },

    tickCountdown(el, deadline, serverNow) {
      if (!el || !deadline) return;
      const offset = Date.now() - (serverNow || Date.now());
      const step = () => {
        const left = deadline - (Date.now() - offset);
        const s = Math.ceil(left / 1000);
        el.textContent = s > 0 ? s : 'GO!';
        if (left > -500) loops.add(requestAnimationFrame(step));
      };
      step();
    },

    /** Grille de propositions du mode QCM, partagée par le blind test et le quiz. */
    choices(list, { picked, correct, disabled }) {
      const keys = ['A', 'B', 'C', 'D', 'E', 'F'];
      return `<div class="choices">${list
        .map((label, i) => {
          const classes = [];
          if (correct !== null && correct !== undefined) {
            if (i === correct) classes.push('right');
            else if (i === picked) classes.push('wrong');
            else classes.push('dimmed');
          } else if (i === picked) {
            classes.push('picked');
          }
          return `<button class="choice ${classes.join(' ')}" data-choice="${i}" ${disabled ? 'disabled' : ''}>
            <span class="key">${keys[i]}</span><span>${util.esc(label)}</span>
          </button>`;
        })
        .join('')}</div>`;
    },
  };

  window.PZ = { util };

  /* ═══════════ Toasts ═══════════ */

  function toast(message, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = message;
    $('#toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, 3600);
  }

  /* ═══════════ Écrans ═══════════ */

  function show(name) {
    state.screen = name;
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    if (name === 'farm') window.PZFarm.open();
    else window.PZFarm.close();
    if (name === 'home') refreshLeaderboard();
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      const target = go.dataset.go;
      if (target === 'home' && state.room) return; // on ne quitte pas un salon par mégarde
      show(target);
    }
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      const el = $(jump.dataset.jump);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  /* ═══════════ Démarrage ═══════════ */

  async function boot() {
    const params = new URLSearchParams(location.search);
    if (params.get('error')) {
      toast(
        {
          discord_non_configure: 'Discord n’est pas configuré sur ce serveur.',
          discord_echec: 'La connexion Discord a échoué.',
          state_invalide: 'Session expirée, réessaie.',
          auth_annulee: 'Connexion annulée.',
        }[params.get('error')] || 'Une erreur est survenue.',
        'error'
      );
      history.replaceState({}, '', location.pathname);
    }

    const [cfg, me] = await Promise.all([
      fetch('/api/config').then((r) => r.json()).catch(() => ({ discord: false })),
      fetch('/api/me').then((r) => r.json()).catch(() => ({ user: null })),
    ]);

    if (!cfg.discord) {
      $('#btn-discord').disabled = true;
      $('#discord-off').classList.remove('hidden');
    }

    fetch('/api/categories').then((r) => r.json()).then((d) => { state.categories = d.categories || []; }).catch(() => {});
    fetch('/api/difficulties').then((r) => r.json()).then((d) => { state.difficulties = d; }).catch(() => {});

    if (!me.user) return show('auth');

    state.user = me.user;
    connect();
    show('home');

    const joinCode = params.get('join') || location.hash.replace('#', '');
    if (joinCode && /^[A-Za-z]{4}$/.test(joinCode)) $('#join-code').value = joinCode.toUpperCase();
  }

  $('#btn-discord').addEventListener('click', () => { location.href = '/auth/discord'; });

  $('#form-guest').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#guest-name').value.trim();
    if (!name) return;
    await fetch('/auth/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    location.reload();
  });

  /* ═══════════ Profil ═══════════ */

  function setProfile(profile) {
    state.profile = profile;
    renderUserChips();
    renderProfileCard();
  }

  function renderUserChips() {
    if (!state.user) return;
    const lvl = state.profile ? `<span class="chip-lvl">LV${state.profile.level}</span>` : '';
    const html = `${util.avatar(state.user)}<span class="uname">${util.esc(state.user.name)}</span>${lvl}`;
    ['#user-chip', '#user-chip-2', '#user-chip-3'].forEach((sel) => {
      const el = $(sel);
      if (el) el.innerHTML = html;
    });
  }

  function renderProfileCard() {
    const p = state.profile;
    if (!p) return;
    const s = p.stats || {};
    $('#profile-card').innerHTML = `
      <div class="profile-head">
        ${util.avatar(p, 'lg')}
        <div>
          <div class="profile-name">${util.esc(p.name)}</div>
          <div class="c-dim tiny">${p.provider === 'discord' ? 'Compte Discord' : 'Invité — connecte-toi avec Discord pour garder ta progression'}</div>
        </div>
        <span class="profile-rank">${util.esc(p.title)}</span>
        <div class="profile-stats">
          <span class="mini-stat"><b>${p.level}</b><span>NIVEAU</span></span>
          <span class="mini-stat"><b>${p.xp}</b><span>XP</span></span>
          <span class="mini-stat"><b>${s.wins || 0}</b><span>VICTOIRES</span></span>
          <span class="mini-stat"><b>${p.coins || 0}</b><span>PIÈCES</span></span>
        </div>
      </div>
      <div>
        <div class="xp-bar"><div class="xp-fill" style="width:${Math.round((p.ratio || 0) * 100)}%"></div></div>
        <div class="xp-text">
          <span>LVL ${p.level}</span>
          <span>${p.need ? `${p.into} / ${p.need} XP` : 'NIVEAU MAX'}</span>
        </div>
      </div>`;
  }

  /* ═══════════ Classement ═══════════ */

  let boardTimer = null;
  async function refreshLeaderboard() {
    clearTimeout(boardTimer);
    boardTimer = setTimeout(refreshLeaderboard, 30000);
    try {
      const { leaderboard } = await fetch('/api/leaderboard?limit=15').then((r) => r.json());
      const body = $('#board-body');
      if (!leaderboard.length) {
        body.innerHTML = '<tr><td colspan="4" class="c-dim center">AUCUN SCORE — SOIS LE PREMIER</td></tr>';
        return;
      }
      body.innerHTML = leaderboard
        .map(
          (p) => `<tr class="${p.id === state.meId ? 'me' : ''}">
            <td class="rank-cell rank-${p.rank}">${p.rank === 1 ? '1ST' : p.rank === 2 ? '2ND' : p.rank === 3 ? '3RD' : p.rank + 'TH'}</td>
            <td><span class="player-cell">${util.avatar(p)}<span>${util.esc(p.name)}<br><span class="tiny c-dim">${util.esc(p.title)}</span></span></span></td>
            <td class="lvl-cell">${p.level}</td>
            <td class="xp-cell">${p.xp.toLocaleString('fr-FR')}</td>
          </tr>`
        )
        .join('');
    } catch {
      $('#board-body').innerHTML = '<tr><td colspan="4" class="c-dim center">CLASSEMENT INDISPONIBLE</td></tr>';
    }
  }

  /* ═══════════ Socket ═══════════ */

  function connect() {
    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect_error', (err) => {
      if (err.message === 'non_authentifie') {
        toast('Session expirée, reconnecte-toi.', 'error');
        setTimeout(() => location.reload(), 1200);
      }
    });

    socket.on('me', ({ user, profile }) => {
      state.user = user;
      state.meId = user.id;
      setProfile(profile);
    });

    socket.on('profile:update', (profile) => setProfile(profile));

    socket.on('toast', ({ message, kind }) => toast(message, kind));

    socket.on('room:joined', ({ code, chat }) => {
      show('room');
      $('#room-code').textContent = code;
      $('#chat').innerHTML = '';
      (chat || []).forEach(appendChat);
      location.hash = code;
    });

    socket.on('room:state', ({ room, you, game }) => {
      state.room = room;
      state.game = game;
      state.meId = you;
      render();
    });

    socket.on('chat:message', appendChat);

    socket.on('xp:awarded', ({ results }) => {
      const mine = results.find((r) => r.id === state.meId);
      if (mine) toast(`+${mine.xp} XP${mine.levelUp ? ` — NIVEAU ${mine.level} !` : ''}`, 'success');
    });

    socket.on('blindtest:playlist', (info) => {
      state.playlist = info;
      state.importing = false;
      renderLobby();
    });
    socket.on('blindtest:importing', () => {
      state.importing = true;
      renderLobby();
    });

    socket.on('blindtest:extract', async ({ playlistId }) => {
      try {
        const ids = await window.PZYouTube.scanPlaylist(playlistId);
        socket.emit('blindtest:videoIds', { ids, source: $('#pl-url') ? $('#pl-url').value : '' });
      } catch {
        state.importing = false;
        renderLobby();
        toast('Playlist illisible (privée ou vide ?). Essaie une playlist publique.', 'error');
      }
    });

    socket.on('blindtest:hit', ({ name, hits, points }) => {
      appendChat({ system: true, hit: true, text: `${name} a trouvé ${hits.join(' et ')} (+${points})` });
      flashPlayer(name);
    });
    socket.on('quiz:hit', ({ name, rank, points }) => {
      appendChat({ system: true, hit: true, text: `${rank === 1 ? '1ST' : 'OK'} — ${name} (+${points})` });
      flashPlayer(name);
    });
    socket.on('blindtest:reveal', ({ track }) => {
      appendChat({ system: true, text: `♪ ${track.artist} — ${track.title}` });
    });
    socket.on('quiz:reveal', ({ answer }) => {
      appendChat({ system: true, text: `→ ${answer}` });
    });

    socket.on('blindtest:feedback', (data) => {
      const mod = window.PZGames.blindtest;
      if (mod.feedback) mod.feedback($('#game-root'), data);
    });
    socket.on('quiz:feedback', (data) => {
      const mod = window.PZGames.quiz;
      if (mod.feedback) mod.feedback($('#game-root'), data);
    });

    window.PZFarm.init(socket, { onProfile: setProfile });
  }

  function flashPlayer(name) {
    $$('#players .player').forEach((el) => {
      if (el.dataset.name === name) {
        el.classList.remove('hit');
        void el.offsetWidth;
        el.classList.add('hit');
      }
    });
  }

  /* ═══════════ Chat ═══════════ */

  function appendChat(msg) {
    const box = $('#chat');
    if (!box) return;
    const el = document.createElement('div');
    if (msg.system) {
      el.className = 'msg system' + (msg.hit ? ' hit' : '');
      el.innerHTML = `<div class="bubble">${util.esc(msg.text)}</div>`;
    } else {
      el.className = 'msg';
      el.innerHTML = `${util.avatar(msg)}<div class="bubble"><span class="who">${util.esc(msg.name)}</span>${util.esc(msg.text)}</div>`;
    }
    box.appendChild(el);
    while (box.children.length > 120) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
  }

  $('#form-chat').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat:send', { text });
    input.value = '';
  });

  /* ═══════════ Accueil ═══════════ */

  $('#btn-create').addEventListener('click', () => socket.emit('room:create'));

  $('#form-join').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#join-code').value.trim().toUpperCase();
    if (code.length !== 4) return toast('Le code fait 4 lettres.', 'error');
    socket.emit('room:join', { code });
  });

  $('#join-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  });

  $('#btn-leave').addEventListener('click', () => {
    socket.emit('room:leave');
    state.room = null;
    state.game = null;
    location.hash = '';
    show('home');
  });

  $('#room-code-chip').addEventListener('click', async () => {
    const url = `${location.origin}/?join=${$('#room-code').textContent}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('LIEN D’INVITATION COPIÉ', 'success');
    } catch {
      toast('CODE : ' + $('#room-code').textContent, 'info');
    }
  });

  /* ═══════════ Salon ═══════════ */

  function isHost() {
    return state.room && state.room.hostId === state.meId;
  }

  function render() {
    clearLoops();
    renderPlayers();
    if (state.game) {
      $('#lobby').classList.add('hidden');
      $('#game-root').classList.remove('hidden');
      renderGame();
    } else {
      $('#game-root').classList.add('hidden');
      $('#game-root').innerHTML = '';
      $('#lobby').classList.remove('hidden');
      Object.values(window.PZGames).forEach((g) => g.leave && g.leave());
      renderLobby();
    }
    const typing = state.game && state.game.answerMode === 'type';
    $('#chat-title').innerHTML = typing
      ? 'CHAT <span class="chat-hint">· TAPE ICI POUR RÉPONDRE</span>'
      : 'CHAT';
  }

  function renderPlayers() {
    const room = state.room;
    if (!room) return;
    $('#player-count').textContent = room.players.length;
    $('#players').innerHTML = room.players
      .map(
        (p) => `<li class="player ${p.id === state.meId ? 'me' : ''} ${p.connected ? '' : 'off'}" data-name="${util.esc(p.name)}">
          ${util.avatar(p)}
          <span class="pname">${util.esc(p.name)}${p.id === room.hostId ? ' ♛' : ''}<br><span class="plvl">LV${p.level}</span></span>
          <span class="pscore">${state.game ? p.score : p.totalScore}</span>
        </li>`
      )
      .join('');
    $('#host-note').textContent = isHost()
      ? 'Tu es l’hôte : à toi de lancer les parties.'
      : 'Seul l’hôte peut lancer une partie.';
  }

  /* ── Lobby ── */

  function renderLobby() {
    $$('#game-picker .pick').forEach((b) => b.classList.toggle('selected', b.dataset.game === state.selectedGame));
    $('#game-settings').innerHTML = settingsHtml();
    wireSettings();
  }

  $$('#game-picker .pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedGame = btn.dataset.game;
      renderLobby();
    });
  });

  function difficultyPicker(game, current) {
    const list = state.difficulties[game] || [];
    if (!list.length) return '';
    return `<div class="field">
      <label>DIFFICULTÉ</label>
      <div class="diff-row">
        ${list
          .map(
            (d) => `<button class="diff d-${d.color} ${d.id === current ? 'on' : ''}" data-diff="${game}:${d.id}" ${isHost() ? '' : 'disabled'}>
              <b>${d.name}</b>
              <span class="tiny">${util.esc(d.blurb)}</span>
              <span class="mult c-dim">${d.seconds}s / manche · POINTS x${d.mult}</span>
            </button>`
          )
          .join('')}
      </div>
    </div>`;
  }

  function answerModePicker(game, current) {
    return `<div class="field">
      <label>MODE DE RÉPONSE</label>
      <div class="seg seg-green">
        <button class="${current === 'choice' ? 'on' : ''}" data-seg="${game}.answerMode" data-val="choice" ${isHost() ? '' : 'disabled'}>QCM · 4 CHOIX</button>
        <button class="${current === 'type' ? 'on' : ''}" data-seg="${game}.answerMode" data-val="type" ${isHost() ? '' : 'disabled'}>SAISIE LIBRE</button>
      </div>
      <p class="tiny c-dim">${current === 'choice'
        ? 'Version allégée : quatre propositions, un seul essai, aucune orthographe à deviner.'
        : 'Version classique : tu tapes la réponse, dans le jeu ou dans le chat.'}</p>
    </div>`;
  }

  function settingsHtml() {
    const s = state.room ? state.room.settings : null;
    if (!s) return '';
    const dis = isHost() ? '' : 'disabled';

    if (state.selectedGame === 'blindtest') {
      const st = s.blindtest;
      return `
        <h3>🎧 BLIND TEST</h3>
        <p class="tiny c-dim">Colle le lien d’une playlist YouTube <b>publique</b> (ou d’une vidéo). Tout le monde entend le même extrait, au même moment.</p>
        <div class="field">
          <label>PLAYLIST YOUTUBE</label>
          <div class="row">
            <input id="pl-url" class="input" style="flex:3" placeholder="https://www.youtube.com/playlist?list=…" value="${util.esc(st.playlistUrl || '')}" ${dis}>
            <button class="btn btn-ghost" id="btn-import" ${dis} style="flex:0 0 auto">${state.importing ? '⏳ IMPORT…' : '↓ IMPORTER'}</button>
          </div>
        </div>
        ${state.playlist ? `
          <div class="playlist-preview">
            <span class="c-green tiny">✔ ${state.playlist.count} TITRES CHARGÉS</span>
            ${state.playlist.sample.map((t) => `
              <div class="pp-item">
                ${t.thumbnail ? `<img src="${util.esc(t.thumbnail)}" alt="">` : ''}
                <span>${util.esc(t.artist)} — ${util.esc(t.title)}</span>
              </div>`).join('')}
          </div>` : ''}

        ${answerModePicker('blindtest', st.answerMode)}
        ${difficultyPicker('blindtest', st.difficulty)}

        <div class="row">
          <div class="field">
            <label>MANCHES : <b class="c-green">${st.rounds}</b></label>
            <input type="range" min="3" max="30" value="${st.rounds}" data-set="blindtest.rounds" ${dis}>
          </div>
          ${st.answerMode === 'type' ? `
          <div class="field">
            <label>À DEVINER</label>
            <div class="seg">
              ${[['both', 'TITRE + ARTISTE'], ['title', 'TITRE'], ['artist', 'ARTISTE']]
                .map(([v, l]) => `<button class="${st.mode === v ? 'on' : ''}" data-seg="blindtest.mode" data-val="${v}" ${dis}>${l}</button>`)
                .join('')}
            </div>
          </div>` : ''}
        </div>
        ${startButton('blindtest', !state.room.hasPlaylist)}`;
    }

    if (state.selectedGame === 'quiz') {
      const st = s.quiz;
      return `
        <h3>🧠 CULTURE G</h3>
        <p class="tiny c-dim">150 questions, 12 catégories. Le plus rapide marque le plus de points.</p>
        ${answerModePicker('quiz', st.answerMode)}
        ${difficultyPicker('quiz', st.difficulty)}
        <div class="field">
          <label>QUESTIONS : <b class="c-green">${st.rounds}</b></label>
          <input type="range" min="5" max="30" value="${st.rounds}" data-set="quiz.rounds" ${dis}>
        </div>
        <div class="field">
          <label>CATÉGORIES (aucune = toutes)</label>
          <div class="chips">
            ${state.categories.map((c) => `<button class="chip ${(st.categories || []).includes(c) ? 'on' : ''}" data-cat="${util.esc(c)}" ${dis}>${util.esc(c)}</button>`).join('')}
          </div>
        </div>
        ${startButton('quiz', false)}`;
    }

    const st = s.undercover;
    const n = state.room.players.filter((p) => p.connected).length;
    return `
      <h3>🕵 UNDERCOVER</h3>
      <p class="tiny c-dim">Les civils partagent un mot. L’undercover en a un presque identique. Mr White n’a rien. Un mot chacun par tour, puis on vote.</p>
      <div class="row">
        <div class="field">
          <label>UNDERCOVER : <b class="c-green">${st.undercoverCount}</b></label>
          <input type="range" min="1" max="3" value="${st.undercoverCount}" data-set="undercover.undercoverCount" ${dis}>
        </div>
        <div class="field">
          <label>MR WHITE : <b class="c-green">${st.mrWhite}</b></label>
          <input type="range" min="0" max="2" value="${st.mrWhite}" data-set="undercover.mrWhite" ${dis}>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>DESCRIPTION : <b class="c-green">${st.descriptionSeconds}s</b></label>
          <input type="range" min="15" max="90" step="5" value="${st.descriptionSeconds}" data-set="undercover.descriptionSeconds" ${dis}>
        </div>
        <div class="field">
          <label>VOTE : <b class="c-green">${st.voteSeconds}s</b></label>
          <input type="range" min="20" max="90" step="5" value="${st.voteSeconds}" data-set="undercover.voteSeconds" ${dis}>
        </div>
      </div>
      <p class="tiny ${n < 3 ? 'c-pink' : 'c-dim'}">${n < 3 ? '⚠ IL FAUT AU MOINS 3 JOUEURS' : n + ' JOUEURS PRÊTS'}</p>
      ${startButton('undercover', n < 3)}`;
  }

  function startButton(key, disabled) {
    if (!isHost()) return '<p class="tiny c-dim">⏳ EN ATTENTE DE L’HÔTE…</p>';
    return `<button class="btn btn-pink btn-block" id="btn-start" data-game="${key}" ${disabled ? 'disabled' : ''}>▶ LANCER LA PARTIE</button>`;
  }

  function wireSettings() {
    $$('#game-settings [data-set]').forEach((el) => {
      el.addEventListener('change', () => {
        const [game, key] = el.dataset.set.split('.');
        socket.emit('settings:update', { game, patch: { [key]: Number(el.value) } });
      });
      el.addEventListener('input', () => {
        const label = el.previousElementSibling && el.previousElementSibling.querySelector('b');
        if (label) label.textContent = el.value + (el.dataset.set.includes('Seconds') ? 's' : '');
      });
    });

    $$('#game-settings [data-seg]').forEach((el) => {
      el.addEventListener('click', () => {
        const [game, key] = el.dataset.seg.split('.');
        socket.emit('settings:update', { game, patch: { [key]: el.dataset.val } });
      });
    });

    $$('#game-settings [data-diff]').forEach((el) => {
      el.addEventListener('click', () => {
        const [game, id] = el.dataset.diff.split(':');
        socket.emit('settings:update', { game, patch: { difficulty: id } });
      });
    });

    $$('#game-settings [data-cat]').forEach((el) => {
      el.addEventListener('click', () => {
        const current = new Set(state.room.settings.quiz.categories || []);
        const cat = el.dataset.cat;
        current.has(cat) ? current.delete(cat) : current.add(cat);
        socket.emit('settings:update', { game: 'quiz', patch: { categories: [...current] } });
      });
    });

    const imp = $('#btn-import');
    if (imp) {
      imp.addEventListener('click', () => {
        const url = $('#pl-url').value.trim();
        if (!url) return toast('Colle un lien de playlist YouTube.', 'error');
        state.importing = true;
        imp.textContent = '⏳ IMPORT…';
        socket.emit('blindtest:import', { url });
      });
    }

    const start = $('#btn-start');
    if (start) {
      start.addEventListener('click', () => {
        window.PZYouTube.ensurePlayer().catch(() => {});
        socket.emit('game:start', { key: start.dataset.game });
      });
    }
  }

  /* ── Zone de jeu ── */

  function renderGame() {
    const root = $('#game-root');
    const mod = window.PZGames[state.game.key];
    if (!mod) return;

    const active = document.activeElement;
    const keep = active && root.contains(active) && active.tagName === 'INPUT'
      ? { id: active.id, value: active.value, start: active.selectionStart }
      : null;

    mod.render(root, state.game, {
      util,
      me: state.meId,
      isHost: isHost(),
      send: (action, payload) => socket.emit('game:action', { action, payload }),
      stopGame: () => socket.emit('game:stop'),
    });

    if (keep && keep.id) {
      const el = root.querySelector('#' + keep.id);
      if (el) {
        el.value = keep.value;
        el.focus();
        try { el.setSelectionRange(keep.start, keep.start); } catch {}
      }
    }

    if (isHost() && !root.querySelector('[data-act="back"]')) {
      const bar = document.createElement('div');
      bar.className = 'hud';
      bar.style.justifyContent = 'center';
      bar.innerHTML = '<button class="btn btn-mini btn-ghost" id="btn-abort">✕ ARRÊTER LA PARTIE</button>';
      root.appendChild(bar);
      $('#btn-abort').addEventListener('click', () => socket.emit('game:stop'));
    }
  }

  /* Raccourcis clavier A/B/C/D pour le QCM. */
  document.addEventListener('keydown', (e) => {
    if (state.screen !== 'room' || !state.game || state.game.answerMode !== 'choice') return;
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const index = ['a', 'b', 'c', 'd'].indexOf(e.key.toLowerCase());
    if (index < 0) return;
    const btn = document.querySelector(`#game-root [data-choice="${index}"]:not([disabled])`);
    if (btn) btn.click();
  });

  boot();
})();
