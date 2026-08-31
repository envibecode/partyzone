/* ══════════════════════════════════════════════════════════
   PartyZone — logique client
   ══════════════════════════════════════════════════════════ */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = {
    me: null,
    room: null,
    game: null,
    selectedGame: 'blindtest',
    playlist: null,
    categories: [],
    importing: false,
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
      return String(name || '?')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase();
    },

    avatar(user, size = '') {
      if (!user) return '';
      const cls = `avatar ${size}`;
      if (user.avatar) return `<img class="${cls}" src="${util.esc(user.avatar)}" alt="">`;
      return `<span class="${cls}">${util.esc(util.initials(user.name))}</span>`;
    },

    scoreboard(list) {
      if (!list || !list.length) return '<p class="muted small">Pas encore de score.</p>';
      return list
        .map(
          (p, i) => `<div class="sb-row">
            <span class="sb-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1)}</span>
            ${util.avatar(p)}
            <span class="sb-name">${util.esc(p.name)}</span>
            <span class="sb-score">${p.score} pts</span>
          </div>`
        )
        .join('');
    },

    /** Barre de progression synchronisée sur l'horloge du serveur. */
    tickTimer(bar, deadline, serverNow) {
      if (!bar || !deadline) return;
      const offset = Date.now() - (serverNow || Date.now());
      const clock = bar.closest('.hud') ? bar.closest('.hud').querySelector('[data-clock]') : null;
      const total = deadline - serverNow;
      const step = () => {
        const left = deadline - (Date.now() - offset);
        const ratio = Math.max(0, Math.min(1, left / total));
        bar.style.width = ratio * 100 + '%';
        bar.classList.toggle('warn', ratio < 0.3);
        if (clock) clock.textContent = Math.max(0, Math.ceil(left / 1000)) + 's';
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
        el.textContent = s > 0 ? s : 'GO !';
        if (left > -500) loops.add(requestAnimationFrame(step));
      };
      step();
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
      setTimeout(() => el.remove(), 300);
    }, 3600);
  }

  /* ═══════════ Navigation entre écrans ═══════════ */

  function show(id) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  }

  /* ═══════════ Authentification ═══════════ */

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

    fetch('/api/categories')
      .then((r) => r.json())
      .then((d) => { state.categories = d.categories || []; })
      .catch(() => {});

    if (me.user) {
      state.me = me.user;
      connect();
      show('screen-home');
      renderUserChips();
      const joinCode = params.get('join') || location.hash.replace('#', '');
      if (joinCode && joinCode.length === 4) {
        $('#join-code').value = joinCode.toUpperCase();
      }
    } else {
      show('screen-auth');
    }
  }

  $('#btn-discord').addEventListener('click', () => {
    location.href = '/auth/discord';
  });

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

  function renderUserChips() {
    if (!state.me) return;
    const html = `${util.avatar(state.me)}<span class="uname">${util.esc(state.me.name)}</span>`;
    $('#user-chip').innerHTML = html;
    $('#user-chip-2').innerHTML = html;
  }

  /* ═══════════ Connexion Socket.IO ═══════════ */

  function connect() {
    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect_error', (err) => {
      if (err.message === 'non_authentifie') {
        toast('Session expirée, reconnecte-toi.', 'error');
        setTimeout(() => location.reload(), 1200);
      }
    });

    socket.on('me', (user) => {
      state.me = user;
      renderUserChips();
    });

    socket.on('toast', ({ message, kind }) => toast(message, kind));

    socket.on('room:joined', ({ code, chat }) => {
      show('screen-room');
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

    socket.on('blindtest:playlist', (info) => {
      state.playlist = info;
      state.importing = false;
      renderLobby();
    });

    socket.on('blindtest:importing', () => {
      state.importing = true;
      renderLobby();
    });

    // Repli sans clé API : le navigateur de l'hôte extrait les IDs de la playlist
    socket.on('blindtest:extract', async ({ playlistId }) => {
      try {
        const ids = await window.PZYouTube.scanPlaylist(playlistId);
        socket.emit('blindtest:videoIds', { ids, source: $('#pl-url') ? $('#pl-url').value : '' });
      } catch (err) {
        state.importing = false;
        renderLobby();
        toast('Playlist illisible (privée ou vide ?). Essaie une playlist publique.', 'error');
      }
    });

    socket.on('blindtest:hit', ({ name, hits, points }) => {
      appendChat({ system: true, hit: true, text: `🎯 ${name} a trouvé ${hits.join(' et ')} (+${points})` });
      flashPlayer(name);
    });

    socket.on('quiz:hit', ({ name, rank, points }) => {
      appendChat({ system: true, hit: true, text: `${rank === 1 ? '🥇' : '✅'} ${name} a trouvé (+${points})` });
      flashPlayer(name);
    });

    socket.on('blindtest:reveal', ({ track }) => {
      appendChat({ system: true, text: `🎵 C’était : ${track.artist} — ${track.title}` });
    });

    socket.on('quiz:reveal', ({ answer }) => {
      appendChat({ system: true, text: `💡 Réponse : ${answer}` });
    });

    socket.on('blindtest:feedback', (data) => {
      const mod = window.PZGames.blindtest;
      if (mod.feedback) mod.feedback($('#game-root'), data);
    });
    socket.on('quiz:feedback', (data) => {
      const mod = window.PZGames.quiz;
      if (mod.feedback) mod.feedback($('#game-root'), data);
    });
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
    show('screen-home');
  });

  $('#btn-home').addEventListener('click', () => {
    if (state.room) return;
    show('screen-home');
  });

  $('#room-code-chip').addEventListener('click', async () => {
    const url = `${location.origin}/?join=${$('#room-code').textContent}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Lien d’invitation copié ! 📋', 'success');
    } catch {
      toast(`Code : ${$('#room-code').textContent}`, 'info');
    }
  });

  /* ═══════════ Rendu du salon ═══════════ */

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
    const isPlaying = state.game && (state.game.key === 'blindtest' || state.game.key === 'quiz');
    $('#chat-title').innerHTML = isPlaying
      ? 'Chat <span class="chat-hint">· tape ici pour répondre</span>'
      : 'Chat';
  }

  function renderPlayers() {
    const room = state.room;
    if (!room) return;
    $('#player-count').textContent = room.players.length;
    $('#players').innerHTML = room.players
      .map(
        (p) => `<li class="player ${p.id === state.meId ? 'me' : ''} ${p.connected ? '' : 'off'}" data-name="${util.esc(p.name)}">
          ${util.avatar(p)}
          <span class="name">${util.esc(p.name)} ${p.id === room.hostId ? '<span class="crown">👑</span>' : ''}</span>
          <span class="score">${state.game ? p.score : p.totalScore}</span>
        </li>`
      )
      .join('');
    $('#host-note').textContent = isHost()
      ? 'Tu es l’hôte : à toi de lancer les parties.'
      : 'Seul l’hôte peut lancer une partie.';
  }

  /* ── Lobby : choix du jeu + réglages ── */

  function renderLobby() {
    $$('#game-picker .pick').forEach((b) => {
      b.classList.toggle('selected', b.dataset.game === state.selectedGame);
    });
    $('#game-settings').innerHTML = settingsHtml();
    wireSettings();
  }

  $$('#game-picker .pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedGame = btn.dataset.game;
      renderLobby();
    });
  });

  function settingsHtml() {
    const s = state.room ? state.room.settings : null;
    if (!s) return '';
    const host = isHost();
    const dis = host ? '' : 'disabled';

    if (state.selectedGame === 'blindtest') {
      const st = s.blindtest;
      return `
        <h3>🎧 Blind Test</h3>
        <p class="muted small">Colle le lien d’une playlist YouTube <strong>publique</strong> (ou d’une vidéo). Tout le monde entend le même extrait, au même moment.</p>
        <div class="field">
          <label>Playlist YouTube</label>
          <div class="row">
            <input id="pl-url" class="input" style="flex:3" placeholder="https://www.youtube.com/playlist?list=…" value="${util.esc(st.playlistUrl || '')}" ${dis}>
            <button class="btn btn-ghost" id="btn-import" ${dis} style="flex:0 0 auto">${state.importing ? '⏳ Import…' : '📥 Importer'}</button>
          </div>
        </div>
        ${state.playlist ? `
          <div class="playlist-preview">
            <span class="muted small">✅ ${state.playlist.count} titres chargés</span>
            ${state.playlist.sample.map((t) => `
              <div class="pp-item">
                ${t.thumbnail ? `<img src="${util.esc(t.thumbnail)}" alt="">` : ''}
                <span>${util.esc(t.artist)} — ${util.esc(t.title)}</span>
              </div>`).join('')}
          </div>` : ''}

        <div class="row">
          <div class="field">
            <label>Manches : <strong id="lbl-rounds">${st.rounds}</strong></label>
            <input type="range" min="3" max="30" value="${st.rounds}" data-set="blindtest.rounds" ${dis}>
          </div>
          <div class="field">
            <label>Temps par manche : <strong id="lbl-secs">${st.roundSeconds}s</strong></label>
            <input type="range" min="10" max="60" step="5" value="${st.roundSeconds}" data-set="blindtest.roundSeconds" ${dis}>
          </div>
        </div>
        <div class="field">
          <label>À deviner</label>
          <div class="seg">
            ${[['both', 'Titre + artiste'], ['title', 'Titre seul'], ['artist', 'Artiste seul']]
              .map(([v, l]) => `<button class="${st.mode === v ? 'on' : ''}" data-seg="blindtest.mode" data-val="${v}" ${dis}>${l}</button>`)
              .join('')}
          </div>
        </div>
        ${startButton('blindtest', !state.playlist)}`;
    }

    if (state.selectedGame === 'quiz') {
      const st = s.quiz;
      return `
        <h3>🧠 Quiz culture G</h3>
        <p class="muted small">Tape la réponse le plus vite possible. Les lettres se dévoilent au fil du chrono.</p>
        <div class="row">
          <div class="field">
            <label>Questions : <strong>${st.rounds}</strong></label>
            <input type="range" min="5" max="30" value="${st.rounds}" data-set="quiz.rounds" ${dis}>
          </div>
          <div class="field">
            <label>Temps par question : <strong>${st.roundSeconds}s</strong></label>
            <input type="range" min="10" max="45" step="5" value="${st.roundSeconds}" data-set="quiz.roundSeconds" ${dis}>
          </div>
        </div>
        <div class="field">
          <label>Catégories (aucune sélection = toutes)</label>
          <div class="chips">
            ${state.categories.map((c) => `
              <button class="chip ${(st.categories || []).includes(c) ? 'on' : ''}" data-cat="${util.esc(c)}" ${dis}>${util.esc(c)}</button>`).join('')}
          </div>
        </div>
        ${startButton('quiz', false)}`;
    }

    const st = s.undercover;
    const n = state.room.players.filter((p) => p.connected).length;
    return `
      <h3>🕵️ Undercover</h3>
      <p class="muted small">Les civils partagent un mot. L’undercover en a un presque identique. Mr White n’a rien du tout. Un mot chacun par tour, puis on vote.</p>
      <div class="row">
        <div class="field">
          <label>Undercover : <strong>${st.undercoverCount}</strong></label>
          <input type="range" min="1" max="3" value="${st.undercoverCount}" data-set="undercover.undercoverCount" ${dis}>
        </div>
        <div class="field">
          <label>Mr White : <strong>${st.mrWhite}</strong></label>
          <input type="range" min="0" max="2" value="${st.mrWhite}" data-set="undercover.mrWhite" ${dis}>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>Temps de description : <strong>${st.descriptionSeconds}s</strong></label>
          <input type="range" min="15" max="90" step="5" value="${st.descriptionSeconds}" data-set="undercover.descriptionSeconds" ${dis}>
        </div>
        <div class="field">
          <label>Temps de vote : <strong>${st.voteSeconds}s</strong></label>
          <input type="range" min="20" max="90" step="5" value="${st.voteSeconds}" data-set="undercover.voteSeconds" ${dis}>
        </div>
      </div>
      <p class="muted small">${n < 3 ? '⚠️ Il faut au moins 3 joueurs connectés.' : `${n} joueurs prêts.`}</p>
      ${startButton('undercover', n < 3)}`;
  }

  function startButton(key, disabled) {
    if (!isHost()) return '<p class="muted small">⏳ En attente que l’hôte lance la partie…</p>';
    return `<button class="btn btn-primary" id="btn-start" data-game="${key}" ${disabled ? 'disabled' : ''}>🚀 Lancer la partie</button>`;
  }

  function wireSettings() {
    $$('#game-settings [data-set]').forEach((el) => {
      el.addEventListener('change', () => {
        const [game, key] = el.dataset.set.split('.');
        socket.emit('settings:update', { game, patch: { [key]: Number(el.value) } });
      });
      el.addEventListener('input', () => {
        const label = el.previousElementSibling && el.previousElementSibling.querySelector('strong');
        if (label) label.textContent = el.value + (el.dataset.set.includes('Seconds') ? 's' : '');
      });
    });

    $$('#game-settings [data-seg]').forEach((el) => {
      el.addEventListener('click', () => {
        const [game, key] = el.dataset.seg.split('.');
        socket.emit('settings:update', { game, patch: { [key]: el.dataset.val } });
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
        imp.textContent = '⏳ Import…';
        socket.emit('blindtest:import', { url });
      });
    }

    const start = $('#btn-start');
    if (start) {
      start.addEventListener('click', () => {
        // débloque la lecture audio du navigateur (geste utilisateur)
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

    // On mémorise la saisie en cours pour ne pas la perdre au re-rendu.
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

    // Bouton d'arrêt pour l'hôte, toujours disponible
    if (isHost() && !root.querySelector('[data-act="back"]')) {
      const bar = document.createElement('div');
      bar.className = 'hud';
      bar.style.justifyContent = 'center';
      bar.innerHTML = '<button class="btn btn-mini btn-ghost" id="btn-abort">✕ Arrêter la partie</button>';
      root.appendChild(bar);
      $('#btn-abort').addEventListener('click', () => socket.emit('game:stop'));
    }
  }

  boot();
})();
