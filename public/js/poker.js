'use strict';
/**
 * POKER — L'ÉCRAN DE JEU.
 *
 * Le serveur n'envoie à chacun que ses propres cartes ; celles des autres
 * arrivent sous forme de `null` et deviennent des dos de cartes. À l'abattage
 * seulement, tout le monde reçoit tout.
 *
 * On mise des JETONS DE TOURNOI, pas les pièces du casino : rien de ce qui
 * se passe ici ne touche au solde.
 */

(() => {
  const { $, el, fmt } = PZ;

  let state = null;

  const STREET = {
    preflop: 'Préflop', flop: 'Le flop', turn: 'Le tournant', river: 'La rivière',
  };

  /* ═══════════ Les cartes ═══════════ */

  /** Une carte, à partir de son étiquette serveur (« A♠ ») ou d'un dos. */
  function card(label, { small = false, dim = false } = {}) {
    const node = el('div', `pcard${small ? ' small' : ''}${dim ? ' dim' : ''}`);
    if (!label) {
      node.classList.add('back');
      return node;
    }
    const rank = label.slice(0, -1).replace('T', '10');
    const suit = label.slice(-1);
    const red = suit === '♥' || suit === '♦';
    if (red) node.classList.add('red');
    node.appendChild(el('span', 'pc-r', rank));
    node.appendChild(el('span', 'pc-s', suit));
    return node;
  }

  /* ═══════════ Le tableau ═══════════ */

  function renderBoard(s) {
    const box = $('#pk-board');
    box.replaceChildren();

    const best = new Set(
      s.showdown && s.showdown.hands && s.you
        ? (s.showdown.hands.find((h) => h.id === s.you.id) || {}).best || []
        : []
    );

    for (let i = 0; i < 5; i++) {
      const label = s.board[i];
      if (!label) {
        const slot = el('div', 'pcard slot');
        box.appendChild(slot);
      } else {
        box.appendChild(card(label, { dim: best.size > 0 && !best.has(label) }));
      }
    }

    const pot = $('#pk-pot');
    pot.replaceChildren();
    pot.appendChild(el('span', null, 'POT'));
    pot.appendChild(el('b', null, fmt(s.pot)));
    if (s.street) pot.appendChild(el('i', null, STREET[s.street]));
  }

  /* ═══════════ Les sièges ═══════════ */

  function renderSeats(s) {
    const box = $('#pk-seats');
    box.replaceChildren();

    s.seats.forEach((seat) => {
      const node = el('div', [
        'pseat',
        seat.busted ? 'busted' : '',
        seat.folded ? 'folded' : '',
        seat.allIn ? 'allin' : '',
        s.toAct === seat.id ? 'turn' : '',
        s.you && seat.id === s.you.id ? 'you' : '',
        seat.connected ? '' : 'away',
      ].filter(Boolean).join(' '));

      const head = el('div', 'pseat-head');
      const img = new Image(28, 28);
      img.src = PZ.avatarUrl(seat);
      img.alt = '';
      head.appendChild(img);
      const name = el('b', null, seat.name);
      head.appendChild(name);
      if (PZ.applyCosmetics) PZ.applyCosmetics(node, seat.cosmetics, { avatar: img, name });
      if (seat.button) head.appendChild(el('span', 'pseat-btn', 'D'));
      node.appendChild(head);

      const cards = el('div', 'pseat-cards');
      if (seat.busted) cards.appendChild(el('span', 'pseat-outlabel', 'éliminé'));
      else (seat.cards.length ? seat.cards : [null, null]).forEach((c) => cards.appendChild(card(c, { small: true })));
      node.appendChild(cards);

      node.appendChild(el('div', 'pseat-chips', `${fmt(seat.chips)} 🟡`));

      if (seat.bet > 0) node.appendChild(el('div', 'pseat-bet', fmt(seat.bet)));
      if (seat.lastMove) node.appendChild(el('div', 'pseat-move', seat.lastMove));
      if (!seat.connected && !seat.busted) node.appendChild(el('div', 'pseat-move away', 'absent'));

      box.appendChild(node);
    });
  }

  /* ═══════════ Les tapis, à gauche ═══════════ */

  function renderStacks(s) {
    const box = $('#pk-stacks');
    box.replaceChildren();

    const sorted = [...s.seats].sort((a, b) => b.chips - a.chips);
    const total = sorted.reduce((sum, p) => sum + p.chips, 0) || 1;

    sorted.forEach((p) => {
      const node = el('div', `stackrow${p.busted ? ' out' : ''}`);
      const img = new Image(24, 24);
      img.src = PZ.avatarUrl(p);
      img.alt = '';
      node.appendChild(img);

      const who = el('div', 'stackrow-who');
      who.appendChild(el('b', null, p.name));
      const bar = el('div', 'stackbar');
      const fill = el('span');
      fill.style.width = `${(p.chips / total) * 100}%`;
      bar.appendChild(fill);
      who.appendChild(bar);
      node.appendChild(who);

      node.appendChild(el('span', 'stackrow-v', fmt(p.chips)));
      box.appendChild(node);
    });

    const blinds = $('#pk-blinds');
    blinds.replaceChildren();
    if (s.blinds) {
      blinds.appendChild(el('span', null, `Blindes ${fmt(s.blinds.small)} / ${fmt(s.blinds.big)}`));
      blinds.appendChild(el('b', null, `palier ${s.blinds.level}/${s.blinds.levels}`));
      blinds.appendChild(el('span', 'fine', `Main n° ${s.hand} · elles montent toutes les 8 mains.`));
    }
  }

  /* ═══════════ Ta main et tes boutons ═══════════ */

  function renderYou(s) {
    const box = $('#pk-you');
    box.replaceChildren();
    if (!s.you || s.phase === 'lobby') return;

    const me = s.seats.find((x) => x.id === s.you.id);
    if (!me) return;

    const hand = el('div', 'pk-hand');
    (me.cards.length ? me.cards : [null, null]).forEach((c) => hand.appendChild(card(c)));
    box.appendChild(hand);

    const info = el('div', 'pk-hand-info');
    info.appendChild(el('b', null, `${fmt(s.you.chips)} jetons`));
    if (s.you.toCall > 0) info.appendChild(el('span', null, `à suivre : ${fmt(s.you.toCall)}`));
    else if (!s.you.folded && !s.you.busted) info.appendChild(el('span', null, 'rien à suivre'));
    if (s.you.folded) info.appendChild(el('span', 'bad', 'couché'));
    if (s.you.allIn) info.appendChild(el('span', 'good', 'à tapis'));
    box.appendChild(info);

    // À l'abattage, on montre ce que chacun avait.
    if (s.showdown && s.showdown.hands) {
      const table = el('div', 'pk-showdown');
      s.showdown.hands.forEach((h) => {
        const row = el('div', `sd-row${h.won ? ' win' : ''}`);
        row.appendChild(el('b', null, h.name));
        const cards = el('div', 'sd-cards');
        h.cards.forEach((c) => cards.appendChild(card(c, { small: true, dim: !h.best.includes(c) })));
        row.appendChild(cards);
        row.appendChild(el('span', 'sd-detail', h.detail));
        row.appendChild(el('span', 'sd-won', h.won ? `+${fmt(h.won)}` : '—'));
        table.appendChild(row);
      });
      box.appendChild(table);

      if (s.showdown.pots && s.showdown.pots.length > 1) {
        const pots = el('div', 'pk-pots');
        s.showdown.pots.forEach((p) => {
          pots.appendChild(el('div', 'fine',
            `${p.label} : ${fmt(p.amount)} → ${p.winners.map((w) => w.name).join(', ')}`));
        });
        box.appendChild(pots);
      }
    }

    if (s.result) {
      const end = el('div', 'pk-result');
      end.appendChild(el('b', null, `🏆 ${s.result.winner} remporte le tournoi`));
      end.appendChild(el('span', 'fine', `en ${s.result.hands} mains`));
      box.appendChild(end);
    }
  }

  function renderActions(s) {
    const box = $('#pk-actions');
    box.replaceChildren();

    if (!s.you || !s.you.turn || s.phase !== 'playing') {
      if (s.phase === 'playing' && s.toAct) {
        const who = s.seats.find((x) => x.id === s.toAct);
        box.appendChild(el('p', 'pk-wait', who ? `Au tour de ${who.name}…` : ''));
      }
      return;
    }

    const send = (move, amount) => PZ.socket.emit('pk:act', { move, amount });

    const row = el('div', 'pk-btns');

    const fold = el('button', 'btn btn-soft', 'Se coucher');
    fold.addEventListener('click', () => { SFX.chip(); send('fold'); });
    row.appendChild(fold);

    if (s.you.canCheck) {
      const check = el('button', 'btn btn-soft', 'Parole');
      check.addEventListener('click', () => { SFX.chip(); send('check'); });
      row.appendChild(check);
    } else {
      const call = el('button', 'btn btn-green', `Suivre ${fmt(Math.min(s.you.toCall, s.you.chips))}`);
      call.addEventListener('click', () => { SFX.chip(); send('call'); });
      row.appendChild(call);
    }

    // La relance : un curseur, parce que taper un montant au clavier pendant
    // qu'un chrono tourne est le meilleur moyen de miser 5000 au lieu de 500.
    const canRaise = s.you.maxRaiseTo > s.you.bet && s.you.chips > 0;
    if (canRaise) {
      const min = Math.min(s.you.minRaiseTo, s.you.maxRaiseTo);
      const max = s.you.maxRaiseTo;

      const raise = el('div', 'pk-raise');
      const slider = el('input', 'pk-slider');
      slider.type = 'range';
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String(Math.max(1, Math.round(s.blinds.small / 2)));
      slider.value = String(min);

      const label = el('b', 'pk-raise-v', fmt(min));
      const btn = el('button', 'btn btn-gold', min >= max ? 'Tapis' : 'Relancer');

      slider.addEventListener('input', () => {
        label.textContent = fmt(Number(slider.value));
        btn.textContent = Number(slider.value) >= max ? 'Tapis' : 'Relancer';
      });
      btn.addEventListener('click', () => { SFX.chip(); send('raise', Number(slider.value)); });

      const shortcuts = el('div', 'pk-shortcuts');
      [['½ pot', 0.5], ['pot', 1], ['tapis', null]].forEach(([text, ratio]) => {
        const s2 = el('button', 'btn-mini', text);
        s2.addEventListener('click', () => {
          const target = ratio === null ? max
            : Math.min(max, Math.max(min, Math.round(s.pot * ratio) + s.currentBet));
          slider.value = String(target);
          slider.dispatchEvent(new Event('input'));
        });
        shortcuts.appendChild(s2);
      });

      const head = el('div', 'pk-raise-head');
      head.appendChild(el('span', null, 'Relancer à'));
      head.appendChild(label);
      raise.appendChild(head);
      raise.appendChild(slider);
      raise.appendChild(shortcuts);
      raise.appendChild(btn);

      box.appendChild(row);
      box.appendChild(raise);
      return;
    }

    box.appendChild(row);
  }

  /* ═══════════ Rendu complet ═══════════ */

  function render(s) {
    const before = state;
    state = s;

    PZ.roomChrome('pk', s, {
      startLabel: 'Lancer le tournoi',
      canStart: s.players.filter((p) => p.connected).length >= s.min,
    });

    $('#pk-phase').textContent = s.phase === 'lobby'
      ? `${s.players.length} / ${s.max} joueurs`
      : s.phase === 'over' ? 'Tournoi terminé'
        : s.phase === 'showdown' ? 'Abattage'
          : `Main ${s.hand} · ${STREET[s.street] || ''}`;
    $('#pk-phase').className = `room-phase ${s.phase}`;

    PZ.roomTimer('pk', s.phase === 'playing' && s.toAct ? s.deadline : 0, s.serverNow, 30000);

    // Le poker n'utilise pas la liste de joueurs standard : les tapis, à
    // gauche, disent déjà qui est là et avec combien.
    renderStacks(s);
    renderBoard(s);
    renderSeats(s);
    renderYou(s);
    renderActions(s);
    PZ.roomChat($('#pk-chat'), s.chat);

    // Un petit son quand c'est à toi, et un seul.
    if (s.you && s.you.turn && (!before || !before.you || !before.you.turn)) SFX.tick();
    if (s.result && (!before || !before.result)) {
      if (PZ.me && s.result.winnerId === PZ.me.id) { SFX.fanfare(); PZ.confetti(150); }
      else SFX.lose();
    }
  }

  /* ═══════════ Branchement ═══════════ */

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__pkBound) return;
    socket.__pkBound = true;
    socket.on('pk:state', render);
  }

  PZ.views.pk = {
    enter() {
      bind();
      PZ.socket.emit('party:open');
    },
    leave() { PZ.stopRoomTimer('pk'); },
  };
})();
