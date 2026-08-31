'use strict';
/**
 * BLACKJACK.
 *
 * Le serveur est seul maître : il distribue, gère les tours, décide pour
 * les bots et règle les mises. Le client affiche l'état reçu et propose
 * uniquement les coups que le serveur a déclarés légaux.
 */

(() => {
  const { $, fmt, el } = PZ;

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
    waiting: 'En attente de joueurs',
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

  $('#bj-add-bot').addEventListener('click', () => PZ.socket.emit('bj:bot', { action: 'add' }));
  $('#bj-del-bot').addEventListener('click', () => PZ.socket.emit('bj:bot', { action: 'remove' }));

  $('#bj-place').addEventListener('click', () => {
    const amount = Math.floor(Number($('#bj-bet').value) || 0);
    SFX.chip();
    PZ.socket.emit('bj:bet', { amount });
  });

  $('#bj-say').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#bj-msg').value.trim();
    if (!text) return;
    PZ.socket.emit('bj:say', { text });
    $('#bj-msg').value = '';
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
  function fillCards(box, cards, key) {
    const before = shown.get(key) || 0;
    cards.forEach((c, i) => box.appendChild(cardNode(c, i >= before)));
    shown.set(key, cards.length);
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

    $('#bj-add-bot').classList.toggle('hidden', !s.isHost);
    $('#bj-del-bot').classList.toggle('hidden', !s.isHost);

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
      who.appendChild(el('span', null, seat.name));
      node.appendChild(who);

      const group = el('div', 'hand-group');
      if (!seat.hands.length) {
        group.appendChild(el('div', 'cards'));
      } else {
        seat.hands.forEach((hand, i) => {
          const holder = el('div', `hand${seat.hands.length > 1 && i !== seat.activeHand && seat.active ? ' dim' : ''}`);
          const cards = el('div', 'cards');
          fillCards(cards, hand.cards, `${seat.id}:${i}`);
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
    socket.on('bj:closed', () => {
      showLobby();
      PZ.toast('La table a été fermée.', 'warn');
    });
  }

  PZ.views.blackjack = {
    enter() { bind(); },
    leave() {
      if (timerRaf) cancelAnimationFrame(timerRaf);
      timerRaf = null;
    },
  };
})();
