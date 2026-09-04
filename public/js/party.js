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
      id: 'blindtest', name: 'Blindtest', icon: 'i-spark', colour: '#FF3D8B',
      players: '1 à 12', minutes: '15 min',
      blurb: 'Ta playlist YouTube, un extrait, quatre propositions. La musique ne s’arrête ' +
        'pas quand quelqu’un trouve — les autres cherchent encore.',
      ready: true,
    },
    {
      id: 'loup', name: 'Loup-garou', icon: 'i-wolf', colour: '#c0504a',
      players: '4 à 16', minutes: '25 min',
      blurb: 'Les rôles, les nuits, les votes. Voyante, sorcière et chasseur compris. ' +
        'Le débat se fait de vive voix sur Discord — le site ne fait que compter.',
      ready: true,
    },
    {
      id: 'monopoly', name: 'Monopoly', icon: 'i-dice', colour: '#b08d5e',
      players: '2 à 6', minutes: '45 min en partie courte',
      blurb: 'Le plateau français, toutes les règles : monopoles, maisons et hôtels, ' +
        'hypothèques, échanges, prison. Réglable en 30 ou 60 tours pour finir avant la nuit.',
      ready: true,
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
      'un peu moins qu’une gagnée. C’est la présence qui compte. Il est aussi ' +
      'complètement séparé du classement du mois : l’XP gagnée ici ne compte ' +
      'pas pour le lot. C’est le classement entre potes, rien de plus.'));
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

      const count = el('span', 'proom-count', `${r.players}/${r.max}`);
      // Combien de gens regardent : ça dit d'un coup d'œil quelle partie
      // vaut le coup d'œil, justement.
      if (r.watchers) count.appendChild(el('i', 'proom-eyes', `👁 ${r.watchers}`));
      node.appendChild(count);

      // Une partie commencée ne se rejoint pas — mais elle se regarde.
      // C'est là que ça compte le plus : un Monopoly dure trois quarts
      // d'heure, et le copain qui arrive après le début n'avait jusqu'ici
      // rien d'autre à faire qu'attendre.
      if (r.joinable) {
        const btn = el('button', 'btn btn-green', 'Rejoindre');
        btn.addEventListener('click', () => PZ.socket.emit('party:join', { code: r.code }));
        node.appendChild(btn);
      } else if (r.watchable) {
        const btn = el('button', 'btn btn-soft', 'Regarder');
        btn.dataset.tip = 'Voir la partie sans y jouer';
        btn.addEventListener('click', () => PZ.socket.emit('party:watch', { code: r.code }));
        node.appendChild(btn);
      } else {
        const btn = el('button', 'btn btn-soft', r.phase === 'lobby' ? 'Plein' : 'Terminée');
        btn.disabled = true;
        node.appendChild(btn);
      }

      box.appendChild(node);
    });
  }

  /* ═══════════ LA SOIRÉE ═══════════
   *
   * On coche deux à six jeux, dans l'ordre, et le site enchaîne les
   * parties tout seul en additionnant les points. Le bandeau du haut suit
   * partout — on sait toujours où on en est du cumul, même au milieu d'un
   * Monopoly.
   */

  const SOIREE_MIN = 2;
  const SOIREE_MAX = 6;

  /** Les jeux retenus par l'organisateur, dans l'ordre des clics. */
  let picks = [];
  /** L'état de la soirée en cours, tel que le serveur le voit. */
  let soiree = null;
  PZ.soiree = () => soiree;

  function renderSoireePicker() {
    const box = $('#soiree-body');
    box.replaceChildren();

    box.appendChild(el('p', 'fine',
      'Choisis les jeux dans l’ordre où tu veux les jouer. À la fin de chaque ' +
      'partie, tout le monde bascule automatiquement dans la suivante. Dix points ' +
      'au premier, six au deuxième, quatre, trois, deux — et un point pour tous ' +
      'les autres, pour que personne ne soit hors course avant la fin.'));

    const grid = el('div', 'soiree-pick');
    GAMES.filter((g) => g.ready).forEach((g) => {
      const at = picks.indexOf(g.id);
      const node = el('button', `spick${at >= 0 ? ' on' : ''}`);
      node.type = 'button';
      node.style.setProperty('--c', g.colour);
      const icon = el('span', 'spick-icon');
      icon.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17"><use href="#${g.icon}"/></svg>`;
      node.appendChild(icon);
      node.appendChild(el('b', null, g.name));
      node.appendChild(el('i', 'spick-n', at >= 0 ? String(at + 1) : ''));
      node.addEventListener('click', () => {
        if (at >= 0) picks.splice(at, 1);
        else if (picks.length >= SOIREE_MAX) return PZ.toast(`Six manches au maximum — ça fait déjà une longue soirée.`, 'warn');
        else picks.push(g.id);
        renderSoireePicker();
      });
      grid.appendChild(node);
    });
    box.appendChild(grid);

    const foot = el('div', 'soiree-foot');
    const line = el('span', 'fine', picks.length
      ? picks.map((id) => GAME_BY_ID[id].name).join(' → ')
      : 'Rien de choisi pour l’instant.');
    foot.appendChild(line);

    const go = el('button', 'btn btn-green', picks.length
      ? `Lancer la soirée (${picks.length} manches)` : 'Lancer la soirée');
    go.disabled = picks.length < SOIREE_MIN;
    go.addEventListener('click', () => PZ.socket.emit('soiree:create', { games: picks }));
    foot.appendChild(go);
    box.appendChild(foot);
  }

  /** Le classement cumulé, en tableau. */
  function standingsTable(rows, { compact = false } = {}) {
    const table = el('div', `soiree-table${compact ? ' compact' : ''}`);
    rows.forEach((r, i) => {
      const line = el('div', `sline${PZ.me && r.id === PZ.me.id ? ' me' : ''}`);
      line.appendChild(el('span', 'sline-rank', String(i + 1)));
      const img = new Image(24, 24);
      img.src = PZ.avatarUrl(r);
      img.alt = '';
      line.appendChild(img);
      line.appendChild(el('b', 'sline-name', r.name));
      line.appendChild(el('span', 'sline-pts', `${r.points} pt${r.points > 1 ? 's' : ''}`));
      table.appendChild(line);
    });
    return table;
  }

  /** Le panneau de la soirée en cours, dans le hall. */
  function renderSoireeRunning() {
    const box = $('#soiree-body');
    box.replaceChildren();
    const s = soiree;

    const head = el('div', 'soiree-run');
    head.appendChild(el('b', null, s.over
      ? 'Soirée terminée'
      : `Manche ${s.round}/${s.rounds} — ${GAME_BY_ID[s.game] ? GAME_BY_ID[s.game].name : s.game}`));
    // La liste des manches, avec celles qui sont déjà passées : c'est ce
    // qui dit d'un coup d'œil où on en est de la soirée.
    const line = el('span', 'fine soiree-steps');
    s.games.forEach((id, i) => {
      const name = GAME_BY_ID[id] ? GAME_BY_ID[id].name : id;
      const done = i < s.step || (i === s.step && s.awaiting) || s.over;
      line.appendChild(el('i', `sstep${done ? ' done' : ''}${i === s.step && !s.over ? ' now' : ''}`, name));
    });
    head.appendChild(line);
    box.appendChild(head);

    box.appendChild(standingsTable(s.standings));

    const foot = el('div', 'soiree-foot');
    const isHost = PZ.me && s.hostId === PZ.me.id;
    if (!s.over && s.roomCode) {
      const back = el('button', 'btn btn-green', 'Retourner à la manche');
      back.addEventListener('click', () => PZ.socket.emit('party:join', { code: s.roomCode }));
      foot.appendChild(back);
    }
    if (!s.over && isHost && s.awaiting && s.nextGame) {
      const next = el('button', 'btn btn-soft',
        `Manche suivante : ${GAME_BY_ID[s.nextGame] ? GAME_BY_ID[s.nextGame].name : s.nextGame}`);
      next.addEventListener('click', () => PZ.socket.emit('soiree:next'));
      foot.appendChild(next);
    }
    const quit = el('button', 'btn btn-soft', s.over ? 'Fermer' : 'Quitter la soirée');
    quit.addEventListener('click', () => PZ.socket.emit('soiree:quit'));
    foot.appendChild(quit);
    box.appendChild(foot);
  }

  function renderSoiree() {
    if (!$('#soiree-body')) return;
    if (soiree) renderSoireeRunning();
    else renderSoireePicker();
  }

  /**
   * LE BANDEAU DE SOIRÉE.
   *
   * Posé en haut de la vue du jeu en cours, comme celui du spectateur. Il
   * rappelle la manche, le cumul, et — quand la partie est finie — donne à
   * l'organisateur le bouton qui envoie tout le monde dans la suivante.
   * Sans lui, on gagne un Uno sans jamais savoir ce que ça a changé au
   * classement de la soirée.
   */
  const ROOM_VIEWS = ['uc', 'pk', 'uno', 'bl', 'mono', 'lg', 'bt'];

  PZ.soireeBar = () => {
    document.querySelectorAll('.soiree-bar').forEach((n) => n.remove());
    if (!soiree || soiree.over || !ROOM_VIEWS.includes(PZ.view)) return;
    const view = document.querySelector(`#view-${PZ.view}`);
    if (!view) return;

    const bar = el('div', 'soiree-bar');
    bar.appendChild(el('b', null, `Soirée · manche ${soiree.round}/${soiree.rounds}`));

    const top = soiree.standings.slice(0, 3)
      .map((r, i) => `${i + 1}. ${r.name} ${r.points}`).join('   ');
    bar.appendChild(el('span', 'fine', top || 'Classement à zéro.'));

    // Le bouton n'apparaît qu'une fois la manche comptée : avant, il donnait
    // à l'organisateur de quoi sauter une manche que personne n'avait jouée.
    const isHost = PZ.me && soiree.hostId === PZ.me.id;
    if (isHost && soiree.awaiting && soiree.nextGame) {
      const next = el('button', 'btn btn-green', `Manche suivante : ${GAME_BY_ID[soiree.nextGame] ? GAME_BY_ID[soiree.nextGame].name : soiree.nextGame}`);
      next.addEventListener('click', () => PZ.socket.emit('soiree:next'));
      bar.appendChild(next);
    }
    const see = el('button', 'btn btn-soft', 'Classement');
    see.addEventListener('click', () => showStandings());
    bar.appendChild(see);

    // Après le bandeau du spectateur s'il y en a un : il dit une chose plus
    // urgente — que les boutons ne répondront pas.
    const watch = view.querySelector('.watch-bar');
    if (watch) watch.after(bar);
    else view.insertBefore(bar, view.firstChild);
  };

  /** Une fenêtre simple, reprenant celle du classement du site. */
  function openSoireeModal(title, body) {
    const box = el('div', 'lb-pop');
    const head = el('div', 'lb-pop-head');
    head.appendChild(el('h2', null, title));
    box.appendChild(head);
    box.appendChild(body);
    const foot = el('div', 'lb-pop-foot');
    const close = el('button', 'btn btn-soft btn-block', 'Fermer');
    close.addEventListener('click', () => PZ.closeModal());
    foot.appendChild(close);
    box.appendChild(foot);
    PZ.openModal(box);
  }

  /** Le classement complet, en fenêtre. */
  function showStandings() {
    if (!soiree) return;
    const body = el('div', 'soiree-modal');
    body.appendChild(standingsTable(soiree.standings));
    if (soiree.last) {
      body.appendChild(el('h4', null, `Dernière manche — ${soiree.last.gameName}`));
      const list = el('div', 'soiree-table compact');
      soiree.last.table.forEach((t) => {
        const line = el('div', 'sline');
        line.appendChild(el('span', 'sline-rank', String(t.rank)));
        line.appendChild(el('b', 'sline-name', t.name));
        line.appendChild(el('span', 'sline-pts', `+${t.gained}`));
        list.appendChild(line);
      });
      body.appendChild(list);
    }
    openSoireeModal('Classement de la soirée', body);
  }

  /** Le podium de fin de soirée. */
  function showSoireeResult(s) {
    const body = el('div', 'soiree-modal');
    const names = s.result.winnerIds
      .map((id) => (s.standings.find((r) => r.id === id) || {}).name)
      .filter(Boolean);
    body.appendChild(el('p', null, names.length
      ? `${names.join(' et ')} remporte la soirée après ${s.result.rounds} manches.`
      : 'Personne n’a marqué : match nul intégral.'));
    body.appendChild(standingsTable(s.standings));
    openSoireeModal('Soirée terminée', body);
    if (PZ.me && s.result.winnerIds.includes(PZ.me.id)) PZ.confetti?.();
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
    // Coller en bas est écrit une seule fois, dans `chat.js` : il tient
    // compte des avatars qui arrivent après coup et des salons redessinés
    // alors qu'ils ne sont pas encore visibles. On ne recolle pas si la
    // personne a remonté l'historique elle-même.
    box.replaceChildren();
    messages.forEach((m) => box.appendChild(chatNode(m)));
    PZ.chat.stick(box);
  };

  /* ═══════════ LES RÉACTIONS RAPIDES ═══════════
   *
   * Six emojis, un clic, et ça apparaît deux secondes au-dessus du siège de
   * celui qui a cliqué. Écrit une fois ici pour les cinq jeux : chacun dit
   * seulement où trouver le siège d'un joueur (`PZ.seatFinder`), et le
   * reste — la barre, l'envoi, l'animation — est commun.
   *
   * Pourquoi pas dans le chat : parce que pendant une partie on a les deux
   * mains sur ses cartes, et que personne ne tape « ahah » au moment où il
   * se prend un +4. C'est le regard qu'on lance à la table, pas une
   * conversation.
   */
  const REACTIONS = ['👍', '😂', '😱', '🤡', '🎉', '💀'];

  /** Chaque jeu déclare comment retrouver le siège d'un joueur. */
  PZ.seatFinder = {};

  /** La barre de réactions, à poser dans n'importe quel salon. */
  PZ.reactionBar = () => {
    const bar = el('div', 'react-bar');
    REACTIONS.forEach((emoji) => {
      const b = el('button', 'react-btn', emoji);
      b.type = 'button';
      b.addEventListener('click', () => PZ.socket.emit('party:react', { emoji }));
      bar.appendChild(b);
    });
    return bar;
  };

  /**
   * Fait apparaître la bulle au-dessus du siège.
   *
   * Si on ne trouve pas le siège — un spectateur, un jeu qui n'a pas
   * déclaré son repère — la bulle monte au centre de la scène plutôt que
   * de disparaître : une réaction perdue vaut moins qu'une réaction mal
   * placée.
   */
  function popReaction({ id, emoji }) {
    const finder = PZ.seatFinder[PZ.view];
    const anchor = (finder && finder(id))
      || document.querySelector(`#view-${PZ.view} .stage`)
      || document.querySelector(`#view-${PZ.view}`);
    if (!anchor) return;

    const r = anchor.getBoundingClientRect();
    const bubble = el('div', 'react-pop', emoji);
    bubble.style.left = `${r.left + r.width / 2}px`;
    bubble.style.top = `${r.top + 6}px`;
    document.body.appendChild(bubble);
    setTimeout(() => bubble.remove(), 2000);
  }

  /**
   * Le bandeau du spectateur.
   *
   * Une seule barre, posée en haut de la vue du jeu en cours. Elle dit
   * franchement qu'on regarde — sans ça on cherche pendant trente secondes
   * pourquoi aucun bouton ne répond.
   */
  PZ.watchBanner = (s) => {
    const view = document.querySelector(`#view-${PZ.view}`);
    if (!view) return;
    let bar = view.querySelector('.watch-bar');
    if (!s || !s.watching) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = el('div', 'watch-bar');
      bar.appendChild(el('span', null, 'Tu regardes cette partie sans y jouer.'));
      const out = el('button', 'btn btn-soft', 'Arrêter de regarder');
      out.addEventListener('click', () => { PZ.socket.emit('party:unwatch'); PZ.go('party'); });
      bar.appendChild(out);
      view.insertBefore(bar, view.firstChild);
    }
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
    socket.on('party:reaction', popReaction);

    /* ─── La soirée ─── */

    socket.on('soiree:state', (s) => {
      const wasOver = soiree && soiree.over;
      soiree = s && s.games ? s : null;
      if (PZ.view === 'party') renderSoiree();
      PZ.soireeBar();
      // Le podium ne s'ouvre qu'au moment où la soirée bascule sur « finie »,
      // pas à chaque état reçu ensuite : sinon la fenêtre se rouvrirait
      // toute seule à chaque rafraîchissement.
      if (soiree && soiree.over && !wasOver && soiree.result) showSoireeResult(soiree);
    });

    // Le serveur a ouvert la manche suivante : on la rejoint par le chemin
    // habituel, celui de quelqu'un qui taperait le code à la main.
    socket.on('soiree:go', ({ code, round, rounds }) => {
      PZ.toast(`Manche ${round}/${rounds} — on enchaîne.`, 'info');
      socket.emit('party:join', { code });
    });

    // Le serveur nous place dans un salon : on ouvre l'écran du jeu.
    socket.on('party:joined', ({ game }) => {
      // Chaque jeu Party a sa vue. La table de correspondance vit ici,
      // à un seul endroit : c'est ce qui évite qu'un nouveau jeu marche
      // partout sauf au moment de rejoindre un salon.
      PZ.go({ poker: 'pk', uno: 'uno', belote: 'bl', monopoly: 'mono', loup: 'lg', blindtest: 'bt', undercover: 'uc' }[game] || 'uc');
      PZ.soireeBar();
    });

    socket.on('party:left', () => {
      document.querySelectorAll('.soiree-bar').forEach((n) => n.remove());
      if (ROOM_VIEWS.includes(PZ.view)) PZ.go('party');
    });

    // Un message de salon arrive tout seul, sans état complet : on l'ajoute
    // à la suite plutôt que de redemander toute la partie au serveur.
    socket.on('party:chat', (m) => {
      const prefix = PZ.view === 'pk' ? 'pk' : PZ.view === 'uc' ? 'uc' : null;
      if (!prefix) return;
      const box = $(`#${prefix}-chat`);
      if (!box || box.querySelector(`[data-mid="${m.id}"]`)) return;
      const node = chatNode(m);
      node.dataset.mid = m.id;
      box.appendChild(node);
      while (box.children.length > 60) box.firstElementChild.remove();
      PZ.chat.stick(box);
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
      PZ.socket.emit('soiree:state');
      renderGames(rooms);
      renderRooms(rooms);
      renderSoiree();
    },
  };
})();
