'use strict';
/**
 * L'ACCUEIL.
 *
 * Trois blocs, un but chacun : où j'en suis, à quoi je joue, avec qui.
 *
 * L'ancienne version montrait tout en même temps — un carrousel qui ne
 * laissait voir qu'un jeu net, une colonne de « réserves », un chat, une
 * rangée de pastilles, une bande de tables. Beaucoup d'informations, aucune
 * hiérarchie : on ne savait pas où regarder. Ici chaque bloc répond à une
 * seule question, et les jeux sont TOUS visibles d'un coup — on ne cache
 * pas son catalogue derrière des flèches.
 */

(() => {
  const { $, $$, el, fmt, fmtShort } = PZ;

  /* ═══════════ Le catalogue ═══════════ */

  const GAMES = [
    {
      id: 'blackjack', name: 'Blackjack', icon: 'i-cards',
      tag: 'Entre joueurs',
      line: 'Six jeux de cartes, cinq sièges, le blackjack payé 3:2. On ouvre une '
            + 'table, on envoie le code à quatre lettres, et on joue ensemble — sans bots. '
            + 'Les curieux peuvent regarder la partie sans prendre de place.',
      rtp: '99,5 %', min: 10,
    },
    {
      id: 'roulette', name: 'Roulette', icon: 'i-wheel',
      tag: 'En direct',
      line: 'Une seule roue pour tout le site, un tour toutes les 33 secondes.',
      rtp: '97,3 %', min: 10,
    },
    {
      id: 'plinko', name: 'Plinko', icon: 'i-plinko',
      tag: 'Solo',
      line: 'Huit à seize rangées. Les multiplicateurs viennent des probabilités réelles.',
      rtp: '96,9 %', min: 10,
    },
    {
      id: 'slots', name: 'Les Copains', icon: 'i-slots',
      tag: 'Machine à sous',
      line: 'Cinq rouleaux, dix lignes. Trois pings ouvrent huit tours offerts.',
      rtp: '95,4 %', min: 100,
    },
    {
      id: 'vault', name: 'Caisses', icon: 'i-case',
      tag: 'Collection',
      line: '518 objets à trouver, treize caisses. Les doublons se revendent.',
      rtp: null, min: 120,
    },
    {
      id: 'mine', name: 'La Mine', icon: 'i-pick',
      tag: 'Gratuit',
      line: 'Le robinet de secours. Une barre pleine vaut une soixantaine de pièces.',
      rtp: null, min: 0,
    },
  ];

  // Combien de tables tournent en ce moment : la grande tuile l'affiche,
  // donc la valeur voyage jusqu'ici.
  let openTables = 0;

  function renderGames() {
    const box = $('#games');
    if (!box) return;
    box.replaceChildren();

    GAMES.forEach((g) => {
        const card = el('button', 'game');
      // La couleur du jeu est déclarée ici, une fois : la tuile, son
      // jeton, sa bordure au survol et son ombre s'y accordent tout seuls.
      card.dataset.game = g.id;
      card.addEventListener('click', () => PZ.go(g.id));

      const top = el('div', 'game-top');
      const icon = el('span', 'game-icon');
      icon.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><use href="#${g.icon}"/></svg>`;
      top.appendChild(icon);
      top.appendChild(el('span', 'game-tag', g.tag));
      card.appendChild(top);

      card.appendChild(el('h3', null, g.name));
      card.appendChild(el('p', null, g.line));

      const foot = el('div', 'game-foot');
      // Pas d'emoji pièce ici : le mot suffit, et un emoji au milieu d'une
      // ligne de texte casse l'alignement de la ligne de base.
      foot.appendChild(el('span', 'game-min',
        g.min ? `dès ${fmt(g.min)} pièces` : 'gratuit'));
      if (g.rtp) {
        const rtp = el('span', 'game-rtp', g.rtp);
        rtp.dataset.tip = 'Taux de redistribution, calculé et non promis';
        foot.appendChild(rtp);
      }
      // La grande tuile porte trois chiffres vivants : c'est ce qui
      // justifie qu'elle prenne deux fois la place des autres.
      if (g.id === 'blackjack') {
        const live = el('div', 'game-live');
        const cell = (value, label, on) => {
          const d = el('div');
          const b = el('b', on ? 'on' : null, value);
          d.appendChild(b);
          d.appendChild(el('span', null, label));
          return d;
        };
        live.appendChild(cell(String(openTables), openTables > 1 ? 'tables ouvertes' : 'table ouverte', openTables > 0));
        live.appendChild(cell('5', 'places par table'));
        live.appendChild(cell('3:2', 'le blackjack paie'));
        card.appendChild(live);
      }

      card.appendChild(foot);

      box.appendChild(card);
    });
  }

  /* ═══════════ Où j'en suis ═══════════ */

  let vaultInfo = null;
  let mineInfo = null;
  let heroTimer = null;

  /** Le compte à rebours de la caisse offerte. */
  function freeLabel() {
    if (!vaultInfo) return '—';
    if (vaultInfo.freeReady) return 'Disponible';
    const left = vaultInfo.freeAt - (Date.now() - vaultInfo.offset);
    if (left <= 0) return 'Disponible';
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function renderHero() {
    const p = PZ.profile;
    if (!p) return;

    $('#tk-coins').textContent = fmt(p.coins);
    $('#hero-sub').textContent =
      `Niveau ${p.level} · ${p.title} — ${fmt(p.collected || 0)} objets sur ${fmt(p.collectionTotal || 518)}`;

    const box = $('#hero-cards');
    box.replaceChildren();

    const card = ({ icon, label, value, note, go, lit }) => {
      const node = el('button', `hcard${lit ? ' lit' : ''}`);
      const head = el('span', 'hcard-icon');
      head.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17"><use href="#${icon}"/></svg>`;
      node.appendChild(head);
      const body = el('span', 'hcard-body');
      body.appendChild(el('span', 'hcard-label', label));
      body.appendChild(el('b', null, value));
      if (note) body.appendChild(el('span', 'hcard-note', note));
      node.appendChild(body);
      node.addEventListener('click', () => PZ.go(go));
      return node;
    };

    /* ── Ce qui attend ──
       Deux tuiles, et elles ne s'allument que s'il y a vraiment quelque
       chose à prendre. Le reste du temps elles sont sobres comme tout le
       bandeau : un état « prêt » permanent ne veut plus rien dire. */
    const act = el('div', 'hero-act');
    const rake = p.rake || { pending: 0, rate: 1 };
    act.appendChild(card({
      icon: 'i-coin', go: 'mine', lit: rake.canClaim,
      label: 'Rakeback',
      value: fmtShort(rake.pending),
      note: rake.canClaim ? 'à récolter maintenant' : `${String(rake.rate).replace('.', ',')} % de tout ce que tu mises`,
    }));
    const ready = Boolean(vaultInfo && vaultInfo.freeReady);
    act.appendChild(card({
      icon: 'i-case', go: 'vault', lit: ready,
      label: 'Caisse offerte',
      value: freeLabel(),
      note: ready ? 'prête à ouvrir' : 'une toutes les 10 minutes',
    }));
    box.appendChild(act);

    /* ── Ce qui se consulte ──
       Trois chiffres, deux filets, rien d'autre. */
    const read = el('div', 'hero-read');
    const party = p.party || { level: 1, title: 'NOUVEAU' };
    read.appendChild(card({
      icon: 'i-party', go: 'party',
      label: 'Rang Party', value: `Niveau ${party.level}`, note: party.title,
    }));

    const total = p.collectionTotal || 518;
    const found = p.collected || 0;
    read.appendChild(card({
      icon: 'i-case', go: 'vault',
      label: 'Collection',
      value: `${fmt(found)} / ${fmt(total)}`,
      note: `${Math.round((found / total) * 100)} % du catalogue`,
    }));

    read.appendChild(card({
      icon: 'i-pick', go: 'mine',
      label: 'La Mine',
      value: mineInfo ? `${fmt(mineInfo.perClick)} / coup` : 'Ouvrir',
      note: mineInfo ? `${mineInfo.stamina}/${mineInfo.staminaMax} d’endurance` : 'gratuit',
    }));
    box.appendChild(read);

    // Le compte à rebours doit descendre sous les yeux.
    clearInterval(heroTimer);
    if (vaultInfo && !vaultInfo.freeReady) {
      heroTimer = setInterval(() => {
        const slot = $('#hero-cards .hero-act .hcard:nth-child(2) b');
        if (!slot) return clearInterval(heroTimer);
        slot.textContent = freeLabel();
      }, 1000);
    }
  }

  /* ═══════════ Les tables ouvertes ═══════════ */

  const PHASE_LABEL = {
    waiting: 'en attente', betting: 'mises ouvertes', dealing: 'distribution',
    playing: 'en cours', dealer: 'croupier', payout: 'règlement',
  };

  function renderRooms(tables) {
    const box = $('#rooms-track');
    if (!box) return;
    box.replaceChildren();

    if (!tables.length) {
      box.appendChild(el('div', 'empty',
        'Aucune table ouverte. Ouvre la tienne — le code s’envoie en un clic.'));
      return;
    }

    tables.forEach((t) => {
      const row = el('button', 'table-row');
      if (t.phase !== 'waiting') row.classList.add('live');
      if (PZ.me && t.faces.some((f) => f.name === PZ.me.name)) row.classList.add('mine');

      row.appendChild(el('span', 'table-code', t.code));

      const info = el('span', 'table-info');
      info.appendChild(el('b', null, t.host ? `Table de ${t.host}` : 'Table libre'));
      info.appendChild(el('span', null,
        `${PHASE_LABEL[t.phase] || t.phase} · main n° ${t.hand || 0} · dès ${fmt(t.minBet)} pièces`));
      row.appendChild(info);

      if (t.faces.length) {
        const faces = el('span', 'table-faces');
        t.faces.slice(0, 4).forEach((f) => {
          const img = new Image(24, 24);
          img.src = PZ.avatarUrl(f);
          img.alt = '';
          faces.appendChild(img);
        });
        if (t.more) faces.appendChild(el('span', 'more', `+${t.more}`));
        row.appendChild(faces);
      }

      row.appendChild(el('span', 'table-seats', `${t.seats}/${t.seatsMax}`));

      row.addEventListener('click', () => {
        PZ.go('blackjack');
        PZ.socket.emit('bj:join', { code: t.code });
      });
      box.appendChild(row);
    });
  }

  $('#rooms-create').addEventListener('click', () => {
    PZ.go('blackjack');
    PZ.socket.emit('bj:create');
  });

  /* ═══════════ Les défis du jour ═══════════ */

  /**
   * Trois barres, et le temps qu'il reste.
   *
   * Un défi accompli ne disparaît pas : il se coche et reste là. Voir ce
   * qu'on a déjà fait vaut autant que voir ce qu'il reste à faire, et une
   * ligne qui s'efface donne l'impression d'avoir rêvé.
   */
  let questState = null;

  function renderQuests(q) {
    if (!q) return;
    questState = q;
    const box = $('#quests-box');
    box.hidden = false;

    const left = Math.max(0, q.resetsIn);
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    const done = q.list.filter((x) => x.done).length;
    $('#quests-meta').textContent =
      `${done}/${q.list.length} · ${PZ.fmt(q.earned)} sur ${PZ.fmt(q.total)} ¤ · renouvelés dans ${h} h ${String(m).padStart(2, '0')}`;

    const list = $('#quest-list');
    list.replaceChildren();
    q.list.forEach((quest) => {
      const node = el('div', `quest${quest.done ? ' done' : ''}`);

      const mark = el('span', 'quest-mark');
      mark.textContent = quest.done ? '✓' : '';
      node.appendChild(mark);

      const body = el('div', 'quest-body');
      body.appendChild(el('b', null, quest.label));
      body.appendChild(el('span', null, quest.hint));
      const track = el('div', 'quest-track');
      const fill = el('i');
      fill.style.width = `${Math.round(quest.ratio * 100)}%`;
      track.appendChild(fill);
      body.appendChild(track);
      node.appendChild(body);

      const right = el('div', 'quest-side');
      right.appendChild(el('b', null, `+${PZ.fmt(quest.coins)}`));
      right.appendChild(el('span', null, quest.done ? 'récupéré' : `${PZ.fmt(quest.at)} / ${PZ.fmt(quest.goal)}`));
      node.appendChild(right);

      list.appendChild(node);
    });
  }

  // Le compteur avance tout seul, sans rien redemander au serveur.
  setInterval(() => {
    if (!questState || PZ.view !== 'home') return;
    questState.resetsIn = Math.max(0, questState.resetsIn - 30000);
    renderQuests(questState);
  }, 30000);

  /* ═══════════ Branchement ═══════════ */

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__lobbyBound) return;
    socket.__lobbyBound = true;

    // Le chat de l'accueil est un emplacement comme celui de la roulette ou
    // de la table de blackjack : sans ce branchement il reste une boîte vide.
    PZ.chat.mount({
      log: $('#chat-log'),
      form: $('#chat-form'),
      input: $('#chat-input'),
    });

    // Les défis du jour arrivent avec le profil et se rafraîchissent dès
    // qu'un d'eux tombe.
    socket.on('quest:state', ({ quests }) => renderQuests(quests));
    socket.on('quest:done', ({ quests }) => renderQuests(quests));

    socket.on('bj:lobby', ({ tables }) => {
      openTables = (tables || []).length;
      renderRooms(tables || []);
      // Le compteur de la grande tuile suit, sans qu'on recharge la page.
      if (PZ.view === 'home') renderGames();
    });

    socket.on('online:list', ({ online }) => {
      const slot = $('#chat-stats');
      if (!slot) return;
      const playing = online.filter((o) => o.status && o.status !== 'home').length;
      slot.textContent = playing
        ? `${online.length} en ligne · ${playing} en train de jouer`
        : `${online.length} en ligne`;
    });

    // La mine et le coffre alimentent deux cartes du bandeau : on écoute
    // leurs états même quand on n'est pas sur leur page.
    socket.on('mine:state', ({ mine }) => { mineInfo = mine; renderHero(); });
    socket.on('vault:state', ({ vault }) => {
      vaultInfo = { ...vault, offset: Date.now() - vault.serverNow };
      renderHero();
    });
  }

  document.addEventListener('pz:profile', renderHero);

  PZ.views.home = {
    enter() {
      bind();
      renderGames();
      renderHero();
      PZ.socket.emit('bj:lobby');
      // De quoi remplir la carte « caisse offerte » sans se déclarer
      // présent aux caisses. Le rakeback, lui, voyage déjà dans le profil.
      PZ.socket.emit('vault:peek');
    },
    leave() { clearInterval(heroTimer); },
  };
})();
