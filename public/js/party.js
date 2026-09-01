'use strict';
/**
 * LE HALL DE LA SECTION PARTY.
 *
 * Le casino et la Party ne se mélangent pas : on ne mise pas de pièces ici,
 * et le rang affiché n'est pas celui du casino. Ce fichier gère le hall
 * (rang, choix du jeu, salons ouverts) et tout ce que les salons partagent :
 * le code, le chat, la barre du haut, le chrono.
 */

(() => {
  const { $, $$, el, fmt, timeOf } = PZ;

  /* ═══════════ Les jeux ═══════════ */

  const GAMES = [
    {
      id: 'undercover', name: 'Undercover', icon: 'i-spy', colour: '#9a86cf',
      players: '3 à 12', minutes: '10 min',
      blurb: 'Tout le monde a le même mot. Sauf un. Décris le tien sans le dire, ' +
        'et trouve celui qui bluffe — ou passe la partie à te faire oublier.',
      ready: true,
    },
    {
      id: 'poker', name: 'Poker', icon: 'i-cards', colour: '#d4af6a',
      players: '2 à 8', minutes: '20 min',
      blurb: 'Texas Hold’em en tournoi. Même tapis pour tout le monde au départ, ' +
        'blindes qui montent, et ça finit quand une seule personne a tous les jetons.',
      ready: true,
    },
    {
      id: 'loupgarou', name: 'Loup-garou', icon: 'i-wolf', colour: '#c98da6',
      players: '6 à 16', minutes: '25 min',
      blurb: 'La nuit tombe, le village s’endort. Prévu avec le vocal : micro coupé ' +
        'ou ouvert selon ton rôle.',
      ready: false,
      note: 'Le vocal a besoin d’un serveur relais dédié — c’est le prochain gros morceau.',
    },
    {
      id: 'uno', name: 'Uno', icon: 'i-uno', colour: '#e8a33c',
      players: '2 à 10', minutes: '15 min',
      blurb: 'Les +2 qui se cumulent, le +4 qu’on peut contester quand on sent le bluff, ' +
        'et les deux cartes de pénalité pour qui oublie d’annoncer.',
      ready: true,
    },
    {
      id: 'belote', name: 'Belote', icon: 'i-cards', colour: '#4C82F7',
      players: '4', minutes: '30 min',
      blurb: 'En équipes de deux, face à face. Ordre des cartes différent à l’atout, ' +
        'obligation de fournir, de couper et de monter, belote-rebelote et dix de der.',
      ready: true,
    },
    {
      id: 'monopoly', name: 'Monopoly', icon: 'i-dice', colour: '#b08d5e',
      players: '2 à 6', minutes: '1 h et des poussières',
      blurb: 'Les propriétés, les maisons, la prison, et l’amitié qui s’effrite.',
      ready: false,
    },
  ];

  const GAME_BY_ID = Object.fromEntries(GAMES.map((g) => [g.id, g]));
  PZ.partyGames = GAME_BY_ID;

  /* ═══════════ Le rang Party ═══════════ */

  function renderRank(r) {
    const box = $('#party-rank');
    box.replaceChildren();

    const head = el('div', 'prank-head');
    head.appendChild(el('span', 'prank-label', 'Ton rang Party'));
    head.appendChild(el('b', 'prank-title', r.title));
    box.appendChild(head);

    const row = el('div', 'prank-row');
    row.appendChild(el('div', 'prank-lvl', String(r.level)));

    const bars = el('div', 'prank-bars');
    const bar = el('div', 'prank-bar');
    const fill = el('span');
    fill.style.width = `${Math.round(r.ratio * 100)}%`;
    bar.appendChild(fill);
    bars.appendChild(bar);
    bars.appendChild(el('span', 'fine', r.need
      ? `${fmt(r.into)} / ${fmt(r.need)} XP avant le niveau ${r.level + 1}`
      : 'Niveau maximum atteint.'));
    row.appendChild(bars);
    box.appendChild(row);

    const stats = el('div', 'prank-stats');
    const stat = (value, label) => {
      const node = el('div');
      node.appendChild(el('b', null, value));
      node.appendChild(el('span', null, label));
      return node;
    };
    stats.appendChild(stat(fmt(r.played), 'parties'));
    stats.appendChild(stat(fmt(r.won), 'gagnées'));
    stats.appendChild(stat(r.played ? `${Math.round((r.won / r.played) * 100)} %` : '—', 'de réussite'));
    box.appendChild(stats);

    box.appendChild(el('p', 'fine',
      'Ce rang ne dépend d’aucune pièce : une partie perdue rapporte quand même, ' +
      'un peu moins qu’une gagnée. C’est la présence qui compte.'));
  }

  /* ═══════════ La grille des jeux ═══════════ */

  function renderGames(rooms) {
    const box = $('#party-games');
    box.replaceChildren();

    GAMES.forEach((g) => {
      const open = rooms.filter((r) => r.game === g.id).length;
      const node = el('div', `pgame${g.ready ? '' : ' soon'}`);
      node.style.setProperty('--c', g.colour);

      const icon = el('div', 'pgame-icon');
      icon.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><use href="#${g.icon}"/></svg>`;
      node.appendChild(icon);
      const head = el('div', 'pgame-head');
      head.appendChild(el('h3', null, g.name));
      head.appendChild(el('span', 'pgame-meta', `${g.players} joueurs · ${g.minutes}`));
      node.appendChild(head);

      node.appendChild(el('p', 'pgame-blurb', g.blurb));

      if (g.ready) {
        if (open) node.appendChild(el('span', 'pgame-open', `${open} salon${open > 1 ? 's' : ''} ouvert${open > 1 ? 's' : ''}`));
        const btn = el('button', 'btn btn-green btn-block', 'Ouvrir un salon');
        btn.addEventListener('click', () => PZ.socket.emit('party:create', { game: g.id }));
        node.appendChild(btn);
      } else {
        node.appendChild(el('span', 'pgame-soon', 'Pas encore là'));
        if (g.note) node.appendChild(el('p', 'fine', g.note));
      }

      box.appendChild(node);
    });
  }

  /* ═══════════ Les salons ouverts ═══════════ */

  function renderRooms(rooms) {
    const box = $('#party-rooms');
    box.replaceChildren();
    $('#party-count').textContent = rooms.length
      ? `${rooms.length} salon${rooms.length > 1 ? 's' : ''}`
      : 'aucun';

    if (!rooms.length) {
      box.appendChild(el('div', 'empty', 'Aucun salon ouvert. Ouvre le premier.'));
      return;
    }

    rooms.forEach((r) => {
      const game = GAME_BY_ID[r.game] || { icon: 'i-dice', colour: '#9a86cf' };
      const node = el('div', 'proom');
      node.style.setProperty('--c', game.colour);

      const rIcon = el('span', 'proom-icon');
      rIcon.innerHTML = `<svg viewBox="0 0 24 24" width="19" height="19"><use href="#${game.icon || 'i-dice'}"/></svg>`;
      node.appendChild(rIcon);

      const info = el('div', 'proom-info');
      info.appendChild(el('b', null, r.gameName));
      info.appendChild(el('span', 'fine', `chez ${r.host}`));
      node.appendChild(info);

      node.appendChild(el('span', 'proom-code', r.code));
      node.appendChild(el('span', 'proom-count', `${r.players}/${r.max}`));

      const btn = el('button', `btn ${r.joinable ? 'btn-green' : 'btn-soft'}`,
        r.joinable ? 'Rejoindre' : r.phase === 'lobby' ? 'Plein' : 'En cours');
      btn.disabled = !r.joinable;
      btn.addEventListener('click', () => PZ.socket.emit('party:join', { code: r.code }));
      node.appendChild(btn);

      box.appendChild(node);
    });
  }

  /* ═══════════ Rejoindre par code ═══════════ */

  $('#party-join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#party-code').value.trim().toUpperCase();
    if (code.length !== 4) return PZ.toast('Un code fait quatre lettres.', 'error');
    PZ.socket.emit('party:join', { code });
    $('#party-code').value = '';
  });

  $('#party-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  });

  /* ═══════════ Ce que les salons partagent ═══════════ */

  /**
   * La barre du haut d'un salon : le code (cliquable pour le copier), la
   * phase, et le bouton de lancement réservé à l'hôte.
   */
  PZ.roomChrome = (prefix, state, { startLabel, canStart } = {}) => {
    const code = $(`#${prefix}-code`);
    code.textContent = state.code;
    code.onclick = () => {
      navigator.clipboard?.writeText(state.code)
        .then(() => PZ.toast(`Code ${state.code} copié. Envoie-le à tes potes.`, 'success'))
        .catch(() => PZ.toast(`Le code est ${state.code}.`, 'info'));
    };

    const start = $(`#${prefix}-start`);
    const isHost = PZ.me && state.hostId === PZ.me.id;
    const waiting = state.phase === 'lobby' || state.phase === 'over';
    start.classList.toggle('hidden', !isHost || !waiting);
    start.textContent = state.phase === 'over' ? 'Relancer' : (startLabel || 'Lancer la partie');
    start.disabled = canStart === false;
  };

  /** Le chrono en barre, commun à tous les salons. */
  const timers = {};
  PZ.roomTimer = (prefix, deadline, serverNow, total) => {
    const bar = $(`#${prefix}-bar`);
    clearInterval(timers[prefix]);
    if (!deadline) { bar.style.width = '0%'; return; }

    const offset = Date.now() - serverNow;
    const span = total || Math.max(1, deadline - serverNow);
    const tick = () => {
      const left = deadline - (Date.now() - offset);
      const ratio = Math.max(0, Math.min(1, left / span));
      bar.style.width = `${ratio * 100}%`;
      bar.classList.toggle('urgent', left < 8000);
      if (left <= 0) clearInterval(timers[prefix]);
    };
    tick();
    timers[prefix] = setInterval(tick, 200);
  };
  PZ.stopRoomTimer = (prefix) => clearInterval(timers[prefix]);

  /** La liste des joueurs d'un salon, avec l'hôte et les absents. */
  PZ.roomPlayers = (box, players, { extra } = {}) => {
    box.replaceChildren();
    players.forEach((p) => {
      const node = el('div', `rplayer${p.out ? ' out' : ''}${p.connected ? '' : ' away'}`);
      const img = new Image(30, 30);
      img.src = PZ.avatarUrl(p);
      img.alt = '';
      node.appendChild(img);

      const who = el('div', 'rplayer-who');
      const name = el('b', null, p.name);
      who.appendChild(name);
      if (PZ.applyCosmetics) PZ.applyCosmetics(node, p.cosmetics, { avatar: img, name });

      const tags = el('span', 'rplayer-tags');
      if (p.host) tags.appendChild(el('i', 'tag host', 'hôte'));
      if (!p.connected) tags.appendChild(el('i', 'tag away', 'absent'));
      who.appendChild(tags);
      node.appendChild(who);

      if (extra) {
        const add = extra(p);
        if (add) node.appendChild(add);
      }
      box.appendChild(node);
    });
  };

  /** Une ligne de chat. */
  function chatNode(m) {
    if (m.system) return el('div', `rmsg sys ${m.kind || ''}`, m.text);
    const node = el('div', `rmsg${m.ghost ? ' ghost' : ''}`);
    node.appendChild(el('b', null, m.name));
    node.appendChild(el('span', null, m.text));
    node.appendChild(el('i', null, timeOf(m.at)));
    return node;
  }

  /** Le chat du salon, redessiné entièrement. */
  PZ.roomChat = (box, messages) => {
    // On ne recolle en bas que si on y était déjà : sinon un message qui
    // arrive pendant qu'on relit l'historique renvoie brutalement en bas.
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
    box.replaceChildren();
    messages.forEach((m) => box.appendChild(chatNode(m)));
    if (atBottom) box.scrollTop = box.scrollHeight;
  };

  /** Branche le formulaire de chat d'un salon. */
  function bindChat(prefix) {
    $(`#${prefix}-chat-form`).addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $(`#${prefix}-chat-input`);
      const text = input.value.trim();
      if (!text) return;
      PZ.socket.emit('party:say', { text });
      input.value = '';
    });
    $(`#${prefix}-leave`).addEventListener('click', () => {
      PZ.socket.emit('party:leave');
      PZ.go('party');
    });
    $(`#${prefix}-start`).addEventListener('click', () => PZ.socket.emit('party:start'));
  }
  bindChat('uc');
  bindChat('pk');

  /* ═══════════ Branchement ═══════════ */

  let rooms = [];

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__ptBound) return;
    socket.__ptBound = true;

    socket.on('party:list', ({ rooms: list }) => {
      rooms = list;
      if (PZ.view === 'party') { renderGames(rooms); renderRooms(rooms); }
    });

    socket.on('party:rank', renderRank);

    // Le serveur nous place dans un salon : on ouvre l'écran du jeu.
    socket.on('party:joined', ({ game }) => {
      // Chaque jeu Party a sa vue. La table de correspondance vit ici,
      // à un seul endroit : c'est ce qui évite qu'un nouveau jeu marche
      // partout sauf au moment de rejoindre un salon.
      PZ.go({ poker: 'pk', uno: 'uno', belote: 'bl', undercover: 'uc' }[game] || 'uc');
    });

    socket.on('party:left', () => {
      if (['uc', 'pk', 'uno', 'bl'].includes(PZ.view)) PZ.go('party');
    });

    // Un message de salon arrive tout seul, sans état complet : on l'ajoute
    // à la suite plutôt que de redemander toute la partie au serveur.
    socket.on('party:chat', (m) => {
      const prefix = PZ.view === 'pk' ? 'pk' : PZ.view === 'uc' ? 'uc' : null;
      if (!prefix) return;
      const box = $(`#${prefix}-chat`);
      if (!box || box.querySelector(`[data-mid="${m.id}"]`)) return;
      const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
      const node = chatNode(m);
      node.dataset.mid = m.id;
      box.appendChild(node);
      while (box.children.length > 60) box.firstElementChild.remove();
      if (atBottom) box.scrollTop = box.scrollHeight;
    });

    socket.on('party:closed', () => {
      if (PZ.view === 'uc' || PZ.view === 'pk') {
        PZ.toast('Le salon a été fermé.', 'warn');
        PZ.go('party');
      }
    });
  }

  PZ.views.party = {
    enter() {
      bind();
      PZ.socket.emit('party:open');
      renderGames(rooms);
      renderRooms(rooms);
    },
  };
})();
