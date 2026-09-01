'use strict';
/**
 * LE LOBBY : la page d'accueil.
 *
 * Trois colonnes — le compte à gauche, le carrousel de jeux au centre, le
 * chat à droite — et la liste des tables ouvertes en bas. Tout se met à jour
 * tout seul : le serveur pousse les changements, on ne recharge jamais.
 */

(() => {
  const { $, $$, el, fmt, fmtShort } = PZ;

  /* ═══════════ Les jeux ═══════════ */

  const GAMES = [
    {
      id: 'blackjack', name: 'BLACKJACK', kind: 'cartes', icon: '🃏', art: '🃏',
      colour: '#2ee66b', tag: 'PVP', cost: 10, rating: '99,5',
      sub: 'Six jeux de cartes, cinq sièges. Le blackjack paie 3:2.',
      cta: 'JOUER', ctaClass: 'btn-green',
    },
    {
      id: 'roulette', name: 'ROULETTE', kind: 'classique', icon: '🎡', art: '🎡',
      colour: '#ff4d6a', tag: 'EN DIRECT', cost: 10, rating: '97,3',
      sub: 'Une seule roue pour tout le site. Un tour toutes les 33 secondes.',
      cta: 'MISER', ctaClass: 'btn-pink',
    },
    {
      id: 'plinko', name: 'PLINKO', kind: 'arcade', icon: '🔻', art: '🎯',
      colour: '#8b6bff', tag: 'SOLO', cost: 10, rating: '96,9',
      sub: 'La bille tombe. Les multiplicateurs viennent des vraies probabilités.',
      cta: 'LÂCHER', ctaClass: 'btn-green',
    },
    {
      id: 'slots', name: 'LES COPAINS', kind: 'machine à sous', icon: '🎰', art: '🎰',
      colour: '#ff9f1c', tag: 'BONUS', cost: 100, rating: '95,4',
      sub: 'Cinq rouleaux, dix lignes. Trois pings ouvrent huit tours offerts.',
      cta: 'LANCER', ctaClass: 'btn-gold',
    },
    {
      id: 'vault', name: 'CAISSES', kind: 'collection', icon: '📦', art: '🎁',
      colour: '#3fd6ff', tag: 'TOP', cost: 0, rating: '—',
      sub: '518 objets de culture internet à trouver. Les doublons se revendent.',
      cta: 'OUVRIR', ctaClass: 'btn-green',
    },
    {
      id: 'medals', name: 'MÉDAILLES', kind: 'progression', icon: '🏅', art: '🏅',
      colour: '#ffd166', tag: 'PARURES', cost: 0, rating: '—',
      sub: 'Un palier tous les cinquante objets. Le premier du site garde la version dorée.',
      cta: 'VOIR', ctaClass: 'btn-soft',
    },
    {
      id: 'mine', name: 'LA MINE', kind: 'gratuit', icon: '⛏️', art: '💎',
      colour: '#ffc23d', tag: 'GRATUIT', cost: 0, rating: '—',
      sub: 'Le seul robinet à pièces. Tape, améliore, recommence.',
      cta: 'MINER', ctaClass: 'btn-gold',
    },
  ];

  let index = 0;

  /* ─── La barre de jeux ─── */

  function buildGamebar() {
    const bar = $('#gamebar');
    bar.replaceChildren();
    GAMES.forEach((g, i) => {
      const pill = el('button', 'game-pill');
      pill.style.setProperty('--c', g.colour);
      pill.dataset.i = String(i);
      pill.appendChild(el('span', 'gp-ic', g.icon));
      const txt = el('span', 'gp-txt');
      txt.appendChild(el('span', 'gp-kind', g.kind));
      txt.appendChild(el('span', 'gp-name', g.name));
      pill.appendChild(txt);
      pill.addEventListener('click', () => select(i));
      bar.appendChild(pill);
    });
  }

  /* ─── Le carrousel ─── */

  function buildCarousel() {
    const track = $('#carousel-track');
    track.replaceChildren();
    GAMES.forEach((g, i) => {
      // La pastille de redistribution dépasse de la carte : elle vit donc
      // dans l'enveloppe, en dehors du cadre qui rogne le dégradé.
      const wrap = el('div', 'gcard-wrap');
      wrap.dataset.i = String(i);
      wrap.style.setProperty('--c', g.colour);

      const card = el('div', 'gcard');
      card.style.setProperty('--c', g.colour);

      const top = el('div', 'gcard-top');
      top.appendChild(el('span', 'gcard-tag', g.tag));
      const cost = el('span', 'gcard-cost');
      cost.appendChild(el('span', null, g.cost ? `dès ${g.cost}` : 'gratuit'));
      if (g.cost) cost.appendChild(el('i', null, '🪙'));
      top.appendChild(cost);
      card.appendChild(top);

      if (g.rating !== '—') {
        const rating = el('div', 'gcard-rating');
        rating.appendChild(el('span', null, '★'));
        rating.appendChild(el('span', null, `${g.rating} %`));
        rating.dataset.tip = 'Taux de redistribution : ce que le jeu rend aux joueurs sur la durée.';
        wrap.appendChild(rating);
      }

      card.appendChild(el('div', 'gcard-art', g.art));
      card.appendChild(el('div', 'gcard-name', g.name));
      card.appendChild(el('div', 'gcard-sub', g.sub));

      const cta = el('button', `btn ${g.ctaClass} gcard-cta`, g.cta);
      cta.addEventListener('click', (e) => {
        e.stopPropagation();
        PZ.go(g.id);
      });
      card.appendChild(cta);

      wrap.addEventListener('click', () => {
        if (i !== index) select(i);
      });

      wrap.appendChild(card);
      track.appendChild(wrap);
    });
    layout();
  }

  /** Place chaque carte selon sa distance à celle du centre. */
  function layout() {
    const cards = $$('#carousel-track .gcard-wrap');
    const n = GAMES.length;
    cards.forEach((card, i) => {
      // Distance signée la plus courte, pour que le carrousel boucle.
      let d = i - index;
      if (d > n / 2) d -= n;
      if (d < -n / 2) d += n;

      const abs = Math.abs(d);
      const x = d * 152;
      const scale = abs === 0 ? 1 : abs === 1 ? 0.84 : 0.7;
      const z = abs === 0 ? 3 : abs === 1 ? 2 : 1;

      card.style.transform = `translate(-50%, 0) translateX(${x}px) scale(${scale})`;
      card.style.zIndex = String(z);
      card.style.opacity = abs > 2 ? '0' : abs === 2 ? '.35' : '1';
      card.classList.toggle('center', abs === 0);
      card.classList.toggle('side', abs !== 0);
      card.classList.toggle('far', abs > 1);
    });

    $$('#gamebar .game-pill').forEach((pill, i) => {
      pill.classList.toggle('active', i === index);
    });
    $('.ghost-title').textContent = GAMES[index].name;
  }

  function select(i) {
    const n = GAMES.length;
    index = ((i % n) + n) % n;
    layout();
    SFX.pick(index);
  }

  $('#car-prev').addEventListener('click', () => select(index - 1));
  $('#car-next').addEventListener('click', () => select(index + 1));

  // Les flèches font tourner le carrousel, sauf si une fenêtre est ouverte
  // ou si on est en train d'écrire quelque part.
  addEventListener('keydown', (e) => {
    if (PZ.view !== 'home') return;
    if (!$('#modal').hidden) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowLeft') select(index - 1);
    if (e.key === 'ArrowRight') select(index + 1);
  });

  /* ═══════════ La colonne compte ═══════════ */

  let vaultInfo = null;   // dernier état connu du coffre, pour le minuteur
  let mineInfo = null;

  function renderWallets() {
    const box = $('#wallets');
    if (!box || !PZ.profile) return;
    const p = PZ.profile;

    const rows = [
      {
        icon: '⛏️', go: 'mine',
        value: mineInfo ? `${fmt(mineInfo.perClick)} / clic` : 'La Mine',
        sub: 'La seule source de pièces',
        lit: true,
      },
      {
        icon: '🎁', go: 'vault',
        value: `${p.collected || 0} / 60`,
        sub: 'memes trouvés',
        lit: false,
      },
      {
        icon: '📦', go: 'vault',
        value: vaultFreeLabel(),
        sub: 'caisse offerte',
        lit: Boolean(vaultInfo && vaultInfo.freeReady),
      },
      {
        icon: '🏅', go: 'leaderboard',
        value: `Niveau ${p.level}`,
        sub: p.title,
        lit: false,
      },
      {
        icon: '🎲', go: 'leaderboard',
        value: fmt(p.stats.rounds || 0),
        sub: 'manches jouées',
        lit: false,
      },
    ];

    box.replaceChildren();
    rows.forEach((r) => {
      const node = el('button', `wallet${r.lit ? ' lit' : ''}`);
      node.appendChild(el('span', 'ic', r.icon));
      const mid = el('span');
      mid.appendChild(el('span', 'v', r.value));
      mid.appendChild(el('span', 's', r.sub));
      node.appendChild(mid);
      node.appendChild(el('span', 'dot'));
      node.addEventListener('click', () => PZ.go(r.go));
      box.appendChild(node);
    });
  }

  function vaultFreeLabel() {
    if (!vaultInfo) return '—';
    if (vaultInfo.freeReady) return 'Disponible !';
    const left = vaultInfo.freeAt - (Date.now() - vaultInfo.offset);
    if (left <= 0) return 'Disponible !';
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  let walletTimer = null;

  /* ═══════════ Les tables ouvertes ═══════════ */

  const PHASE_LABEL = {
    waiting: 'en attente', betting: 'mises ouvertes', dealing: 'distribution',
    playing: 'en cours', dealer: 'croupier', payout: 'règlement',
  };

  function renderRooms(tables) {
    const track = $('#rooms-track');
    track.replaceChildren();

    if (!tables.length) {
      track.appendChild(el('div', 'room-empty',
        'Aucune table ouverte pour l’instant. Ouvre la tienne, le code s’envoie en un clic.'));
      return;
    }

    const COLOURS = ['#2ee66b', '#8b6bff', '#3fd6ff', '#ff4d6a', '#ffc23d'];

    tables.forEach((t, i) => {
      const room = el('button', 'room');
      room.style.setProperty('--c', COLOURS[i % COLOURS.length] + '33');
      if (t.phase !== 'waiting') room.classList.add('live');
      if (PZ.me && t.faces.some((f) => f.name === PZ.me.name)) room.classList.add('mine');

      const art = el('div', 'room-art');
      art.appendChild(el('span', null, '🃏'));
      room.appendChild(art);

      room.appendChild(el('div', 'room-name', `Table ${t.code}`));
      room.appendChild(el('div', 'room-host', t.host ? `chez ${t.host}` : 'libre'));

      if (t.faces.length) {
        const faces = el('div', 'room-faces');
        t.faces.forEach((f) => {
          const img = new Image(24, 24);
          img.src = PZ.avatarUrl(f);
          img.alt = '';
          faces.appendChild(img);
        });
        if (t.more) faces.appendChild(el('span', 'more', `+${t.more}`));
        room.appendChild(faces);
      }

      const foot = el('div', 'room-foot');
      const seats = el('div');
      seats.appendChild(el('div', 'k', 'places'));
      seats.appendChild(el('div', 'v', `${t.seats}/${t.seatsMax}`));
      foot.appendChild(seats);

      const bet = el('div');
      bet.appendChild(el('div', 'k', 'mise mini'));
      const v = el('div', 'v');
      v.appendChild(document.createTextNode(String(t.minBet)));
      v.appendChild(el('i', null, ' 🪙'));
      bet.appendChild(v);
      foot.appendChild(bet);

      const badge = el('div', 'room-badge', String(t.hand || 0));
      badge.dataset.tip = `Main n° ${t.hand || 0} — ${PHASE_LABEL[t.phase] || t.phase}`;
      foot.appendChild(badge);

      room.appendChild(foot);

      room.addEventListener('click', () => {
        PZ.go('blackjack');
        PZ.socket.emit('bj:join', { code: t.code });
      });

      track.appendChild(room);
    });
  }

  $('#rooms-create').addEventListener('click', () => {
    PZ.go('blackjack');
    PZ.socket.emit('bj:create');
  });

  const scrollRooms = (dir) => {
    $('#rooms-track').scrollBy({ left: dir * 200, behavior: 'smooth' });
  };
  $('#rooms-prev').addEventListener('click', () => scrollRooms(-1));
  $('#rooms-next').addEventListener('click', () => scrollRooms(1));

  /* ═══════════ Branchement ═══════════ */

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__lobbyBound) return;
    socket.__lobbyBound = true;

    socket.on('bj:lobby', ({ tables }) => renderRooms(tables || []));

    // Le coffre et la mine alimentent la colonne de gauche, même quand on
    // n'est pas sur leur écran.
    socket.on('vault:state', ({ vault }) => {
      vaultInfo = { freeAt: vault.freeAt, freeReady: vault.freeReady, offset: Date.now() - vault.serverNow };
      renderWallets();
    });
    socket.on('mine:state', ({ mine }) => {
      mineInfo = mine;
      renderWallets();
    });
  }

  document.addEventListener('pz:profile', renderWallets);
  document.addEventListener('pz:ready', () => {
    bind();
    // On demande une fois l'état du coffre pour alimenter le minuteur.
    PZ.socket.emit('vault:open');
    PZ.socket.emit('mine:open');
  });

  PZ.chat.mount({
    log: $('#chat-log'),
    form: $('#chat-form'),
    input: $('#chat-input'),
  });

  buildGamebar();
  buildCarousel();

  PZ.views.home = {
    enter() {
      bind();
      renderWallets();
      if (PZ.socket) PZ.socket.emit('bj:lobby');
      walletTimer = setInterval(() => {
        const slot = $('#wallets .wallet:nth-child(3) .v');
        if (slot) slot.textContent = vaultFreeLabel();
      }, 1000);
    },
    leave() { clearInterval(walletTimer); walletTimer = null; },
  };
})();
