/* ══════════════════════════════════════════════════════════
   PartyZone — logique client
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
    online: [],
    selectedGame: 'blindtest',
    playlist: null,
    categories: [],
    difficulties: { blindtest: [], quiz: [] },
    importing: false,
    view: 'home',
    adminKeyConfigured: false,
  };

  let socket = null;

  const GAME_INFO = {
    blindtest: {
      icon: '🎧',
      name: 'Blind Test',
      tagline: 'Ta playlist YouTube, quatre propositions, et le premier qui reconnaît rafle la mise.',
      sub: 'Depuis YouTube',
      emoji: '🎵',
      gradient: 'linear-gradient(120deg, #ff4d6d, #c8264d 55%, #7a1b3a)',
    },
    quiz: {
      icon: '🧠',
      name: 'Culture G',
      tagline: '150 questions, 12 catégories. Réponds vite : les points fondent à chaque seconde.',
      sub: '150 questions',
      emoji: '💡',
      gradient: 'linear-gradient(120deg, #f59e0b, #d9432c 55%, #7a2020)',
    },
    undercover: {
      icon: '🕵️',
      name: 'Undercover',
      tagline: 'Un mot presque pareil, un imposteur, et beaucoup de mauvaise foi.',
      sub: '3 joueurs min.',
      emoji: '🎭',
      gradient: 'linear-gradient(120deg, #8b5cf6, #6d28d9 55%, #3f1d63)',
    },
  };

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
      const cls = `avatar ${size}`.trim();
      if (user.avatar) return `<img class="${cls}" src="${util.esc(user.avatar)}" alt="">`;
      return `<span class="${cls}">${util.esc(util.initials(user.name))}</span>`;
    },

    ordinal(i) {
      return i === 0 ? '1er' : `${i + 1}e`;
    },

    scoreboard(list) {
      if (!list || !list.length) return '<p class="muted">Pas encore de score.</p>';
      return list
        .map(
          (p, i) => `<div class="sb-row">
            <span class="sb-rank">${util.ordinal(i)}</span>
            ${util.avatar(p, 'sm')}
            <span class="sb-name">${util.esc(p.name)}</span>
            <span class="sb-score">${p.score}</span>
          </div>`
        )
        .join('');
    },

    /** Podium des trois premiers, avec les avatars Discord. */
    podium(list) {
      const top = (list || []).slice(0, 3);
      if (!top.length) return '';
      const order = [1, 0, 2]; // 2e, 1er, 3e — comme un vrai podium
      return `<div class="podium">${order
        .map((idx) => {
          const p = top[idx];
          if (!p) return '';
          const place = idx + 1;
          return `<div class="step p${place}">
            ${place === 1 ? '<span class="crown">👑</span>' : ''}
            ${util.avatar(p, place === 1 ? 'lg' : '')}
            <span class="step-name">${util.esc(p.name)}</span>
            <span class="step-score">${p.score} pts</span>
            <div class="step-block">${place}</div>
          </div>`;
        })
        .join('')}</div>`;
    },

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
        bar.classList.toggle('warn', ratio < 0.5 && ratio >= 0.22);
        bar.classList.toggle('crit', ratio < 0.22);
        if (clock) clock.textContent = Math.max(0, Math.ceil(left / 1000)) + 's';
        if (left > 0) loops.add(requestAnimationFrame(step));
      };
      step();
    },

    tickCountdown(el, deadline, serverNow) {
      if (!el || !deadline) return;
      const offset = Date.now() - (serverNow || Date.now());
      let lastSecond = null;
      const step = () => {
        const left = deadline - (Date.now() - offset);
        const s = Math.ceil(left / 1000);
        el.textContent = s > 0 ? s : 'GO !';
        if (s !== lastSecond && s >= 0 && s <= 3) {
          lastSecond = s;
          window.PZSfx.tick(s === 0);
        }
        if (left > -500) loops.add(requestAnimationFrame(step));
      };
      step();
    },

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

  /* ═══════════ Infobulles ═══════════
     Une seule bulle en position fixe, attachée au <body> : elle ne peut donc
     être ni rognée par une colonne qui défile, ni passer derrière une carte. */

  const tip = document.createElement('div');
  tip.className = 'tip';
  document.body.appendChild(tip);
  let tipTarget = null;

  function showTip(el) {
    const text = el.getAttribute('data-tip');
    if (!text) return;
    tipTarget = el;
    tip.textContent = text;
    tip.classList.add('on');
    placeTip(el);
  }

  function placeTip(el) {
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const gap = 10;
    // à droite si la place le permet, sinon à gauche, sinon au-dessus
    let left = r.right + gap;
    if (left + t.width > window.innerWidth - 8) left = r.left - t.width - gap;
    if (left < 8) left = Math.max(8, Math.min(window.innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2));
    let top = r.top + r.height / 2 - t.height / 2;
    top = Math.max(8, Math.min(window.innerHeight - t.height - 8, top));
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }

  function hideTip() {
    tipTarget = null;
    tip.classList.remove('on');
  }

  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el && el !== tipTarget) showTip(el);
    else if (!el && tipTarget) hideTip();
  });
  document.addEventListener('pointerdown', hideTip);
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) showTip(el);
  });
  document.addEventListener('focusout', hideTip);
  window.addEventListener('scroll', hideTip, true);

  /* ═══════════ Toasts ═══════════ */

  function toast(message, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = message;
    $('#toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, 3800);
  }

  /* ═══════════ Navigation ═══════════ */

  function show(view) {
    state.view = view;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.rail-btn[data-go]').forEach((b) => b.classList.toggle('active', b.dataset.go === view));
    if (view === 'vault') window.PZVault.open();
    else window.PZVault.close();
    if (view === 'admin') window.PZAdmin.open();
    else window.PZAdmin.close();
    if (view === 'home') {
      refreshLeaderboard();
      if (socket) socket.emit('presence:status', { status: 'home' });
    }
    $('.content').scrollTop = 0;
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      if (go.dataset.go === 'home' && state.room && state.view === 'room') {
        return toast('Quitte le salon d’abord (bouton « Quitter »).', 'info');
      }
      window.PZSfx.click();
      return show(go.dataset.go);
    }
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      if (state.view !== 'home') show('home');
      setTimeout(() => {
        const el = $(jump.dataset.jump);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
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
    fetch('/api/admin-config').then((r) => r.json()).then((d) => { state.adminKeyConfigured = Boolean(d.keyConfigured); }).catch(() => {});

    updateMuteButton();

    if (!me.user) return;

    state.user = me.user;
    $('#screen-auth').classList.remove('active');
    $('#app').classList.add('active');
    connect();
    renderHome();
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

  /* ═══════════ Son ═══════════ */

  function updateMuteButton() {
    const muted = window.PZSfx.isMuted();
    $('#btn-mute').textContent = muted ? '🔇' : '🔊';
    $('#btn-mute').dataset.tip = muted ? 'Remettre le son' : 'Couper le son';
  }
  $('#btn-mute').addEventListener('click', () => {
    window.PZSfx.setMuted(!window.PZSfx.isMuted());
    updateMuteButton();
    if (!window.PZSfx.isMuted()) window.PZSfx.correct();
  });

  /* ═══════════ Profil ═══════════ */

  function setProfile(profile) {
    const wasAdmin = state.profile && state.profile.admin;
    state.profile = profile;
    $('#user-chip').innerHTML = util.avatar(profile);
    $('#rail-admin').classList.toggle('hidden', !profile.admin);
    if (profile.admin && !wasAdmin) toast('Droits administrateur actifs 🛡️', 'success');
    $('#top-coins').textContent = (profile.coins || 0).toLocaleString('fr-FR');
    const h = new Date().getHours();
    $('#greeting').textContent = h < 6 ? 'Bonne nuit,' : h < 12 ? 'Bonjour,' : h < 18 ? 'Bon après-midi,' : 'Bonsoir,';
    $('#greet-name').textContent = profile.name;
    renderProgress();
  }

  function renderProgress() {
    const p = state.profile;
    if (!p) return;
    const R = 62;
    const C = 2 * Math.PI * R;
    const pct = p.need ? p.ratio : 1;

    $('#progress-ring').innerHTML = `
      <svg class="ring" width="160" height="160" viewBox="0 0 160 160" role="img"
           aria-label="Niveau ${p.level}, ${p.into} XP sur ${p.need || 0} pour le niveau suivant">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#ff8a5c"/><stop offset="100%" stop-color="#ff4d6d"/>
          </linearGradient>
        </defs>
        <circle class="ring-track" cx="80" cy="80" r="${R}"/>
        <circle class="ring-fill" cx="80" cy="80" r="${R}"
                stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
      </svg>
      <div class="ring-center">
        <span>XP totale</span>
        <b>${p.xp.toLocaleString('fr-FR')}</b>
      </div>
      <div class="ring-meta">
        <span class="lvl">Niveau ${p.level} · ${util.esc(p.title)}</span>
        <span class="next">${p.need ? `${p.into} / ${p.need} avant le niveau ${p.level + 1}` : 'Niveau maximum'}</span>
      </div>`;

    const s = p.stats || {};
    $('#stat-row').innerHTML = `
      <div class="stat-tile"><i>🏆</i><b>${s.wins || 0}</b><span>Victoires</span></div>
      <div class="stat-tile"><i>🎮</i><b>${s.games || 0}</b><span>Parties</span></div>
      <div class="stat-tile"><i>📚</i><b>${p.collected || 0}</b><span>Memes</span></div>`;
  }

  /* ═══════════ Menu du profil ═══════════ */

  const menu = $('#user-menu');

  function renderMenu() {
    const p = state.profile;
    if (!p) return;
    menu.innerHTML = `
      <div class="menu-head">
        ${util.avatar(p, 'sm')}
        <span><b>${util.esc(p.name)}</b><span class="fine">Niveau ${p.level} · ${util.esc(p.title)}</span></span>
      </div>
      ${p.admin ? '<button class="menu-item" data-menu="admin">🛡️ Panel administrateur</button>' : ''}
      ${!p.admin && state.adminKeyConfigured ? '<button class="menu-item" data-menu="claim">🔑 Entrer la clé admin</button>' : ''}
      <button class="menu-item" data-menu="logout">↩ Se déconnecter</button>`;

    menu.querySelectorAll('[data-menu]').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeMenu();
        const what = btn.dataset.menu;
        if (what === 'admin') return show('admin');
        if (what === 'claim') {
          const key = window.prompt('Clé administrateur :');
          if (key) socket.emit('admin:claim', { key });
          return;
        }
        if (what === 'logout') {
          fetch('/auth/logout', { method: 'POST' }).then(() => location.reload());
        }
      });
    });
  }

  function openMenu() {
    renderMenu();
    menu.classList.remove('hidden');
    $('#user-chip').setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    menu.classList.add('hidden');
    $('#user-chip').setAttribute('aria-expanded', 'false');
  }

  $('#user-chip').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.contains('hidden') ? openMenu() : closeMenu();
  });
  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('hidden') && !menu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  /* ═══════════ Accueil ═══════════ */

  function renderHome() {
    const featured = GAME_INFO[state.selectedGame] || GAME_INFO.blindtest;
    const hero = $('#hero');
    hero.style.background = featured.gradient;
    hero.dataset.emoji = featured.emoji;
    hero.innerHTML = `
      <div class="hero-badges">
        <span class="badge solid">★ À l’affiche</span>
        <span class="badge">${featured.icon} ${util.esc(featured.name)}</span>
      </div>
      <h1>${util.esc(featured.name)}</h1>
      <p>${util.esc(featured.tagline)}</p>
      <div class="hero-actions">
        <button class="btn btn-primary" data-play="${state.selectedGame}">Créer un salon</button>
        <button class="btn btn-soft" data-go="vault">Ouvrir des caisses</button>
      </div>`;

    $('#quick-games').innerHTML = Object.entries(GAME_INFO)
      .map(
        ([key, g]) => `<button class="qcard" data-feature="${key}">
          <i>${g.icon}</i>
          <span><b>${util.esc(g.name)}</b><span>${util.esc(g.sub)}</span></span>
          <span class="arrow">›</span>
        </button>`
      )
      .join('');

    $$('#quick-games [data-feature]').forEach((el) =>
      el.addEventListener('click', () => {
        state.selectedGame = el.dataset.feature;
        window.PZSfx.click();
        renderHome();
      })
    );
    $$('#hero [data-play]').forEach((el) =>
      el.addEventListener('click', () => {
        state.selectedGame = el.dataset.play;
        socket.emit('room:create');
      })
    );
  }

  /* ═══════════ Classement ═══════════ */

  let boardTimer = null;
  async function refreshLeaderboard() {
    clearTimeout(boardTimer);
    boardTimer = setTimeout(refreshLeaderboard, 30000);
    try {
      const { leaderboard } = await fetch('/api/leaderboard?limit=12').then((r) => r.json());
      const body = $('#board-body');
      if (!leaderboard.length) {
        body.innerHTML = '<tr><td colspan="4" class="ta-c muted">Personne n’a encore marqué. Sois le premier.</td></tr>';
        return;
      }
      body.innerHTML = leaderboard
        .map(
          (p) => `<tr class="${p.id === state.meId ? 'me' : ''}">
            <td class="rank r${p.rank}">${p.rank}</td>
            <td><span class="who">${util.avatar(p, 'sm')}<span><b>${util.esc(p.name)}</b><span>${util.esc(p.title)}</span></span></span></td>
            <td class="ta-c lvl-cell">${p.level}</td>
            <td class="ta-r xp-cell">${p.xp.toLocaleString('fr-FR')}</td>
          </tr>`
        )
        .join('');
    } catch {
      $('#board-body').innerHTML = '<tr><td colspan="4" class="ta-c muted">Classement indisponible.</td></tr>';
    }
  }

  /* ═══════════ Présence ═══════════ */

  function renderOnline() {
    $('#online-count').textContent = state.online.length;
    $('#online-list').innerHTML = state.online
      .map(
        (p) => `<li class="on-user" data-tip="${util.esc(p.name)} · ${util.esc(p.statusLabel)}">
          ${util.avatar(p)}
          <span class="status s-${p.status}"></span>
        </li>`
      )
      .join('');
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

    socket.on('online:list', ({ online }) => {
      state.online = online;
      renderOnline();
    });

    socket.on('toast', ({ message, kind }) => toast(message, kind));

    socket.on('room:joined', ({ code, chat }) => {
      show('room');
      $('#room-code').textContent = code;
      $('#room-title').textContent = 'Salon ' + code;
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
      if (!mine) return;
      toast(`+${mine.xp} XP · +${mine.coins} 🪙${mine.levelUp ? ` — niveau ${mine.level} !` : ''}`, 'success');
      if (mine.levelUp) {
        window.PZSfx.levelUp();
        window.PZConfetti.fire({ count: 90, origin: { x: 0.5, y: 0.3 } });
      }
    });

    socket.on('vault:showcase', ({ name, item }) => {
      if (name === (state.profile && state.profile.name)) return;
      toast(`${name} vient de sortir ${item.emoji} ${item.name} (${item.rarity}) !`, 'success');
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

    socket.on('blindtest:hit', ({ playerId, name, hits, points }) => {
      appendChat({ system: true, hit: true, text: `${name} a trouvé ${hits.join(' et ')} (+${points})` });
      flashPlayer(name);
      if (playerId !== state.meId) window.PZSfx.ping();
    });
    socket.on('quiz:hit', ({ playerId, name, rank, points }) => {
      appendChat({ system: true, hit: true, text: `${name} — ${util.ordinal(rank - 1)} (+${points})` });
      flashPlayer(name);
      if (playerId !== state.meId) window.PZSfx.ping();
    });
    socket.on('blindtest:reveal', ({ track }) => {
      appendChat({ system: true, text: `♪ ${track.artist} — ${track.title}` });
    });
    socket.on('quiz:reveal', ({ answer }) => {
      appendChat({ system: true, text: `→ ${answer}` });
    });

    socket.on('blindtest:feedback', (data) => {
      data.ok ? window.PZSfx.correct() : window.PZSfx.wrong();
      const mod = window.PZGames.blindtest;
      if (mod.feedback) mod.feedback($('#game-root'), data);
    });
    socket.on('quiz:feedback', (data) => {
      data.ok ? window.PZSfx.correct() : window.PZSfx.wrong();
      const mod = window.PZGames.quiz;
      if (mod.feedback) mod.feedback($('#game-root'), data);
    });

    socket.on('kicked', ({ reason }) => {
      document.body.innerHTML = `<div class="kicked">
        <h1>Accès refusé</h1>
        <p>${util.esc(reason || 'Ton compte a été suspendu.')}</p>
        <p class="fine">Si tu penses que c’est une erreur, parles-en à l’administrateur du site.</p>
      </div>`;
    });

    socket.on('room:closed', ({ reason }) => {
      state.room = null;
      state.game = null;
      location.hash = '';
      show('home');
      toast(reason || 'Le salon a été fermé.', 'error');
    });

    window.PZVault.init(socket);
    window.PZAdmin.init(socket);
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
      el.innerHTML = `${util.avatar(msg, 'sm')}<div class="bubble"><span class="who-n">${util.esc(msg.name)}</span>${util.esc(msg.text)}</div>`;
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

  /* ═══════════ Salon ═══════════ */

  $('#rail-create').addEventListener('click', () => socket.emit('room:create'));

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
      toast('Lien d’invitation copié 📋', 'success');
    } catch {
      toast('Code : ' + $('#room-code').textContent, 'info');
    }
  });

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
          ${util.avatar(p, 'sm')}
          <span class="pn"><b>${util.esc(p.name)}${p.id === room.hostId ? ' 👑' : ''}</b><span>Niv. ${p.level} · ${util.esc(p.title)}</span></span>
          <span class="ps">${state.game ? p.score : p.totalScore}</span>
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
      window.PZSfx.click();
      renderLobby();
    });
  });

  function difficultyPicker(game, current) {
    const list = state.difficulties[game] || [];
    if (!list.length) return '';
    return `<div class="field">
      <label>Difficulté</label>
      <div class="diff-row">
        ${list
          .map(
            (d) => `<button class="diff d-${d.color} ${d.id === current ? 'on' : ''}" data-diff="${game}:${d.id}" ${isHost() ? '' : 'disabled'}>
              <b>${util.esc(d.name)}</b>
              <small>${util.esc(d.blurb)}</small>
              <span class="mult">${d.seconds}s · points ×${d.mult}</span>
            </button>`
          )
          .join('')}
      </div>
    </div>`;
  }

  function answerModePicker(game, current) {
    return `<div class="field">
      <label>Mode de réponse</label>
      <div class="seg">
        <button class="${current === 'choice' ? 'on' : ''}" data-seg="${game}.answerMode" data-val="choice" ${isHost() ? '' : 'disabled'}>QCM · 4 choix</button>
        <button class="${current === 'type' ? 'on' : ''}" data-seg="${game}.answerMode" data-val="type" ${isHost() ? '' : 'disabled'}>Saisie libre</button>
      </div>
      <p class="fine">${current === 'choice'
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
        <h3>🎧 Blind Test</h3>
        <p class="fine">Colle le lien d’une playlist YouTube <b>publique</b> (ou d’une vidéo). Tout le monde entend le même extrait au même moment.</p>
        <div class="field">
          <label>Playlist YouTube</label>
          <div class="row">
            <input id="pl-url" class="input" style="flex:3" placeholder="https://www.youtube.com/playlist?list=…" value="${util.esc(st.playlistUrl || '')}" ${dis}>
            <button class="btn btn-soft" id="btn-import" ${dis} style="flex:0 0 auto">${state.importing ? '⏳ Import…' : 'Importer'}</button>
          </div>
        </div>
        ${state.playlist ? `
          <div class="playlist-preview">
            <span style="color:var(--good);font-size:13px">✔ ${state.playlist.count} titres chargés</span>
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
            <label>Manches : <b style="color:var(--accent)">${st.rounds}</b></label>
            <input type="range" min="3" max="30" value="${st.rounds}" data-set="blindtest.rounds" ${dis}>
          </div>
          ${st.answerMode === 'type' ? `
          <div class="field">
            <label>À deviner</label>
            <div class="seg">
              ${[['both', 'Titre + artiste'], ['title', 'Titre'], ['artist', 'Artiste']]
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
        <h3>🧠 Culture G</h3>
        <p class="fine">150 questions, 12 catégories. Le plus rapide marque le plus de points.</p>
        ${answerModePicker('quiz', st.answerMode)}
        ${difficultyPicker('quiz', st.difficulty)}
        <div class="field">
          <label>Questions : <b style="color:var(--accent)">${st.rounds}</b></label>
          <input type="range" min="5" max="30" value="${st.rounds}" data-set="quiz.rounds" ${dis}>
        </div>
        <div class="field">
          <label>Catégories (aucune = toutes)</label>
          <div class="chips">
            ${state.categories.map((c) => `<button class="chip ${(st.categories || []).includes(c) ? 'on' : ''}" data-cat="${util.esc(c)}" ${dis}>${util.esc(c)}</button>`).join('')}
          </div>
        </div>
        ${startButton('quiz', false)}`;
    }

    const st = s.undercover;
    const n = state.room.players.filter((p) => p.connected).length;
    return `
      <h3>🕵️ Undercover</h3>
      <p class="fine">Les civils partagent un mot. L’undercover en a un presque identique. Mr White n’a rien. Un mot chacun par tour, puis on vote.</p>
      <div class="row">
        <div class="field">
          <label>Undercover : <b style="color:var(--accent)">${st.undercoverCount}</b></label>
          <input type="range" min="1" max="3" value="${st.undercoverCount}" data-set="undercover.undercoverCount" ${dis}>
        </div>
        <div class="field">
          <label>Mr White : <b style="color:var(--accent)">${st.mrWhite}</b></label>
          <input type="range" min="0" max="2" value="${st.mrWhite}" data-set="undercover.mrWhite" ${dis}>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>Description : <b style="color:var(--accent)">${st.descriptionSeconds}s</b></label>
          <input type="range" min="15" max="90" step="5" value="${st.descriptionSeconds}" data-set="undercover.descriptionSeconds" ${dis}>
        </div>
        <div class="field">
          <label>Vote : <b style="color:var(--accent)">${st.voteSeconds}s</b></label>
          <input type="range" min="20" max="90" step="5" value="${st.voteSeconds}" data-set="undercover.voteSeconds" ${dis}>
        </div>
      </div>
      <p class="fine" ${n < 3 ? 'style="color:var(--accent)"' : ''}>${n < 3 ? '⚠ Il faut au moins 3 joueurs connectés.' : n + ' joueurs prêts.'}</p>
      ${startButton('undercover', n < 3)}`;
  }

  function startButton(key, disabled) {
    if (!isHost()) return '<p class="fine">⏳ En attente que l’hôte lance la partie…</p>';
    return `<button class="btn btn-primary btn-block" id="btn-start" data-game="${key}" ${disabled ? 'disabled' : ''}>▶ Lancer la partie</button>`;
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
        imp.textContent = '⏳ Import…';
        socket.emit('blindtest:import', { url });
      });
    }

    const start = $('#btn-start');
    if (start) {
      start.addEventListener('click', () => {
        window.PZSfx.unlock();
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
      bar.innerHTML = '<button class="btn btn-soft btn-sm" id="btn-abort">✕ Arrêter la partie</button>';
      root.appendChild(bar);
      $('#btn-abort').addEventListener('click', () => socket.emit('game:stop'));
    }
  }

  /* Raccourcis A/B/C/D pour le QCM. */
  document.addEventListener('keydown', (e) => {
    if (state.view !== 'room' || !state.game || state.game.answerMode !== 'choice') return;
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const index = ['a', 'b', 'c', 'd'].indexOf(e.key.toLowerCase());
    if (index < 0) return;
    const btn = document.querySelector(`#game-root [data-choice="${index}"]:not([disabled])`);
    if (btn) btn.click();
  });

  boot();
})();
