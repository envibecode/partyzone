'use strict';
/**
 * BLACKJACK.
 *
 * Le serveur est seul maître : il distribue, mène les tours et règle les
 * mises. Le client affiche l'état reçu et ne propose que les coups que le
 * serveur a déclarés légaux.
 *
 * La table tourne en continu dès son ouverture — on n'attend personne. Il
 * n'y a pas de bots : on joue seul contre le croupier, ou avec les gens qui
 * rejoignent avec le code.
 */

(() => {
  const { $, $$, fmt, el } = PZ;

  let state = null;
  let lastPhase = null;
  let timerRaf = null;

  const MOVE_LABEL = {
    hit: 'Tirer',
    stand: 'Rester',
    double: 'Doubler',
    split: 'Séparer',
  };

  const PHASE_TEXT = {
    waiting: 'Prochain tour…',
    betting: 'Placez vos mises',
    dealing: 'Distribution…',
    playing: 'À vous de jouer',
    dealer: 'Le croupier joue',
    payout: 'Règlement',
  };

  /* ─── Lobby ─── */

  $('#bj-create').addEventListener('click', () => PZ.socket.emit('bj:create'));

  $('#bj-join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#bj-code').value.trim().toUpperCase();
    if (code.length !== 4) return PZ.toast('Le code fait 4 lettres.', 'error');
    PZ.socket.emit('bj:join', { code });
  });

  $('#bj-leave').addEventListener('click', () => {
    PZ.socket.emit('bj:leave');
    showLobby();
  });

  $('#bj-copy').addEventListener('click', async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.code);
      PZ.toast('Code copié. Envoie-le à tes potes.', 'success');
    } catch {
      PZ.toast(`Le code est : ${state.code}`, 'info');
    }
  });

  /* ─── Mise, paris annexes, auto, remise ─── */

  function sideValues() {
    return {
      pairs: Math.max(0, Math.floor(Number($('#sb-pairs').value) || 0)),
      trio: Math.max(0, Math.floor(Number($('#sb-trio').value) || 0)),
    };
  }

  function placeBet(amount) {
    SFX.chip();
    PZ.socket.emit('bj:bet', { amount, side: sideValues() });
  }

  $('#bj-place').addEventListener('click', () => {
    placeBet(Math.floor(Number($('#bj-bet').value) || 0));
  });

  $('#bj-rebet').addEventListener('click', () => {
    if (!state || !state.you || !state.you.lastBet) {
      return PZ.toast('Aucune mise précédente à reposer.', 'warn');
    }
    const last = state.you.lastSide || { pairs: 0, trio: 0 };
    $('#bj-bet').value = state.you.lastBet;
    $('#sb-pairs').value = last.pairs || 0;
    $('#sb-trio').value = last.trio || 0;
    placeBet(state.you.lastBet);
  });

  $('#bj-auto').addEventListener('click', () => {
    const on = !(state && state.you && state.you.auto);
    PZ.socket.emit('bj:auto', { on });
  });

  $('#sb-info').addEventListener('click', () => {
    if (!state || !state.sidebets) return;
    const sb = state.sidebets;
    const box = el('div');
    box.appendChild(el('h2', null, 'Les paris annexes'));
    box.appendChild(el('p', 'fine',
      'Ils se règlent dès la donne, avant que tu joues ta main. Ils rendent moins ' +
      'que la table principale — c’est vrai dans tous les casinos, et voilà les chiffres exacts.'));

    const mk = (title, rows, rtp) => {
      const wrap = el('div', 'sb-table');
      const h = el('h3', null, title);
      h.appendChild(el('span', 'sb-rtp', ` redistribution ${String(rtp).replace('.', ',')} %`));
      wrap.appendChild(h);
      rows.forEach((r) => {
        const line = el('div', 'sb-line');
        line.appendChild(el('span', null, r.name));
        line.appendChild(el('b', null, `${r.payout} contre 1`));
        wrap.appendChild(line);
      });
      return wrap;
    };
    box.appendChild(mk('Paire', sb.pairs, sb.rtp.pairs));
    box.appendChild(mk('21+3', sb.trio, sb.rtp.trio));

    const close = el('button', 'btn btn-soft modal-close', 'Fermer');
    close.addEventListener('click', PZ.closeModal);
    box.appendChild(close);
    PZ.openModal(box);
  });

  $('#bj-actions').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-move]');
    if (!btn) return;
    SFX.click();
    PZ.socket.emit('bj:move', { move: btn.dataset.move });
  });

  function showLobby() {
    state = null;
    lastPhase = null;
    shown.clear();
    $('#bj-lobby').classList.remove('hidden');
    $('#bj-room').classList.add('hidden');
    if (PZ.socket) PZ.socket.emit('bj:lobby');
  }

  /* ─── La liste des tables ouvertes ─── */

  function renderOpen(tables) {
    const grid = $('#bj-open-grid');
    grid.replaceChildren();

    if (!tables.length) {
      grid.appendChild(el('div', 'empty',
        'Aucune table ouverte. Ouvre la tienne — elle démarre tout de suite, même seul.'));
      return;
    }

    tables.forEach((t) => {
      const card = el('button', 'bj-open-card');
      if (t.seats >= t.seatsMax) card.classList.add('full');

      const head = el('div', 'boc-head');
      head.appendChild(el('b', null, t.code));
      head.appendChild(el('span', `boc-phase ${t.phase}`, PHASE_TEXT[t.phase] || t.phase));
      card.appendChild(head);

      const faces = el('div', 'room-faces');
      t.faces.forEach((f) => {
        const img = new Image(24, 24);
        img.src = PZ.avatarUrl(f);
        img.alt = '';
        img.title = f.name;
        faces.appendChild(img);
      });
      if (t.more) faces.appendChild(el('span', 'more', `+${t.more}`));
      if (!t.faces.length) faces.appendChild(el('span', 'fine', 'table vide'));
      card.appendChild(faces);

      const foot = el('div', 'boc-foot');
      foot.appendChild(el('span', null, `${t.seats}/${t.seatsMax} places`));
      foot.appendChild(el('span', null, `main n° ${t.hand || 0}`));
      card.appendChild(foot);

      if (t.seats >= t.seatsMax) {
        card.disabled = true;
        card.appendChild(el('div', 'boc-full', 'Complète'));
      } else {
        card.addEventListener('click', () => PZ.socket.emit('bj:join', { code: t.code }));
      }

      grid.appendChild(card);
    });
  }

  function showRoom() {
    $('#bj-lobby').classList.add('hidden');
    $('#bj-room').classList.remove('hidden');
  }

  /* ─── Cartes ─── */

  /**
   * Le serveur renvoie l'état complet à chaque changement, et on redessine
   * tout. Si on animait chaque carte à chaque redessin, la table clignoterait
   * en permanence. On retient donc combien de cartes chaque main avait au
   * tour précédent : seules celles qui viennent d'arriver sont animées.
   */
  const shown = new Map();

  function cardNode(card, fresh) {
    const node = el('div', card && !card.hidden && (card.s === '♥' || card.s === '♦') ? 'card red' : 'card');
    if (!card || card.hidden) {
      node.className = 'card back';
    } else {
      node.appendChild(el('span', 'r', card.r));
      node.appendChild(el('span', 's', card.s));
    }
    if (fresh) node.classList.add('fresh');
    return node;
  }

  /** Dessine une main et n'anime que les cartes nouvellement distribuées. */
  function fillCards(box, cards, key, fan = false) {
    const before = shown.get(key) || 0;
    cards.forEach((c, i) => box.appendChild(cardNode(c, i >= before)));
    shown.set(key, cards.length);

    // Dans un siège la place est comptée : à partir de la troisième carte
    // on les fait se chevaucher, comme une main qu'on tient en éventail,
    // au lieu de laisser la main déborder sur le voisin.
    if (fan) {
      const overlap = cards.length <= 2 ? 0 : Math.min(26, (cards.length - 2) * 8 + 10);
      box.style.setProperty('--ov', `${overlap}px`);
    }
  }

  function handValueText(hand) {
    if (hand.blackjack) return 'BLACKJACK';
    const v = hand.value;
    if (v.total > 21) return `${v.total} — sauté`;
    return v.soft ? `${v.total} (souple)` : String(v.total);
  }

  /* ─── Rendu ─── */

  function render(s) {
    const fresh = !state || state.code !== s.code;
    state = s;
    showRoom();

    $('#bj-table-code').textContent = s.code;
    $('#bj-phase').textContent = PHASE_TEXT[s.phase] || s.phase;
    $('#bj-hash').textContent = s.shoeSeedHash;
    $('#bj-bet').min = s.minBet;
    $('#bj-bet').max = s.maxBet;

    // Les paris annexes : grille et redistribution réelle.
    if (s.sidebets) {
      $('#sb-rtp-pairs').textContent = `${String(s.sidebets.rtp.pairs).replace('.', ',')} %`;
      $('#sb-rtp-trio').textContent = `${String(s.sidebets.rtp.trio).replace('.', ',')} %`;
    }

    const auto = Boolean(s.you && s.you.auto);
    $('#bj-auto').textContent = `Auto : ${auto ? 'on' : 'off'}`;
    $('#bj-auto').classList.toggle('on', auto);
    $('#bj-rebet').disabled = !(s.you && s.you.lastBet);

    // Croupier
    const dealerCards = $('#bj-dealer-cards');
    dealerCards.replaceChildren();
    fillCards(dealerCards, s.dealer.cards, 'dealer');
    $('#bj-dealer-val').textContent = s.dealer.value ? (s.dealer.value.total > 21 ? `${s.dealer.value.total} — sauté` : s.dealer.value.total) : '';

    // Sièges
    const seats = $('#bj-seats');
    seats.replaceChildren();
    s.seats.forEach((seat) => {
      const node = el('div', `seat${seat.active ? ' active' : ''}${seat.isYou ? ' you' : ''}`);

      const who = el('div', 'seat-who');
      const img = new Image(24, 24);
      img.src = PZ.avatarUrl(seat);
      img.alt = '';
      who.appendChild(img);
      const nameNode = el('span', null, seat.name);
      who.appendChild(nameNode);
      if (PZ.applyCosmetics) PZ.applyCosmetics(node, seat.cosmetics, { avatar: img, name: nameNode });
      node.appendChild(who);

      const group = el('div', 'hand-group');
      if (!seat.hands.length) {
        group.appendChild(el('div', 'cards'));
      } else {
        seat.hands.forEach((hand, i) => {
          const holder = el('div', `hand${seat.hands.length > 1 && i !== seat.activeHand && seat.active ? ' dim' : ''}`);
          const cards = el('div', 'cards');
          fillCards(cards, hand.cards, `${seat.id}:${i}`, true);
          holder.appendChild(cards);
          holder.appendChild(el('div', 'seat-val', handValueText(hand)));
          group.appendChild(holder);
        });
      }
      node.appendChild(group);

      // Après le règlement le serveur remet la mise à zéro : on réaffiche
      // alors ce qui vient d'être joué, sinon la ligne dirait « — ».
      const staked = seat.bet || (seat.lastResult ? seat.lastResult.staked : 0);
      const bet = el('div', 'seat-bet');
      bet.appendChild(document.createTextNode('Mise '));
      bet.appendChild(el('b', null, staked ? `${fmt(staked)} 🪙` : '—'));
      node.appendChild(bet);

      // Les paris annexes du siège, et ce qu'ils ont donné.
      const side = seat.side || (seat.sideResult ? {
        pairs: seat.sideResult.pairs ? seat.sideResult.pairs.staked : 0,
        trio: seat.sideResult.trio ? seat.sideResult.trio.staked : 0,
      } : null);
      if (side && (side.pairs || side.trio)) {
        const tags = el('div', 'seat-sides');
        const add = (label, stake, res) => {
          if (!stake) return;
          const won = res && res.payout > 0;
          const tag = el('span', `sb-tag${won ? ' won' : res ? ' lost' : ''}`,
            won ? `${label} +${fmt(res.payout)}` : `${label} ${fmt(stake)}`);
          if (won) tag.dataset.tip = res.name;
          tags.appendChild(tag);
        };
        add('P', side.pairs, seat.sideResult && seat.sideResult.pairs);
        add('21+3', side.trio, seat.sideResult && seat.sideResult.trio);
        node.appendChild(tags);
      }

      if (seat.lastResult && (s.phase === 'payout' || s.phase === 'betting')) {
        const r = seat.lastResult;
        const kind = r.payout > r.staked ? 'win' : r.payout === r.staked ? 'push' : 'lose';
        const label = kind === 'win' ? `+${fmt(r.payout - r.staked)}` : kind === 'push' ? 'Égalité' : `−${fmt(r.staked - r.payout)}`;
        node.appendChild(el('div', `seat-res ${kind}`, label));
      }

      seats.appendChild(node);
    });

    // Coups possibles
    const actions = $('#bj-actions');
    actions.replaceChildren();
    const moves = (s.you && s.you.moves) || [];
    moves.forEach((m) => {
      const btn = el('button', 'btn btn-soft', MOVE_LABEL[m] || m);
      if (m === 'hit') btn.className = 'btn btn-green';
      btn.dataset.move = m;
      actions.appendChild(btn);
    });

    // Barre de mise
    const canBet = s.phase === 'betting' || s.phase === 'waiting';
    $('#bj-betrow').classList.toggle('hidden', !canBet);
    $('#bj-place').textContent = s.you && s.you.bet ? `Misé : ${fmt(s.you.bet)} 🪙 — changer` : 'Miser';

    // Journal
    const log = $('#bj-log');
    log.replaceChildren();
    s.log.forEach((entry) => {
      const li = el('li');
      li.appendChild(el('b', null, `${entry.name} `));
      li.appendChild(document.createTextNode(entry.text));
      log.appendChild(li);
    });

    // Sons de transition
    if (lastPhase !== s.phase) {
      if (s.phase === 'betting' || s.phase === 'waiting') shown.clear();
      if (s.phase === 'dealing') SFX.card();
      if (s.phase === 'payout') announce(s);
    }
    lastPhase = s.phase;

    if (fresh) $('#bj-code').value = '';
    startTimer();
  }

  function announce(s) {
    const you = s.seats.find((x) => x.isYou);
    if (!you || !you.lastResult) return;
    const r = you.lastResult;
    if (r.payout > r.staked) {
      SFX.win(Math.min(1, (r.payout - r.staked) / Math.max(1, r.staked * 2)));
      if (r.payout >= r.staked * 2.4) PZ.confetti(80);
    } else if (r.payout === r.staked) SFX.push();
    else SFX.lose();
  }

  function startTimer() {
    if (timerRaf) cancelAnimationFrame(timerRaf);
    const s = state;
    if (!s || !s.deadline) return;
    const offset = Date.now() - s.serverNow;
    const step = () => {
      if (state !== s) return;
      const left = Math.max(0, s.deadline - (Date.now() - offset));
      const secs = Math.ceil(left / 1000);
      $('#bj-phase').textContent = `${PHASE_TEXT[s.phase] || s.phase}${secs > 0 ? ` · ${secs} s` : ''}`;
      if (left > 0) timerRaf = requestAnimationFrame(step);
    };
    step();
  }

  /* ─── Branchement ─── */

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__bjBound) return;
    socket.__bjBound = true;

    socket.on('bj:joined', () => showRoom());
    socket.on('bj:state', render);
    socket.on('bj:lobby', ({ tables }) => renderOpen(tables || []));
    socket.on('bj:closed', () => {
      showLobby();
      PZ.toast('La table a été fermée.', 'warn');
    });
  }

  PZ.chat.mount({
    log: $('#bj-chat-log'),
    form: $('#bj-chat-form'),
    input: $('#bj-chat-input'),
  });

  PZ.views.blackjack = {
    enter() {
      bind();
      if (!state) PZ.socket.emit('bj:lobby');
    },
    leave() {
      if (timerRaf) cancelAnimationFrame(timerRaf);
      timerRaf = null;
    },
  };
})();
