'use strict';
/**
 * UNDERCOVER — L'ÉCRAN DE JEU.
 *
 * Le serveur envoie à chacun une vue différente : ton mot, et rien de ce que
 * tu ne dois pas savoir. Le navigateur ne cache donc rien — il n'a rien à
 * cacher, on ne lui a rien confié.
 */

(() => {
  const { $, $$, el } = PZ;

  let state = null;

  const PHASE = {
    lobby: 'En attente de joueurs',
    describing: 'Chacun décrit son mot',
    voting: 'Au vote !',
    reveal: 'Révélation',
    guess: 'Monsieur Blanc tente sa chance',
    over: 'Partie terminée',
  };

  /* ═══════════ Le mot ═══════════ */

  function renderWord(s) {
    const box = $('#uc-word');
    box.replaceChildren();

    if (s.phase === 'lobby') {
      box.className = 'uc-word waiting';
      box.appendChild(el('div', 'uc-word-label', 'Salon ouvert'));
      box.appendChild(el('div', 'uc-word-main', `${s.players.length} / ${s.max}`));
      box.appendChild(el('p', 'fine',
        s.players.length < s.min
          ? `Il faut au moins ${s.min} joueurs. Envoie le code à tes potes.`
          : 'Vous êtes assez nombreux. L’hôte peut lancer.'));
      return;
    }

    if (!s.you) { box.className = 'uc-word'; return; }

    if (s.you.isWhite) {
      box.className = 'uc-word white';
      box.appendChild(el('div', 'uc-word-label', 'Tu es MONSIEUR BLANC'));
      box.appendChild(el('div', 'uc-word-main', '???'));
      box.appendChild(el('p', 'fine',
        'Tu n’as aucun mot. Écoute les autres, devine de quoi ils parlent, et fais ' +
        'semblant. Si tu te fais éliminer, tu auras une dernière chance de trouver le mot.'));
      return;
    }

    box.className = 'uc-word';
    box.appendChild(el('div', 'uc-word-label', 'Ton mot'));
    box.appendChild(el('div', 'uc-word-main', s.you.word || '—'));
    box.appendChild(el('p', 'fine',
      'Décris-le sans jamais l’écrire. Trop précis, tu te fais repérer par l’infiltré ; ' +
      'trop vague, les autres te prennent pour lui.'));
  }

  /* ═══════════ Le tableau des descriptions ═══════════ */

  function renderBoard(s) {
    const box = $('#uc-board');
    box.replaceChildren();

    if (s.phase === 'lobby') {
      box.appendChild(el('p', 'fine center',
        'Chaque joueur reçoit un mot. Les infiltrés en ont un autre, très proche, ' +
        'sans savoir qu’ils sont infiltrés. À chaque manche : une description ' +
        'chacun, puis un vote.'));
      return;
    }

    if (s.phase === 'over' && s.result) return renderResult(s, box);

    // La manche en cours.
    const round = el('div', 'uc-round');
    round.appendChild(el('h3', null, `Manche ${s.round}`));

    const list = el('div', 'uc-said');
    s.order.forEach((id, i) => {
      const p = s.players.find((x) => x.id === id);
      const said = s.said.find((x) => x.id === id);
      const node = el('div', `uc-line${said ? ' done' : ''}${s.speaker === id ? ' now' : ''}`);
      node.appendChild(el('span', 'uc-n', String(i + 1)));
      node.appendChild(el('b', null, p ? p.name : '?'));
      node.appendChild(el('span', 'uc-txt', said ? said.text : (s.speaker === id ? 'écrit…' : '—')));
      list.appendChild(node);
    });
    round.appendChild(list);
    box.appendChild(round);

    // Le résultat du vote.
    if (s.reveal) {
      const r = el('div', 'uc-reveal');
      if (s.reveal.tie) {
        r.appendChild(el('b', null, 'Égalité — personne n’est éliminé.'));
      } else {
        const img = new Image(46, 46);
        img.src = PZ.avatarUrl(s.reveal);
        img.alt = '';
        r.appendChild(img);
        r.appendChild(el('b', null, s.reveal.name));
        const role = el('span', `uc-role ${s.reveal.role}`,
          s.reveal.role === 'spy' ? 'INFILTRÉ' : s.reveal.role === 'white' ? 'MONSIEUR BLANC' : 'civil');
        r.appendChild(role);
        if (s.reveal.word) r.appendChild(el('span', 'fine', `son mot : « ${s.reveal.word} »`));
      }
      box.appendChild(r);
    }

    // L'historique des manches précédentes.
    if (s.history.length > 1) {
      const past = el('details', 'uc-history');
      past.appendChild(el('summary', null, `Manches précédentes (${s.history.length - 1})`));
      s.history.slice(0, -1).forEach((h) => {
        const block = el('div', 'uc-past');
        block.appendChild(el('h4', null, `Manche ${h.round}`));
        h.entries.forEach((e) => {
          const line = el('div', 'uc-past-line');
          line.appendChild(el('b', null, e.name));
          line.appendChild(el('span', null, e.text || '—'));
          block.appendChild(line);
        });
        past.appendChild(block);
      });
      box.appendChild(past);
    }
  }

  function renderResult(s, box) {
    const r = s.result;
    const wrap = el('div', 'uc-result');

    const banner = el('div', `uc-banner ${r.winner}`);
    banner.textContent = r.winner === 'civils' ? '🎉 Les civils gagnent !'
      : r.winner === 'white' ? '🃏 Monsieur Blanc gagne seul !'
        : '🕵️ Les infiltrés gagnent !';
    wrap.appendChild(banner);

    const wordsRow = el('div', 'uc-words');
    const civil = el('div', 'uc-wordcard civil');
    civil.appendChild(el('span', null, 'Mot des civils'));
    civil.appendChild(el('b', null, r.word));
    const spy = el('div', 'uc-wordcard spy');
    spy.appendChild(el('span', null, 'Mot des infiltrés'));
    spy.appendChild(el('b', null, r.spyWord));
    wordsRow.appendChild(civil);
    wordsRow.appendChild(spy);
    wrap.appendChild(wordsRow);

    const roles = el('div', 'uc-roles');
    ['spy', 'white', 'civil'].forEach((role) => {
      r.roles.filter((p) => p.role === role).forEach((p) => {
        const node = el('div', `uc-rolecard ${role}`);
        const img = new Image(34, 34);
        img.src = PZ.avatarUrl(p);
        img.alt = '';
        node.appendChild(img);
        node.appendChild(el('b', null, p.name));
        node.appendChild(el('span', null,
          role === 'spy' ? 'Infiltré' : role === 'white' ? 'Monsieur Blanc' : 'Civil'));
        roles.appendChild(node);
      });
    });
    wrap.appendChild(roles);
    box.appendChild(wrap);
  }

  /* ═══════════ La zone d'action ═══════════ */

  function renderAction(s) {
    const box = $('#uc-action');
    box.replaceChildren();

    const me = s.you;
    if (!me) return;

    if (s.phase === 'describing') {
      if (s.speaker === me.id) {
        const form = el('form', 'uc-form');
        const input = el('input', 'input big');
        input.id = 'uc-input';
        input.maxLength = 90;
        input.placeholder = 'Un mot ou une phrase courte…';
        input.autocomplete = 'off';
        form.appendChild(input);
        form.appendChild(el('button', 'btn btn-green', 'Envoyer'));
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          PZ.socket.emit('uc:describe', { text });
          input.value = '';
        });
        box.appendChild(form);
        box.appendChild(el('p', 'fine center', 'C’est à toi. Interdit d’écrire le mot lui-même.'));
        setTimeout(() => input.focus(), 30);
      } else {
        const speaker = s.players.find((p) => p.id === s.speaker);
        box.appendChild(el('p', 'uc-wait', speaker ? `${speaker.name} réfléchit…` : 'En attente…'));
      }
      return;
    }

    if (s.phase === 'voting') {
      if (me.out) {
        box.appendChild(el('p', 'uc-wait', 'Tu es éliminé : tu regardes voter les autres.'));
        return;
      }
      box.appendChild(el('p', 'uc-wait', me.voted
        ? 'Ton vote est enregistré. On attend les autres.'
        : 'Clique sur le nom de qui tu veux éliminer, dans la liste à gauche.'));
      const voted = s.votes.length;
      const total = s.players.filter((p) => !p.out && p.connected).length;
      box.appendChild(el('p', 'fine center', `${voted} / ${total} ont voté`));
      return;
    }

    if (s.phase === 'guess') {
      if (s.guessBy === me.id) {
        const form = el('form', 'uc-form');
        const input = el('input', 'input big');
        input.maxLength = 40;
        input.placeholder = 'Le mot des civils, c’était…';
        form.appendChild(input);
        form.appendChild(el('button', 'btn btn-gold', 'Deviner'));
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          PZ.socket.emit('uc:guess', { text: input.value.trim() });
        });
        box.appendChild(form);
        box.appendChild(el('p', 'fine center', 'Trouve le mot et tu gagnes la partie à toi tout seul.'));
        setTimeout(() => input.focus(), 30);
      } else {
        box.appendChild(el('p', 'uc-wait', 'Monsieur Blanc tente de deviner le mot…'));
      }
      return;
    }

    if (s.phase === 'over') {
      box.appendChild(el('p', 'fine center',
        PZ.me && s.hostId === PZ.me.id
          ? 'Tu peux relancer une partie avec les mêmes joueurs.'
          : 'L’hôte peut relancer une partie.'));
    }
  }

  /* ═══════════ Les joueurs ═══════════ */

  function renderPlayers(s) {
    PZ.roomPlayers($('#uc-players'), s.players, {
      extra: (p) => {
        // Pendant le vote, chaque joueur encore en lice devient un bouton.
        if (s.phase === 'voting' && s.you && !s.you.out && !p.out && p.id !== s.you.id) {
          const btn = el('button', `vote-btn${s.you.voted === p.id ? ' on' : ''}`,
            s.you.voted === p.id ? '✓ voté' : 'voter');
          btn.addEventListener('click', () => PZ.socket.emit('uc:vote', { id: p.id }));
          return btn;
        }
        if (s.phase === 'voting' && s.votes.includes(p.id)) return el('span', 'vote-done', '✓');
        if (s.speaker === p.id) return el('span', 'vote-done now', '💬');
        return null;
      },
    });

    // Les réglages ne s'affichent que pour l'hôte, et seulement avant le début.
    const settings = $('#uc-settings');
    const isHost = PZ.me && s.hostId === PZ.me.id;
    settings.classList.toggle('hidden', !isHost || s.phase !== 'lobby');
    $$('#uc-level .seg').forEach((b) => b.classList.toggle('active', b.dataset.level === s.level));
    $('#uc-white').checked = s.mrWhite;
  }

  /* ═══════════ Rendu complet ═══════════ */

  function render(s) {
    state = s;
    PZ.roomChrome('uc', s, {
      canStart: s.players.filter((p) => p.connected).length >= s.min,
    });
    $('#uc-phase').textContent = PHASE[s.phase] || s.phase;
    $('#uc-phase').className = `room-phase ${s.phase}`;

    const total = s.phase === 'describing' ? 60000 : s.phase === 'voting' ? 45000 : null;
    PZ.roomTimer('uc', ['describing', 'voting', 'guess'].includes(s.phase) ? s.deadline : 0, s.serverNow, total);

    renderPlayers(s);
    renderWord(s);
    renderBoard(s);
    renderAction(s);
    PZ.roomChat($('#uc-chat'), s.chat);
  }

  /* ═══════════ Branchement ═══════════ */

  $('#uc-level').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    PZ.socket.emit('uc:configure', { level: btn.dataset.level });
  });
  $('#uc-white').addEventListener('change', (e) => {
    PZ.socket.emit('uc:configure', { mrWhite: e.target.checked });
  });

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__ucBound) return;
    socket.__ucBound = true;

    socket.on('uc:state', (s) => {
      const before = state;
      render(s);

      // Petits effets, seulement sur les vrais changements de phase.
      if (before && before.phase !== s.phase) {
        if (s.phase === 'voting') SFX.tick();
        if (s.phase === 'over') {
          const mine = s.you && s.result && (
            (s.result.winner === 'civils' && s.you.role === 'civil') ||
            (s.result.winner === 'spies' && s.you.role === 'spy') ||
            (s.result.winner === 'white' && s.you.role === 'white')
          );
          if (mine) { SFX.fanfare(); PZ.confetti(140); } else SFX.lose();
        }
      }
    });
  }

  PZ.views.uc = {
    enter() {
      bind();
      PZ.socket.emit('party:open');
    },
    leave() { PZ.stopRoomTimer('uc'); },
  };
})();
