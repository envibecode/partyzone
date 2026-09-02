'use strict';
/**
 * BELOTE — la table.
 *
 * Comme partout ailleurs, le serveur décide : il envoie la main avec, sur
 * chaque carte, un drapeau `legal` qu'il a calculé lui-même à partir des
 * obligations. Cette page ne connaît pas une seule règle de belote, et c'est
 * volontaire — les obligations sont exactement le genre de chose qu'on
 * réimplémente de travers, et c'est toujours la version du navigateur qui a
 * tort.
 *
 * Quatre partis pris :
 *
 *  · UNE CROIX, PAS UNE LISTE. Le partenaire en face, les adversaires à
 *    gauche et à droite. Savoir instantanément de quel côté vient une carte
 *    est la moitié du jeu ; une colonne de noms ne le dit pas.
 *
 *  · L'ATOUT EST ÉCRIT EN GRAND, EN PERMANENCE. C'est l'information qui
 *    change tout l'ordre des cartes, et c'est celle qu'on oublie au bout de
 *    trois plis. Elle reste affichée dans le coin du tapis.
 *
 *  · LES CARTES INTERDITES SONT GRISÉES, ET ON DIT POURQUOI. Le serveur
 *    renvoie une phrase précise — « il faut fournir à cœur », « à l'atout il
 *    faut monter ». On apprend la belote en comprenant les refus.
 *
 *  · LA VALEUR DE CHAQUE CARTE EST INSCRITE DESSUS. Vingt pour le valet
 *    d'atout, quatorze pour le neuf, deux pour un valet ordinaire : c'est ce
 *    qui rend le jeu compréhensible à qui n'a pas grandi avec.
 */

(() => {
  const { $, el } = PZ;

  let state = null;
  let barRaf = null;

  const SIGN = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const SUIT_NAME = { s: 'pique', h: 'cœur', d: 'carreau', c: 'trèfle' };
  const RED = new Set(['h', 'd']);

  const PHASE_TEXT = {
    lobby: 'En attente',
    bidding: 'Enchères',
    playing: 'En cours',
    'deal-end': 'Décompte',
    over: 'Terminé',
  };

  /* ─── Une carte ─── */

  function cardNode(card, { small = false } = {}) {
    const node = el('div', `bl-card${RED.has(card.s) ? ' red' : ''}${small ? ' small' : ''}${card.trump ? ' trump' : ''}`);
    node.appendChild(el('b', 'bl-rank', card.r === '10' ? '10' : card.r));
    node.appendChild(el('span', 'bl-suit', SIGN[card.s]));
    // La valeur en points, en petit dans le coin. Sans elle, la belote est
    // illisible pour qui ne connaît pas les deux barèmes par cœur.
    if (card.points != null && card.points > 0) {
      node.appendChild(el('i', 'bl-pts', String(card.points)));
    }
    return node;
  }

  function backNode() {
    return el('div', 'bl-card back');
  }

  /* ─── Les quatre coins ─── */

  /**
   * Place les joueurs autour de la croix, vu de MA place.
   *
   * Je suis toujours en bas. Mon partenaire en haut. Les deux adversaires
   * sur les côtés. Chacun voit donc une table différente, et chacun voit la
   * sienne juste — c'est le seul arrangement qui ne demande aucun effort.
   */
  function renderCross(s) {
    const seats = s.seats || [];
    const me = seats.findIndex((x) => x.you);
    const at = (offset) => (me < 0 ? seats[offset] : seats[(me + offset) % 4]);

    const slots = { 's': at(0), 'w': at(1), 'n': at(2), 'e': at(3) };

    for (const [pos, seat] of Object.entries(slots)) {
      const box = $(`#bl-${pos}`);
      box.replaceChildren();
      if (!seat) continue;

      box.className = `bl-seat pos-${pos}`
        + (seat.current ? ' turn' : '')
        + (seat.bidding ? ' turn' : '')
        + (seat.partner ? ' mate' : '')
        + (seat.you ? ' you' : '')
        + (seat.connected ? '' : ' away');
      box.dataset.who = seat.id;

      const head = el('div', 'bl-who');
      const img = new Image(26, 26);
      img.src = PZ.avatarUrl(seat);
      img.alt = '';
      head.appendChild(img);
      head.appendChild(el('b', null, seat.you ? 'Toi' : seat.name));
      if (seat.dealer) {
        const d = el('span', 'bl-badge', 'D');
        d.dataset.tip = 'Donneur';
        head.appendChild(d);
      }
      if (seat.taker) {
        const t = el('span', 'bl-badge take', 'P');
        t.dataset.tip = `Preneur — a choisi ${s.trumpName || 'l’atout'}`;
        head.appendChild(t);
      }
      box.appendChild(head);

      // Le dos des cartes des autres : on voit fondre les mains.
      if (!seat.you) {
        const fan = el('div', 'bl-mini');
        for (let i = 0; i < seat.cards; i++) fan.appendChild(backNode());
        box.appendChild(fan);
      }
    }
  }

  /* ─── Le pli au centre ─── */

  function renderCenter(s) {
    const box = $('#bl-center');
    box.replaceChildren();

    // Pendant les enchères, c'est la retourne qui trône au milieu.
    if (s.phase === 'bidding' && s.turned) {
      const wrap = el('div', 'bl-turned');
      wrap.appendChild(el('span', 'bl-turned-label',
        s.bidRound === 1 ? 'La retourne' : 'Second tour — autre couleur'));
      wrap.appendChild(cardNode(s.turned));
      box.appendChild(wrap);
      return;
    }

    if (!s.trick || !s.trick.length) {
      if (s.phase === 'playing') {
        box.appendChild(el('div', 'bl-hint', `Pli ${s.tricksDone + 1} sur 8`));
      }
      return;
    }

    // Chaque carte du pli est posée du côté de qui l'a jouée.
    const seats = s.seats || [];
    const me = seats.findIndex((x) => x.you);
    const posOf = (id) => {
      const i = seats.findIndex((x) => x.id === id);
      return ['s', 'w', 'n', 'e'][(i - me + 4) % 4];
    };

    const pile = el('div', 'bl-pile');
    s.trick.forEach((p) => {
      const node = cardNode(p.card);
      node.classList.add(`from-${posOf(p.by)}`);
      node.dataset.tip = `${p.name}`;
      pile.appendChild(node);
    });
    box.appendChild(pile);
  }

  /* ─── L'atout ─── */

  function renderTrump(s) {
    const box = $('#bl-trump');
    box.replaceChildren();
    if (!s.trump) return;

    box.className = `bl-trump${RED.has(s.trump) ? ' red' : ''}`;
    box.appendChild(el('span', 'bl-trump-label', 'Atout'));
    box.appendChild(el('b', null, SIGN[s.trump]));
    box.appendChild(el('span', 'bl-trump-name', SUIT_NAME[s.trump]));
  }

  /* ─── Les équipes et les scores ─── */

  function renderTeams(s) {
    const box = $('#bl-teams');
    box.replaceChildren();
    const seats = s.seats || [];
    if (!seats.length) {
      box.appendChild(el('div', 'empty', 'On attend d’être quatre.'));
      return;
    }

    [0, 1].forEach((t) => {
      const row = el('div', `bl-team${s.yourTeam === t ? ' mine' : ''}`);
      const names = seats.filter((x) => x.team === t);

      const who = el('div', 'bl-team-who');
      names.forEach((n) => {
        const chip = el('span', n.connected ? null : 'away');
        chip.textContent = n.you ? `${n.name} (toi)` : n.name;
        who.appendChild(chip);
      });
      row.appendChild(who);

      const score = el('div', 'bl-team-score');
      score.appendChild(el('b', null, String((s.scores || [0, 0])[t])));
      // Ce que l'équipe a ramassé dans la donne en cours : le chiffre qu'on
      // compte de tête en jouant.
      if (s.phase === 'playing') {
        score.appendChild(el('span', null, `+${(s.running || [0, 0])[t]} en cours`));
      }
      row.appendChild(score);
      box.appendChild(row);
    });

    box.appendChild(el('p', 'fine', `Partie en ${s.target} points. Le preneur doit faire 82 sur 162.`));

    if (s.belote && s.belote.team !== null && s.belote.shown > 0) {
      const b = el('p', 'bl-belote-note');
      b.textContent = s.belote.shown >= 2
        ? 'Belote-rebelote annoncée : 20 points.'
        : 'Belote annoncée — la rebelote reste à jouer.';
      box.appendChild(b);
    }
  }

  /* ─── La main ─── */

  function renderHand(s) {
    const box = $('#bl-hand');
    box.replaceChildren();
    const hand = s.hand || [];
    if (!hand.length) {
      box.appendChild(el('div', 'empty', s.phase === 'lobby'
        ? 'La partie n’a pas commencé.'
        : 'Plus de cartes.'));
      return;
    }

    hand.forEach((card, i) => {
      const wrap = el('button', `bl-slot${card.legal ? ' can' : ''}`);
      wrap.style.zIndex = String(i);
      wrap.appendChild(cardNode(card));
      // Hors de son tour, tout est cliquable-mais-inerte : on ne grise pas
      // la main entière, sinon on ne peut plus la lire pendant que les
      // autres jouent.
      wrap.disabled = !s.yourTurn || !card.legal;
      if (s.yourTurn && !card.legal) wrap.classList.add('cant');
      wrap.addEventListener('click', () => {
        SFX.click();
        PZ.socket.emit('bl:play', { cardId: card.id });
      });
      box.appendChild(wrap);
    });
  }

  /* ─── Enchères et actions ─── */

  function renderActions(s) {
    const box = $('#bl-actions');
    box.replaceChildren();

    if (s.phase === 'lobby') {
      box.appendChild(el('p', 'fine',
        `${s.players.length} joueur${s.players.length > 1 ? 's' : ''} sur 4. La belote ne se joue ni à trois ni à cinq.`));
      return;
    }

    if (s.phase === 'deal-end' && s.summary) return renderSummary(s, box);
    if (s.phase === 'over' && s.result) return renderResult(s, box);

    if (s.phase === 'bidding') {
      if (!s.yourBid) {
        const who = (s.seats || []).find((x) => x.bidding);
        box.appendChild(el('span', 'bl-hint', who ? `${who.name} réfléchit…` : 'Enchères en cours…'));
        return;
      }

      if (s.bidRound === 1) {
        box.appendChild(el('span', 'bl-hint',
          `Prendre à ${SUIT_NAME[s.turned.s]} ? Tu ramasses la retourne.`));
        const take = el('button', 'btn btn-gold', `Je prends à ${SUIT_NAME[s.turned.s]}`);
        take.addEventListener('click', () => PZ.socket.emit('bl:bid', { take: true }));
        box.appendChild(take);
      } else {
        box.appendChild(el('span', 'bl-hint', 'Second tour : choisis une autre couleur.'));
        const wheel = el('div', 'bl-suits');
        ['s', 'h', 'd', 'c'].forEach((c) => {
          if (c === s.turned.s) return;
          const b = el('button', `bl-suit-btn${RED.has(c) ? ' red' : ''}`);
          b.appendChild(el('b', null, SIGN[c]));
          b.appendChild(el('span', null, SUIT_NAME[c]));
          b.addEventListener('click', () => PZ.socket.emit('bl:bid', { take: true, suit: c }));
          wheel.appendChild(b);
        });
        box.appendChild(wheel);
      }

      const pass = el('button', 'btn btn-soft', 'Passer');
      pass.addEventListener('click', () => PZ.socket.emit('bl:bid', { take: false }));
      box.appendChild(pass);
      return;
    }

    if (!s.yourTurn) {
      const who = (s.seats || []).find((x) => x.current);
      box.appendChild(el('span', 'bl-hint', who ? `Au tour de ${who.name}.` : 'En attente…'));
      return;
    }

    const playable = (s.hand || []).filter((c) => c.legal).length;
    const total = (s.hand || []).length;
    box.appendChild(el('span', 'bl-hint',
      playable === total
        ? 'À toi — tu joues ce que tu veux.'
        : `À toi — ${playable} carte${playable > 1 ? 's' : ''} jouable${playable > 1 ? 's' : ''} sur ${total}.`));
  }

  /* ─── Décomptes ─── */

  function renderSummary(s, box) {
    const d = s.summary;
    const panel = el('div', `bl-summary ${d.verdict}`);

    const titles = {
      rempli: `Contrat rempli — ${d.taker} passe à ${SUIT_NAME[d.trump]}`,
      dedans: `Dedans ! ${d.taker} chute à ${SUIT_NAME[d.trump]}`,
      capot: `CAPOT — ${d.taker} fait les huit plis`,
      'capot-contre': `Capot contre ${d.taker} — les huit plis pour l’autre camp`,
    };
    panel.appendChild(el('h2', null, titles[d.verdict]));

    const list = el('div', 'bl-tally');
    [0, 1].forEach((t) => {
      const row = el('div', d.final[t] > d.final[1 - t] ? 'top' : null);
      row.appendChild(el('span', null, d.teams[t].join(' & ')));
      row.appendChild(el('i', null, `${d.raw[t]} de cartes${d.belote[t] ? ` + ${d.belote[t]} de belote` : ''}`));
      row.appendChild(el('b', null, `${d.final[t]} pts`));
      list.appendChild(row);
    });
    panel.appendChild(list);

    panel.appendChild(el('p', 'fine',
      `Dix de der pour ${d.teams[d.lastTrickTeam].join(' & ')}. `
      + `Score : ${d.scores[0]} — ${d.scores[1]}, partie en ${s.target}.`));
    box.appendChild(panel);
  }

  function renderResult(s, box) {
    const r = s.result;
    const panel = el('div', 'bl-summary win');
    const seats = s.seats || [];
    if (r.winnerTeam === null) {
      panel.appendChild(el('h2', null, `Égalité parfaite à ${r.scores[0]}`));
    } else {
      const names = seats.filter((x) => x.team === r.winnerTeam).map((x) => x.name).join(' & ');
      panel.appendChild(el('h2', null, `${names} l’emportent`));
    }
    panel.appendChild(el('p', 'fine',
      `${r.scores[0]} — ${r.scores[1]} en ${r.deals} donne${r.deals > 1 ? 's' : ''}. L’hôte peut relancer.`));
    box.appendChild(panel);
  }

  /* ─── Journal et chronomètre ─── */

  function renderLog(s) {
    const box = $('#bl-log');
    box.replaceChildren();
    (s.log || []).forEach((line) => box.appendChild(el('div', 'bl-line', line.text)));
  }

  function runBar(s) {
    if (barRaf) cancelAnimationFrame(barRaf);
    const bar = $('#bl-bar');
    const live = s.phase === 'playing' || s.phase === 'bidding';
    if (!s.deadline || !live) { bar.style.width = '0%'; return; }

    const offset = Date.now() - s.serverNow;
    const total = s.deadline - s.serverNow;
    const step = () => {
      if (state !== s) return;
      const left = Math.max(0, s.deadline - (Date.now() - offset));
      bar.style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
      bar.classList.toggle('urgent', left < total * 0.25);
      if (left > 0) barRaf = requestAnimationFrame(step);
    };
    step();
  }

  /* ─── Rendu ─── */

  /**
   * Ses annonces, affichées comme un fait acquis.
   *
   * Le serveur les calcule pour tout le monde, comme belote-rebelote : à
   * une vraie table on peut oublier d'annoncer sa tierce et perdre vingt
   * points bêtement, ici non. La bannière dit aussi quand c'est l'autre
   * camp qui marque — sinon on croit qu'elles n'ont servi à rien.
   */
  function renderAnnounces(s) {
    const box = $('#bl-announce');
    if (!box) return;
    box.replaceChildren();
    const a = s.announces;
    if (!a || (!a.mine.length && a.team === null)) { box.hidden = true; return; }
    box.hidden = false;

    if (a.mine.length) {
      const mine = el('div', 'bl-ann-mine');
      mine.appendChild(el('b', null, 'Tes annonces'));
      a.mine.forEach((x) => {
        const row = el('span', 'bl-ann');
        row.appendChild(el('i', null, x.label));
        row.appendChild(el('em', null, `${x.points}`));
        mine.appendChild(row);
      });
      box.appendChild(mine);
    }

    if (a.team !== null && a.team !== undefined) {
      const mineTeam = (s.seats || []).find((x) => x.you);
      const won = mineTeam && mineTeam.team === a.team;
      const line = el('p', `bl-ann-verdict${won ? ' won' : ''}`);
      line.textContent = won
        ? `Votre camp marque ${a.points[a.team]} points d’annonces.`
        : `C’est l’autre camp qui marque les annonces (${a.points[a.team]} points).`;
      box.appendChild(line);
    }
  }

  function render(s) {
    state = s;
    renderAnnounces(s);
    PZ.watchBanner(s);
    $('#view-bl').classList.toggle('watching', Boolean(s.watching));
    PZ.go('bl');

    $('#bl-code').textContent = s.code;
    $('#bl-phase').textContent = s.phase === 'playing'
      ? `Donne ${s.deal} · pli ${s.tricksDone + 1}/8`
      : s.phase === 'bidding'
        ? `Donne ${s.deal} · enchères${s.bidRound === 2 ? ' (2ᵉ tour)' : ''}`
        : (PHASE_TEXT[s.phase] || s.phase);

    const host = s.hostId === (PZ.me && PZ.me.id);
    const idle = s.phase === 'lobby' || s.phase === 'over';
    $('#bl-start').classList.toggle('hidden', !host || !idle);
    $('#bl-start').textContent = s.phase === 'over' ? 'Rejouer' : 'Lancer la partie';
    $('#bl-settings').classList.toggle('hidden', !host || s.phase !== 'lobby');
    $('#bl-must').checked = Boolean(s.dealerMustTake);
    PZ.$$('#bl-target .seg').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.target) === s.target);
    });

    renderTeams(s);
    renderCross(s);
    renderCenter(s);
    renderTrump(s);
    renderHand(s);
    renderActions(s);
    renderLog(s);
    runBar(s);
    PZ.roomChat($('#bl-chat'), s.chat);
  }

  /* ─── Interactions ─── */

  $('#bl-start').addEventListener('click', () => PZ.socket.emit('party:start'));
  $('#bl-leave').addEventListener('click', () => {
    PZ.socket.emit('party:leave');
    PZ.go('party');
  });
  $('#bl-code').addEventListener('click', async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.code);
      PZ.toast('Code copié — envoie-le à tes potes.', 'success');
    } catch {
      PZ.toast(`Le code est : ${state.code}`, 'info');
    }
  });
  $('#bl-target').addEventListener('click', (e) => {
    const b = e.target.closest('[data-target]');
    if (b) PZ.socket.emit('bl:configure', { target: Number(b.dataset.target) });
  });
  $('#bl-must').addEventListener('change', (e) => {
    PZ.socket.emit('bl:configure', { dealerMustTake: e.target.checked });
  });
  $('#bl-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#bl-chat-input');
    if (!input.value.trim()) return;
    PZ.socket.emit('party:say', { text: input.value });
    input.value = '';
  });

  /* ─── Branchement ─── */


  // La barre de réactions, sous le chat du salon, et le repère qui dit
  // au-dessus de quel siège afficher la bulle.
  PZ.seatFinder['bl'] = (id) => document.querySelector(`#view-bl .bl-seat[data-who="${id}"]`);
  $('#bl-chat-form').parentElement.appendChild(PZ.reactionBar());

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__blBound) return;
    socket.__blBound = true;
    socket.on('bl:state', render);
  }

  PZ.views.bl = {
    enter() { bind(); },
    leave() { if (barRaf) cancelAnimationFrame(barRaf); },
  };
})();
