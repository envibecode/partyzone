'use strict';
/**
 * UNO — la table.
 *
 * Le serveur décide de tout : il envoie la main du joueur avec, sur chaque
 * carte, un drapeau « jouable » qu'il a calculé lui-même. Cette page ne
 * réimplémente aucune règle — c'est volontaire. Deux implémentations des
 * mêmes règles finissent toujours par diverger, et c'est celle du navigateur
 * qui a tort, parce que c'est celle qu'on peut modifier depuis la console.
 *
 * Trois partis pris d'affichage :
 *
 *  · LES CARTES INJOUABLES NE SONT PAS CACHÉES, ELLES SONT EN RETRAIT.
 *    On doit voir sa main entière pour réfléchir. Une carte qu'on ne peut
 *    pas poser descend, perd sa couleur et son relief ; elle reste lisible.
 *
 *  · LA COULEUR EN COURS EST ÉCRITE EN GRAND DERRIÈRE LA PILE.
 *    Après un joker, la carte du dessus ne dit plus quelle couleur est
 *    demandée. C'est la première source de coups refusés, et c'est stupide :
 *    l'information existe, il suffit de l'afficher.
 *
 *  · « UNO ! » EST UN GROS BOUTON QUI ARRIVE TOUT SEUL.
 *    Il apparaît au centre quand on tombe à une carte, et il disparaît tout
 *    seul. À côté, le bouton pour dénoncer les autres — parce que guetter
 *    l'oubli du voisin est la moitié du plaisir.
 */

(() => {
  const { $, el } = PZ;

  let state = null;
  let barRaf = null;

  /* ─── Vocabulaire ─── */

  const COLOR_NAME = { r: 'rouge', y: 'jaune', g: 'vert', b: 'bleu' };
  const VALUE_TEXT = { skip: '⦸', rev: '⇄', d2: '+2', wild: '★', d4: '+4' };
  const VALUE_SAY = { skip: 'passe-tour', rev: 'sens inverse', d2: '+2', wild: 'joker', d4: '+4' };

  const PHASE_TEXT = {
    lobby: 'En attente',
    playing: 'Partie en cours',
    'round-end': 'Fin de manche',
    over: 'Terminé',
  };

  /* ─── Une carte ─── */

  /**
   * Le dessin d'une carte.
   *
   * L'ovale blanc au centre penché à 20° est ce qui fait qu'on reconnaît un
   * Uno d'un coup d'œil, avant même d'avoir lu le chiffre. C'est aussi lui
   * qui empêche la carte de ressembler à un bouton coloré.
   */
  function cardNode(card, { small = false } = {}) {
    const node = el('div', `uno-card c-${card.c}${small ? ' small' : ''}`);
    node.dataset.value = card.v;

    node.appendChild(el('span', 'uno-oval'));
    node.appendChild(el('b', 'uno-face', VALUE_TEXT[card.v] || card.v));

    // Les deux petits coins, comme sur une vraie carte.
    node.appendChild(el('i', 'uno-corner tl', VALUE_TEXT[card.v] || card.v));
    node.appendChild(el('i', 'uno-corner br', VALUE_TEXT[card.v] || card.v));

    if (card.c === 'w') node.appendChild(el('span', 'uno-quad'));
    return node;
  }

  /* ─── La pile et la pioche ─── */

  function renderMiddle(s) {
    $('#uno-left').textContent = s.drawLeft != null ? s.drawLeft : '—';

    const top = $('#uno-top');
    top.replaceChildren();
    if (!s.top) return;

    const card = cardNode(s.top);
    top.appendChild(card);

    // La couleur demandée, en grand derrière la pile. Après un joker, la
    // carte ne la dit plus : sans ce repère, on tente un coup au hasard.
    top.dataset.color = s.color || '';
    const say = el('span', 'uno-color-say');
    say.textContent = s.color ? COLOR_NAME[s.color] : '';
    top.appendChild(say);

    // La pioche en attente : le chiffre qui fait peur.
    if (s.pending > 0) {
      const pile = el('div', 'uno-pending');
      pile.appendChild(el('b', null, `+${s.pending}`));
      pile.appendChild(el('span', null, 'à ramasser'));
      top.appendChild(pile);
    }
  }

  /* ─── Les joueurs autour ─── */

  function renderSeats(s) {
    const box = $('#uno-seats');
    box.replaceChildren();

    (s.seats || []).forEach((seat) => {
      const row = el('div', `uno-seat${seat.current ? ' turn' : ''}${seat.you ? ' you' : ''}`);
      if (!seat.connected) row.classList.add('away');

      const img = new Image(28, 28);
      img.src = PZ.avatarUrl(seat);
      img.alt = '';
      row.appendChild(img);

      const info = el('span', 'uno-seat-info');
      info.appendChild(el('b', null, seat.name));
      info.appendChild(el('span', null, `${seat.score} pt${seat.score > 1 ? 's' : ''}`));
      row.appendChild(info);

      // Le nombre de cartes, dessiné plutôt qu'écrit : à trois cartes on le
      // voit, à onze on lit le chiffre. C'est plus rapide que de compter.
      const count = el('span', `uno-count${seat.cards === 1 ? ' alert' : ''}`);
      count.appendChild(el('b', null, String(seat.cards)));
      count.dataset.tip = `${seat.cards} carte${seat.cards > 1 ? 's' : ''} en main`;
      row.appendChild(count);

      // Dénoncer : uniquement pendant la fenêtre, et uniquement les autres.
      if (s.uno && s.uno.playerId === seat.id && !s.uno.said && !seat.you) {
        const snitch = el('button', 'uno-snitch', 'Uno ?');
        snitch.dataset.tip = 'Il n’a pas annoncé — le prendre coûte 2 cartes';
        snitch.addEventListener('click', () => PZ.socket.emit('uno:catch', { id: seat.id }));
        row.appendChild(snitch);
      }

      box.appendChild(row);
    });
  }

  /* ─── La main ─── */

  function renderHand(s) {
    const box = $('#uno-hand');
    box.replaceChildren();

    const hand = s.hand || [];
    if (!hand.length) {
      box.appendChild(el('div', 'empty', s.phase === 'lobby'
        ? 'La partie n’a pas commencé.'
        : 'Ta main est vide.'));
      return;
    }

    // Un éventail : chaque carte est légèrement tournée et décalée. L'angle
    // se resserre quand la main grossit, sinon à quinze cartes l'éventail
    // sort de l'écran.
    const spread = Math.min(3.4, 34 / hand.length);

    hand.forEach((card, i) => {
      const wrap = el('button', `uno-slot${card.playable ? ' can' : ' cant'}`);
      const mid = (hand.length - 1) / 2;
      wrap.style.setProperty('--rot', `${(i - mid) * spread}deg`);
      wrap.style.setProperty('--lift', `${Math.abs(i - mid) * 1.6}px`);
      wrap.style.zIndex = String(i);

      wrap.appendChild(cardNode(card));
      wrap.disabled = !card.playable || !s.yourTurn;
      wrap.addEventListener('click', () => attemptPlay(card));
      wrap.dataset.tip = card.playable
        ? (card.c === 'w' ? 'Choisis une couleur après avoir posé' : '')
        : 'Ne va pas sur la pile';

      // La carte qu'on vient de piocher se signale : sinon on ne la
      // retrouve pas dans son propre éventail.
      if (s.drawn === card.id) wrap.classList.add('fresh');

      box.appendChild(wrap);
    });
  }

  /* ─── Poser une carte ─── */

  /**
   * Un joker demande une couleur.
   *
   * Plutôt qu'une fenêtre modale — lourde pour un choix parmi quatre — on
   * affiche une roue de quatre quartiers directement sous la carte. Deux
   * clics au total, sans quitter la table des yeux.
   */
  function attemptPlay(card) {
    if (card.c !== 'w') {
      PZ.socket.emit('uno:play', { cardId: card.id });
      SFX.click();
      return;
    }

    const box = el('div', 'uno-pick-color');
    box.appendChild(el('h2', null, `Tu poses un ${VALUE_SAY[card.v]}. Quelle couleur ?`));
    const wheel = el('div', 'uno-wheel');
    ['r', 'y', 'g', 'b'].forEach((c) => {
      const b = el('button', `uno-quarter q-${c}`);
      b.setAttribute('aria-label', COLOR_NAME[c]);
      b.appendChild(el('span', null, COLOR_NAME[c]));
      b.addEventListener('click', () => {
        PZ.closeModal();
        SFX.chip();
        PZ.socket.emit('uno:play', { cardId: card.id, color: c });
      });
      wheel.appendChild(b);
    });
    box.appendChild(wheel);
    PZ.openModal(box);
  }

  /* ─── Les actions du bas ─── */

  function renderActions(s) {
    const box = $('#uno-actions');
    box.replaceChildren();

    if (s.phase === 'lobby') {
      box.appendChild(el('p', 'fine',
        `${s.players.length} joueur${s.players.length > 1 ? 's' : ''} — ` +
        `il en faut ${s.min} pour lancer. Le code se copie en haut à gauche.`));
      return;
    }

    if (s.phase === 'round-end' && s.roundSummary) return renderSummary(s, box);
    if (s.phase === 'over' && s.result) return renderResult(s, box);

    // La carte piochée : la jouer ou la garder.
    if (s.drawn) {
      box.appendChild(el('span', 'uno-hint', 'Tu viens de piocher — tu peux la poser ou la garder.'));
      const keep = el('button', 'btn btn-soft', 'Garder et passer');
      keep.addEventListener('click', () => PZ.socket.emit('uno:keep'));
      box.appendChild(keep);
      return;
    }

    // Contester un +4 : la fenêtre est courte, le bouton est gros.
    if (s.canChallenge) {
      const say = el('span', 'uno-hint', `${s.pending} cartes t’attendent.`);
      box.appendChild(say);
      const ch = el('button', 'btn btn-danger', 'Contester le +4');
      ch.dataset.tip = 'S’il avait la couleur, c’est lui qui ramasse. Sinon tu en prends 2 de plus.';
      ch.addEventListener('click', () => PZ.socket.emit('uno:challenge'));
      box.appendChild(ch);
      const eat = el('button', 'btn btn-soft', `Ramasser les ${s.pending}`);
      eat.addEventListener('click', () => PZ.socket.emit('uno:draw'));
      box.appendChild(eat);
      return;
    }

    if (!s.yourTurn) {
      const who = (s.seats || []).find((x) => x.current);
      box.appendChild(el('span', 'uno-hint', who ? `Au tour de ${who.name}.` : 'En attente…'));
      return;
    }

    const playable = (s.hand || []).some((c) => c.playable);
    if (s.pending > 0) {
      box.appendChild(el('span', 'uno-hint',
        playable
          ? `Pose un ${VALUE_SAY[s.pendingKind]} pour faire monter, ou ramasse.`
          : `Rien à opposer : il faut ramasser ${s.pending} cartes.`));
      const eat = el('button', 'btn btn-gold', `Ramasser ${s.pending}`);
      eat.addEventListener('click', () => PZ.socket.emit('uno:draw'));
      box.appendChild(eat);
      return;
    }

    box.appendChild(el('span', 'uno-hint',
      playable ? 'À toi — choisis une carte.' : 'Rien à poser : il faut piocher.'));
    const pick = el('button', playable ? 'btn btn-soft' : 'btn btn-gold', 'Piocher');
    pick.addEventListener('click', () => PZ.socket.emit('uno:draw'));
    box.appendChild(pick);
  }

  /* ─── Le bouton « Uno ! » ─── */

  /**
   * Il vit à part, en surcouche au milieu de la table : c'est un geste
   * urgent, il ne doit pas se chercher parmi les autres boutons.
   */
  function renderUno(s) {
    const old = $('#uno-shout');
    if (old) old.remove();
    if (!s.uno || !s.uno.mine || s.uno.said) return;

    const btn = el('button', 'uno-shout', 'UNO !');
    btn.id = 'uno-shout';
    btn.addEventListener('click', () => {
      SFX.win();
      PZ.socket.emit('uno:say');
    });
    $('#uno-table').appendChild(btn);
  }

  /* ─── Fin de manche, fin de partie ─── */

  function renderSummary(s, box) {
    const sum = s.roundSummary;
    const panel = el('div', 'uno-summary');
    panel.appendChild(el('h2', null, `${sum.winner} termine la manche ${sum.round}`));
    panel.appendChild(el('p', 'fine', `Il empoche ${sum.gained} points — la valeur des mains adverses.`));

    const list = el('div', 'uno-tally');
    sum.tally.forEach((t) => {
      const row = el('div');
      row.appendChild(el('span', null, t.name));
      row.appendChild(el('i', null, `${t.cards} carte${t.cards > 1 ? 's' : ''}`));
      row.appendChild(el('b', null, `${t.points} pts`));
      list.appendChild(row);
    });
    panel.appendChild(list);
    panel.appendChild(el('p', 'fine', sum.last ? 'C’était la dernière manche.' : 'La manche suivante arrive…'));
    box.appendChild(panel);
  }

  function renderResult(s, box) {
    const panel = el('div', 'uno-summary win');
    const names = s.result.table
      .filter((t) => s.result.winnerIds.includes(t.id))
      .map((t) => t.name)
      .join(' et ');
    panel.appendChild(el('h2', null, `${names} l’emporte`));

    const list = el('div', 'uno-tally');
    s.result.table.forEach((t, i) => {
      const row = el('div', s.result.winnerIds.includes(t.id) ? 'top' : null);
      row.appendChild(el('span', null, `${i + 1}. ${t.name}`));
      row.appendChild(el('b', null, `${t.points} pts`));
      list.appendChild(row);
    });
    panel.appendChild(list);
    panel.appendChild(el('p', 'fine', 'L’hôte peut relancer une partie.'));
    box.appendChild(panel);
  }

  /* ─── Le fil des coups ─── */

  function renderLog(s) {
    const box = $('#uno-log');
    box.replaceChildren();
    (s.log || []).forEach((line) => box.appendChild(el('div', 'uno-line', line.text)));
  }

  /* ─── Le chronomètre du tour ─── */

  function runBar(s) {
    if (barRaf) cancelAnimationFrame(barRaf);
    const bar = $('#uno-bar');
    if (!s.deadline || s.phase !== 'playing') { bar.style.width = '0%'; return; }

    const offset = Date.now() - s.serverNow;
    const total = s.deadline - s.serverNow;
    const step = () => {
      if (state !== s) return;
      const left = Math.max(0, s.deadline - (Date.now() - offset));
      bar.style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
      // Le dernier quart passe au rouge : on comprend qu'il faut se presser
      // sans avoir à lire un chiffre.
      bar.classList.toggle('urgent', left < total * 0.25);
      if (left > 0) barRaf = requestAnimationFrame(step);
    };
    step();
  }

  /* ─── Rendu complet ─── */

  function render(s) {
    state = s;
    PZ.go('uno');

    $('#uno-code').textContent = s.code;
    $('#uno-phase').textContent = s.phase === 'playing'
      ? `Manche ${s.round}/${s.roundsTarget}${s.dir < 0 ? ' · sens inverse' : ''}`
      : (PHASE_TEXT[s.phase] || s.phase);

    const host = s.hostId === (PZ.me && PZ.me.id);
    $('#uno-start').classList.toggle('hidden', !host || s.phase === 'playing' || s.phase === 'round-end');
    $('#uno-start').textContent = s.phase === 'over' ? 'Rejouer' : 'Lancer la partie';
    $('#uno-settings').classList.toggle('hidden', !host || s.phase !== 'lobby');
    $('#uno-stacking').checked = s.stacking;
    PZ.$$('#uno-rounds .seg').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.rounds) === s.roundsTarget);
    });

    renderSeats(s);
    renderMiddle(s);
    renderHand(s);
    renderActions(s);
    renderUno(s);
    renderLog(s);
    runBar(s);
    PZ.roomChat($('#uno-chat'), s.chat);
  }

  /* ─── Interactions ─── */

  $('#uno-start').addEventListener('click', () => PZ.socket.emit('party:start'));
  $('#uno-leave').addEventListener('click', () => {
    PZ.socket.emit('party:leave');
    PZ.go('party');
  });
  $('#uno-code').addEventListener('click', async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.code);
      PZ.toast('Code copié — envoie-le à tes potes.', 'success');
    } catch {
      PZ.toast(`Le code est : ${state.code}`, 'info');
    }
  });
  $('#uno-pick').addEventListener('click', () => {
    if (state && state.yourTurn) PZ.socket.emit('uno:draw');
  });
  $('#uno-stacking').addEventListener('change', (e) => {
    PZ.socket.emit('uno:configure', { stacking: e.target.checked });
  });
  $('#uno-rounds').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rounds]');
    if (b) PZ.socket.emit('uno:configure', { rounds: Number(b.dataset.rounds) });
  });
  $('#uno-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#uno-chat-input');
    if (!input.value.trim()) return;
    PZ.socket.emit('party:say', { text: input.value });
    input.value = '';
  });

  /* ─── Branchement ─── */

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__unoBound) return;
    socket.__unoBound = true;
    socket.on('uno:state', render);
  }

  PZ.views.uno = {
    enter() { bind(); },
    leave() { if (barRaf) cancelAnimationFrame(barRaf); },
  };
})();
