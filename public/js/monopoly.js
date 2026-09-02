'use strict';
/**
 * MONOPOLY — le plateau.
 *
 * Cette page ne connaît AUCUNE règle. Le serveur envoie, à chaque
 * changement, l'état complet : qui possède quoi, combien vaut le loyer de
 * chaque case, sur quelles cases CE joueur peut bâtir, ce qu'il a le droit
 * de faire à cet instant. Ici on dessine, et c'est tout — même le calcul
 * « ai-je le monopole du groupe orange » se fait côté serveur, parce que
 * deux implémentations d'une règle, c'est une implémentation de trop.
 *
 * Quatre partis pris d'affichage :
 *
 *  · LE PLATEAU EST L'ÉCRAN. Onze cases sur onze, et le carré vide au
 *    milieu — celui où l'on regarde de toute façon — accueille les dés, la
 *    carte tirée et les boutons du tour. Aucun panneau flottant.
 *
 *  · LE LOYER EST ÉCRIT SUR LA CASE. Dès qu'une case a un propriétaire,
 *    elle affiche ce qu'elle coûte à celui qui tombe dessus. C'est la seule
 *    information dont on a besoin en jouant, et sur un vrai plateau il faut
 *    demander la carte au voisin pour l'obtenir.
 *
 *  · SES TITRES SONT SOUS LE PLATEAU, GROUPÉS PAR COULEUR. On construit
 *    par groupe, on hypothèque par groupe, on échange par groupe : les
 *    ranger autrement serait ranger contre le jeu.
 *
 *  · UN REFUS EST UNE PHRASE. Les boutons impossibles ne sont pas grisés
 *    en silence : le serveur renvoie « il te manque une case du groupe »,
 *    « la banque n'a plus d'hôtel », et on l'affiche.
 */

(() => {
  const { $, el, fmt } = PZ;

  let state = null;
  let barRaf = null;
  let openDeed = null;    // la case dont on regarde le titre
  let tradeWith = null;   // le joueur avec qui on prépare un échange

  const PHASE_TEXT = {
    lobby: 'En attente',
    play: 'En cours',
    over: 'Terminé',
  };

  const STEP_TEXT = {
    roll: 'Lance les dés',
    decide: 'Acheter ou laisser',
    debt: 'Dette à régler',
    auction: 'Enchères',
    end: 'Fin de tour',
  };

  /* ═══════════ La géométrie du plateau ═══════════
   *
   * Départ en bas à droite, on tourne dans le sens des aiguilles d'une
   * montre en remontant par la gauche — c'est le sens de lecture d'un vrai
   * plateau posé sur une table, et le seul qui ne désoriente personne.
   */
  function place(i) {
    if (i === 0) return { r: 11, c: 11 };
    if (i < 10) return { r: 11, c: 11 - i };
    if (i === 10) return { r: 11, c: 1 };
    if (i < 20) return { r: 21 - i, c: 1 };
    if (i === 20) return { r: 1, c: 1 };
    if (i < 30) return { r: 1, c: i - 19 };
    if (i === 30) return { r: 1, c: 11 };
    return { r: i - 29, c: 11 };
  }

  /** Le côté du plateau, pour orienter la bande de couleur vers l'intérieur. */
  function side(i) {
    if (i === 0 || i === 10 || i === 20 || i === 30) return 'coin';
    if (i < 10) return 'bas';
    if (i < 20) return 'gauche';
    if (i < 30) return 'haut';
    return 'droite';
  }

  const ICONS = {
    depart: '➜', prison: '⛓', parc: '🅿', 'go-prison': '👮',
    chance: '?', caisse: '⛁', impot: '💰', taxe: '💎',
    gare: '🚂', service: '⚡',
  };

  /* ═══════════ Le plateau ═══════════ */

  let boardBuilt = false;

  function buildBoard(s) {
    const box = $('#mono-board');
    // Le centre est déjà dans le HTML : on ne le recrée pas, on ajoute les
    // quarante cases autour.
    [...box.querySelectorAll('.mono-cell')].forEach((n) => n.remove());

    s.board.forEach((cell, i) => {
      const { r, c } = place(i);
      const node = el('button', `mono-cell ${side(i)} type-${cell.type}`);
      node.style.gridRow = String(r);
      node.style.gridColumn = String(c);
      node.dataset.cell = String(i);

      if (cell.group && s.groups[cell.group]) {
        const band = el('span', 'mono-band');
        band.style.background = s.groups[cell.group].color;
        node.appendChild(band);
      }

      const body = el('span', 'mono-cell-body');
      if (ICONS[cell.type] && cell.type !== 'terrain') {
        body.appendChild(el('span', 'mono-ico', ICONS[cell.type === 'gare' || cell.type === 'service' ? cell.type : cell.type]));
      }
      body.appendChild(el('span', 'mono-name', cell.name));
      body.appendChild(el('span', 'mono-price'));
      node.appendChild(body);

      node.appendChild(el('span', 'mono-build'));
      node.appendChild(el('span', 'mono-pawns'));
      node.addEventListener('click', () => {
        openDeed = (openDeed === i) ? null : i;
        renderDeeds(state);
      });
      box.appendChild(node);
    });
    boardBuilt = true;
  }

  function renderBoard(s) {
    if (!boardBuilt) buildBoard(s);

    const byCell = new Map();
    s.players.forEach((p) => {
      if (p.out) return;
      const list = byCell.get(p.pos) || [];
      list.push(p);
      byCell.set(p.pos, list);
    });

    s.board.forEach((cell, i) => {
      const node = $(`#mono-board [data-cell="${i}"]`);
      if (!node) return;
      const own = s.cells[i];
      const owner = own.ownerId ? s.players.find((p) => p.id === own.ownerId) : null;

      node.classList.toggle('owned', Boolean(owner));
      node.classList.toggle('mine', Boolean(owner && owner.you));
      node.classList.toggle('mortgaged', own.mortgaged);
      node.classList.toggle('open', openDeed === i);
      node.style.setProperty('--own', owner ? tokenColour(s, owner.id) : 'transparent');

      // Le prix quand la case est libre, le loyer quand elle est prise :
      // dans les deux cas, le chiffre qui compte à cet instant.
      // Pas de « ¤ » ici : à huit pixels le signe monétaire n'est plus qu'un
      // petit carré illisible. Sur une case de plateau, un nombre seul EST
      // une somme, personne ne s'y trompe.
      const price = node.querySelector('.mono-price');
      if (own.mortgaged) price.textContent = 'hypothéquée';
      else if (owner) price.textContent = `loyer ${fmt(own.rent)}`;
      else if (cell.price) price.textContent = String(cell.price);
      else if (cell.amount) price.textContent = String(cell.amount);
      else price.textContent = cell.hint || '';

      // Les constructions : quatre maisons puis un hôtel, dessinées.
      const build = node.querySelector('.mono-build');
      build.replaceChildren();
      if (own.houses === 5) build.appendChild(el('i', 'mono-hotel'));
      else for (let k = 0; k < own.houses; k++) build.appendChild(el('i', 'mono-house'));

      // Les pions.
      const pawns = node.querySelector('.mono-pawns');
      pawns.replaceChildren();
      (byCell.get(i) || []).forEach((p) => {
        const pawn = el('span', `mono-pawn${p.current ? ' now' : ''}`, p.token);
        pawn.title = p.name;
        pawn.style.setProperty('--own', tokenColour(s, p.id));
        pawns.appendChild(pawn);
      });
    });
  }

  /** Une couleur stable par joueur, tirée de son rang à la table. */
  const SEAT_COLOURS = ['#C3EF3C', '#4C82F7', '#FF3D8B', '#E8A33C', '#29C2E8', '#9B5CFF'];
  function tokenColour(s, id) {
    const i = s.players.findIndex((p) => p.id === id);
    return SEAT_COLOURS[(i < 0 ? 0 : i) % SEAT_COLOURS.length];
  }

  /* ═══════════ Les joueurs ═══════════ */

  function renderSeats(s) {
    const box = $('#mono-seats');
    box.replaceChildren();

    s.players.forEach((p) => {
      const row = el('div', `mono-seat${p.current ? ' turn' : ''}${p.out ? ' out' : ''}${p.you ? ' you' : ''}`);
      row.dataset.who = p.id;
      if (!p.connected) row.classList.add('away');
      row.style.setProperty('--own', tokenColour(s, p.id));

      row.appendChild(el('span', 'mono-seat-token', p.token));

      const info = el('span', 'mono-seat-info');
      const line = el('b');
      line.textContent = p.name;
      if (p.jail) line.appendChild(el('i', 'mono-tag', 'en prison'));
      info.appendChild(line);
      // La fortune à côté de l'argent : c'est elle qui départage à la fin
      // d'une partie courte, donc c'est elle qu'on surveille.
      if (p.out) {
        info.appendChild(el('span', null, 'en faillite'));
      } else {
        const wallet = el('span', 'mono-wallet');
        wallet.appendChild(el('b', null, `${fmt(p.money)} ¤`));
        // La fortune départage à la fin d'une partie courte : elle mérite
        // sa place, mais pas la même taille que l'argent liquide.
        wallet.appendChild(el('i', null, `fortune ${fmt(p.worth)}`));
        info.appendChild(wallet);
      }
      row.appendChild(info);

      const n = el('span', 'mono-seat-count');
      n.textContent = String(p.cells.length);
      n.dataset.tip = `${p.cells.length} propriété${p.cells.length > 1 ? 's' : ''}`;
      row.appendChild(n);

      // Proposer un échange : seulement à quelqu'un qui joue encore.
      if (!p.you && !p.out && s.phase === 'play' && !s.you.out) {
        const swap = el('button', 'mono-swap', '⇄');
        swap.dataset.tip = `Proposer un échange à ${p.name}`;
        swap.addEventListener('click', (e) => { e.stopPropagation(); openTrade(p.id); });
        row.appendChild(swap);
      }

      box.appendChild(row);
    });

    const bank = $('#mono-bank');
    bank.replaceChildren();
    if (s.phase === 'play') {
      bank.appendChild(el('h3', null, 'Banque'));
      const line = el('p', 'mono-hint');
      line.textContent = `${s.stock.houses} maison${s.stock.houses > 1 ? 's' : ''} et ${s.stock.hotels} hôtel${s.stock.hotels > 1 ? 's' : ''} en réserve.`;
      bank.appendChild(line);
      if (s.lapsTarget) {
        bank.appendChild(el('p', 'mono-hint', `Tour ${s.laps + 1} sur ${s.lapsTarget}.`));
      }
    }
  }

  /* ═══════════ Le milieu du plateau ═══════════ */

  function renderMiddle(s) {
    const dice = $('#mono-dice');
    dice.replaceChildren();
    if (s.dice) {
      s.dice.forEach((d) => {
        const die = el('span', 'mono-die');
        // Les points d'un dé, dessinés : un chiffre se lit, un dé se voit.
        for (let k = 0; k < d; k++) die.appendChild(el('i'));
        die.dataset.face = String(d);
        dice.appendChild(die);
      });
      if (s.dice[0] === s.dice[1]) dice.appendChild(el('span', 'mono-double', 'double'));
    }

    const turn = $('#mono-turn');
    const cur = s.players.find((p) => p.current);
    if (s.phase === 'lobby') {
      turn.textContent = `${s.players.length} joueur${s.players.length > 1 ? 's' : ''} — il en faut ${s.min}.`;
    } else if (s.phase === 'over' && s.result) {
      turn.textContent = `${s.result.winnerIds.map((id) => (s.players.find((p) => p.id === id) || {}).name).join(' et ')} l’emporte.`;
    } else if (s.you.yourTurn) {
      turn.textContent = `À toi — ${STEP_TEXT[s.step] || ''}`.trim();
    } else {
      turn.textContent = cur ? `Au tour de ${cur.name}` : '—';
    }
    turn.classList.toggle('mine', Boolean(s.you.yourTurn));

    // La carte qu'on vient de tirer, si elle vient de tomber.
    const card = $('#mono-card');
    card.replaceChildren();
    if (s.card && s.phase === 'play') {
      const box = el('div', `mono-draw ${s.card.kind}`);
      box.appendChild(el('span', null, s.card.kind === 'chance' ? 'Chance' : 'Caisse commune'));
      box.appendChild(el('p', null, s.card.text));
      card.appendChild(box);
    }
  }

  /* ═══════════ Les boutons du tour ═══════════ */

  function button(box, label, kind, handler, tip) {
    const b = el('button', `btn ${kind}`, label);
    if (tip) b.dataset.tip = tip;
    b.addEventListener('click', handler);
    box.appendChild(b);
    return b;
  }

  function renderActions(s) {
    const box = $('#mono-actions');
    box.replaceChildren();
    const emit = (ev, payload) => PZ.socket.emit(ev, payload || {});

    if (s.phase !== 'play') return;

    // Une offre d'échange qui m'est adressée passe avant tout le reste :
    // c'est la seule chose qui attend une réponse de moi hors de mon tour.
    if (s.trade && s.trade.mine) {
      box.appendChild(tradeCard(s));
      return;
    }

    // Une dette bloque la partie : on ne montre que ce qui la règle.
    if (s.debt && s.debt.playerId === s.you.id) {
      const line = el('p', 'mono-debt');
      line.textContent = `Tu dois ${fmt(s.debt.amount)} à ${s.debt.toName} — ${s.debt.reason}. Vends ou hypothèque ci-dessous.`;
      box.appendChild(line);
      if (s.you.money >= s.debt.amount) {
        button(box, `Payer ${fmt(s.debt.amount)}`, 'btn-primary', () => emit('mono:pay'));
      } else {
        const left = el('p', 'mono-hint');
        left.textContent = `Il te manque ${fmt(s.debt.amount - s.you.money)}.`;
        box.appendChild(left);
      }
      button(box, 'Déclarer faillite', 'btn-ghost danger', () => {
        if (confirm('Abandonner la partie ? Tout ce que tu possèdes revient à ton créancier.')) emit('mono:bankrupt');
      });
      return;
    }
    if (s.debt && s.debt.waiting) {
      box.appendChild(el('p', 'mono-hint', `${s.debt.name} doit vendre pour payer — la partie l’attend.`));
      return;
    }

    if (!s.you.yourTurn) {
      box.appendChild(el('p', 'mono-hint', 'Ce n’est pas ton tour. Tu peux bâtir et proposer des échanges quand même.'));
      return;
    }

    if (s.step === 'roll') {
      if (s.you.jail) {
        box.appendChild(el('p', 'mono-hint',
          `En prison — tentative ${s.you.jailTurns + 1} sur 3. Un double te libère.`));
        if (s.you.freeCards > 0) button(box, 'Utiliser ma carte de sortie', 'btn-soft', () => emit('mono:jail-card'));
        if (s.you.money >= 50) button(box, 'Payer 50', 'btn-soft', () => emit('mono:jail-pay'));
      }
      button(box, 'Lancer les dés', 'btn-primary', () => emit('mono:roll'));
      return;
    }

    if (s.step === 'decide' && s.buy) {
      const cell = s.board[s.buy.cellIndex];
      box.appendChild(el('p', 'mono-hint', `${cell.name} est libre.`));
      if (s.you.money >= s.buy.price) {
        button(box, `Acheter — ${fmt(s.buy.price)} ¤`, 'btn-primary', () => emit('mono:buy'));
      } else {
        // Pas de bouton qui refuse : on dit tout de suite pourquoi il n'est
        // pas là. Un bouton sur lequel on clique pour se faire jeter est
        // pire qu'un bouton absent.
        box.appendChild(el('p', 'mono-hint',
          `Il te manque ${fmt(s.buy.price - s.you.money)} — vends ou hypothèque, ou laisse la case.`));
      }
      button(box, 'Laisser', 'btn-ghost', () => emit('mono:pass'),
        'La case reste libre : quelqu’un d’autre pourra la prendre');
      return;
    }

    if (s.step === 'auction' && s.auction) {
      box.appendChild(auctionCard(s));
      return;
    }

    if (s.step === 'end') {
      button(box, 'Terminer le tour', 'btn-primary', () => emit('mono:end'));
    }
  }

  /**
   * L'enchère.
   *
   * Trois boutons de montée rapide plutôt qu'un champ de saisie : à une
   * vraie table on lève la main, on ne remplit pas un formulaire. Le champ
   * reste là pour qui veut un chiffre précis, mais il n'est pas ce qu'on
   * voit en premier.
   */
  function auctionCard(s) {
    const a = s.auction;
    const box = el('div', 'mono-auction');

    const head = el('div', 'mono-auction-head');
    head.appendChild(el('b', null, a.name));
    head.appendChild(el('span', null, `prix affiché ${fmt(a.price)} ¤`));
    box.appendChild(head);

    const now = el('p', 'mono-auction-now');
    now.textContent = a.high
      ? `${fmt(a.high)} ¤ — ${a.bidderName}`
      : 'Aucune offre pour l’instant.';
    box.appendChild(now);

    if (!a.mine) {
      box.appendChild(el('p', 'mono-hint',
        a.whoName ? `Au tour de ${a.whoName} d’enchérir.` : 'Enchère en cours…'));
      return box;
    }

    const steps = el('div', 'mono-auction-steps');
    [10, 50, 100].forEach((step) => {
      const next = a.high + step;
      const b = el('button', 'btn btn-soft', `+${step}`);
      b.disabled = next > s.you.money;
      b.dataset.tip = `Enchérir à ${fmt(next)} ¤`;
      b.addEventListener('click', () => PZ.socket.emit('mono:bid', { amount: next }));
      steps.appendChild(b);
    });
    box.appendChild(steps);

    const line = el('div', 'mono-auction-free');
    const input = el('input', 'input');
    input.type = 'number';
    input.min = String(a.high + 1);
    input.max = String(s.you.money);
    input.value = String(Math.min(s.you.money, a.high + 10));
    line.appendChild(input);
    const go = el('button', 'btn btn-primary', 'Enchérir');
    go.addEventListener('click', () => PZ.socket.emit('mono:bid', { amount: Number(input.value) }));
    line.appendChild(go);
    box.appendChild(line);

    const out = el('button', 'btn btn-ghost btn-block', 'Passer');
    out.dataset.tip = 'Définitif : on ne revient pas dans une enchère';
    out.addEventListener('click', () => PZ.socket.emit('mono:bid-pass'));
    box.appendChild(out);

    return box;
  }

  /* ═══════════ Les titres de propriété ═══════════ */

  function renderDeeds(s) {
    const box = $('#mono-deeds');
    box.replaceChildren();
    if (!s || s.phase !== 'play') return;

    const me = s.players.find((p) => p.you);
    if (!me || !me.cells.length) {
      box.appendChild(el('p', 'mono-hint', 'Tu ne possèdes rien pour l’instant. Achète les cases sur lesquelles tu tombes.'));
      return;
    }

    const head = el('div', 'mono-deeds-head');
    head.appendChild(el('h3', null, `Tes titres (${me.cells.length})`));
    head.appendChild(el('span', 'mono-hint', 'Clique une case du plateau pour l’ouvrir ici.'));
    box.appendChild(head);

    const list = el('div', 'mono-deed-list');
    // Groupées par couleur : on construit par groupe, donc on range par groupe.
    const sorted = [...me.cells].sort((a, b) => a - b);
    sorted.forEach((i) => list.appendChild(deedNode(s, i)));
    box.appendChild(list);
  }

  function deedNode(s, i) {
    const cell = s.board[i];
    const own = s.cells[i];
    const node = el('div', `mono-deed${openDeed === i ? ' open' : ''}${own.mortgaged ? ' mortgaged' : ''}`);
    if (cell.group && s.groups[cell.group]) node.style.setProperty('--own', s.groups[cell.group].color);
    else node.style.setProperty('--own', 'var(--t-off)');

    const head = el('button', 'mono-deed-head');
    head.appendChild(el('b', null, cell.name));
    head.appendChild(el('span', null, own.mortgaged ? 'hypothéquée' : `loyer ${fmt(own.rent)} ¤`));
    head.addEventListener('click', () => { openDeed = openDeed === i ? null : i; renderDeeds(s); });
    node.appendChild(head);

    if (openDeed !== i) return node;

    const body = el('div', 'mono-deed-body');
    const emit = (ev) => PZ.socket.emit(ev, { cell: i });

    if (cell.type === 'terrain') {
      // Le barème complet : c'est la carte du jeu, et on ne devrait jamais
      // avoir à la demander à son voisin.
      const table = el('div', 'mono-scale');
      const labels = ['nu', '1 mais.', '2', '3', '4', 'hôtel'];
      cell.rent.forEach((v, k) => {
        const row = el('div', own.houses === k ? 'now' : null);
        row.appendChild(el('span', null, labels[k]));
        row.appendChild(el('b', null, `${fmt(v)} ¤`));
        table.appendChild(row);
      });
      body.appendChild(table);
      body.appendChild(el('p', 'mono-hint',
        `Maison : ${s.groups[cell.group].house} ¤ · hypothèque : ${cell.mortgage} ¤`));
    } else {
      body.appendChild(el('p', 'mono-hint', cell.type === 'gare'
        ? 'Le loyer double à chaque gare possédée : 25, 50, 100, 200.'
        : 'Quatre fois les dés ; dix fois si tu as les deux services.'));
      body.appendChild(el('p', 'mono-hint', `Hypothèque : ${cell.mortgage} ¤`));
    }

    const acts = el('div', 'mono-deed-acts');
    if (cell.type === 'terrain' && !own.mortgaged) {
      const canBuild = s.you.buildable.includes(i);
      const b = el('button', `btn-mini${canBuild ? ' gold' : ''}`, own.houses === 4 ? 'Bâtir l’hôtel' : 'Bâtir');
      b.addEventListener('click', () => emit('mono:build'));
      acts.appendChild(b);
      if (own.houses > 0) {
        const sell = el('button', 'btn-mini', 'Revendre');
        sell.dataset.tip = 'La banque reprend à la moitié du prix';
        sell.addEventListener('click', () => emit('mono:sell'));
        acts.appendChild(sell);
      }
    }
    if (own.mortgaged) {
      const up = el('button', 'btn-mini', `Lever (${Math.ceil(cell.mortgage * 1.1)} ¤)`);
      up.addEventListener('click', () => emit('mono:unmortgage'));
      acts.appendChild(up);
    } else {
      const down = el('button', 'btn-mini danger', `Hypothéquer (+${cell.mortgage} ¤)`);
      down.addEventListener('click', () => emit('mono:mortgage'));
      acts.appendChild(down);
    }
    body.appendChild(acts);
    node.appendChild(body);
    return node;
  }

  /* ═══════════ Les échanges ═══════════ */

  /**
   * La fenêtre d'échange.
   *
   * Deux colonnes : ce que je donne, ce que je demande. Rien de plus — un
   * échange de Monopoly se négocie de vive voix, l'écran n'a qu'à
   * enregistrer ce sur quoi on s'est mis d'accord.
   */
  function openTrade(toId) {
    if (!state) return;
    tradeWith = toId;
    const s = state;
    const me = s.players.find((p) => p.you);
    const other = s.players.find((p) => p.id === toId);
    if (!me || !other) return;

    const box = el('div', 'mono-trade');
    box.appendChild(el('h2', null, `Échange avec ${other.name}`));

    const grid = el('div', 'mono-trade-grid');
    const mine = column('Tu donnes', me, s);
    const theirs = column('Tu demandes', other, s);
    grid.appendChild(mine.node);
    grid.appendChild(theirs.node);
    box.appendChild(grid);

    const foot = el('div', 'mono-trade-foot');
    const send = el('button', 'btn btn-primary btn-block', 'Proposer');
    send.addEventListener('click', () => {
      PZ.socket.emit('mono:offer', {
        toId,
        giveCells: mine.picked(),
        giveMoney: mine.money(),
        wantCells: theirs.picked(),
        wantMoney: theirs.money(),
      });
      PZ.closeModal();
    });
    foot.appendChild(send);
    box.appendChild(foot);

    PZ.openModal(box);
  }

  function column(title, player, s) {
    const node = el('div', 'mono-trade-col');
    node.appendChild(el('h3', null, title));

    const picks = new Set();
    const list = el('div', 'mono-trade-cells');
    player.cells.forEach((i) => {
      const cell = s.board[i];
      const b = el('button', 'mono-pick');
      if (cell.group && s.groups[cell.group]) b.style.setProperty('--own', s.groups[cell.group].color);
      b.textContent = cell.name;
      b.addEventListener('click', () => {
        if (picks.has(i)) picks.delete(i); else picks.add(i);
        b.classList.toggle('on', picks.has(i));
      });
      list.appendChild(b);
    });
    if (!player.cells.length) list.appendChild(el('p', 'mono-hint', 'Aucune propriété.'));
    node.appendChild(list);

    const money = el('input', 'input');
    money.type = 'number';
    money.min = '0';
    money.max = String(player.money);
    money.value = '0';
    money.setAttribute('aria-label', `Argent — ${title}`);
    node.appendChild(money);
    node.appendChild(el('p', 'mono-hint', `${fmt(player.money)} ¤ en caisse`));

    return {
      node,
      picked: () => [...picks],
      money: () => Math.max(0, Math.min(player.money, Math.floor(Number(money.value) || 0))),
    };
  }

  /** L'offre reçue, à accepter ou à refuser. */
  function tradeCard(s) {
    const t = s.trade;
    const box = el('div', 'mono-offer');
    box.appendChild(el('h3', null, `${t.fromName} te propose un échange`));

    const line = (label, cells, money) => {
      const p = el('p');
      const names = cells.map((i) => s.board[i].name);
      if (money) names.push(`${fmt(money)} ¤`);
      p.appendChild(el('b', null, label));
      p.appendChild(document.createTextNode(names.length ? ` ${names.join(', ')}` : ' rien'));
      return p;
    };
    box.appendChild(line('Il donne :', t.give, t.giveMoney));
    box.appendChild(line('Il demande :', t.want, t.wantMoney));

    const acts = el('div', 'mono-offer-acts');
    const yes = el('button', 'btn btn-primary', 'Accepter');
    yes.addEventListener('click', () => PZ.socket.emit('mono:trade', { accept: true }));
    const no = el('button', 'btn btn-ghost', 'Refuser');
    no.addEventListener('click', () => PZ.socket.emit('mono:trade', { accept: false }));
    acts.appendChild(yes);
    acts.appendChild(no);
    box.appendChild(acts);
    return box;
  }

  /* ═══════════ Le journal et le chrono ═══════════ */

  function renderLog(s) {
    const box = $('#mono-log');
    box.replaceChildren();
    s.log.slice(0, 14).forEach((line) => box.appendChild(el('div', 'mono-line', line.text)));
  }

  function renderBar(s) {
    if (barRaf) cancelAnimationFrame(barRaf);
    const bar = $('#mono-bar');
    if (!s.deadline || s.phase !== 'play') { bar.style.width = '0%'; return; }
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

  /* ═══════════ Le rendu complet ═══════════ */

  /**
   * Le son suit l'état, pas les clics.
   *
   * Écouter ses propres boutons ne ferait entendre que soi ; c'est en
   * suivant ce qui CHANGE dans l'état qu'on entend aussi les dés du
   * voisin, son loyer qui tombe et la grille de la prison qui se referme.
   * On garde donc une trace du coup précédent pour ne sonner que sur une
   * vraie nouveauté.
   */
  let heard = { dice: null, log: null, houses: 0, jailed: '' };

  function sounds(s) {
    if (!window.SFX || s.phase !== 'play') return;

    const dice = s.dice ? s.dice.join('-') : null;
    if (dice && dice !== heard.dice) SFX.dice();
    heard.dice = dice;

    // Le journal est la seule source qui dise ce qui vient de se passer,
    // pour tout le monde à la fois.
    const top = s.log && s.log[0] ? s.log[0].text : null;
    if (top && top !== heard.log) {
      if (/paie|touche|achète|\+200/.test(top)) SFX.cash();
      heard.log = top;
    }

    const houses = s.cells.reduce((n, c) => n + (c.houses || 0), 0);
    if (houses > heard.houses) SFX.build();
    heard.houses = houses;

    const jailed = s.players.filter((p) => p.jail).map((p) => p.id).sort().join(',');
    if (jailed && jailed !== heard.jailed) SFX.jail();
    heard.jailed = jailed;
  }

  function render(s) {
    state = s;
    // Spectateur : le bandeau le dit, et les commandes du salon
    // disparaissent — on ne lance pas une partie qu'on regarde.
    PZ.watchBanner(s);
    $('#view-mono').classList.toggle('watching', Boolean(s.watching));
    $('#mono-code').textContent = s.code;
    $('#mono-phase').textContent = PHASE_TEXT[s.phase] || s.phase;

    const host = s.hostId === s.you.id;
    $('#mono-start').classList.toggle('hidden', !(host && (s.phase === 'lobby' || s.phase === 'over')));
    $('#mono-settings').classList.toggle('hidden', !(host && s.phase === 'lobby'));

    // Les réglages reflètent l'état du serveur, pas le dernier clic : à
    // deux hôtes successifs, c'est la seule façon d'être d'accord.
    [...$('#mono-laps').children].forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.laps) === s.lapsTarget);
    });
    $('#mono-laps-hint').textContent = s.lapsTarget
      ? `Au bout de ${s.lapsTarget} tours de table, le plus riche gagne.`
      : 'Partie illimitée : on joue jusqu’à ce qu’il n’en reste qu’un.';
    $('#mono-doublego').checked = Boolean(s.doubleGo);
    $('#mono-auctions').checked = Boolean(s.auctions);

    renderBoard(s);
    renderSeats(s);
    renderMiddle(s);
    renderActions(s);
    renderDeeds(s);
    renderLog(s);
    renderBar(s);
    sounds(s);
    PZ.roomChat($('#mono-chat'), s.chat);

    if (s.phase === 'over' && s.result) showResult(s);
  }

  let shownResult = null;
  function showResult(s) {
    if (shownResult === s.result) return;
    shownResult = s.result;

    const box = el('div', 'mono-result');
    box.appendChild(el('h2', null, s.result.reason === 'tours'
      ? `Fin des ${s.result.laps} tours`
      : 'Il ne reste qu’un joueur debout'));

    const list = el('ol', 'mono-final');
    s.result.table.forEach((row, k) => {
      const li = el('li', s.result.winnerIds.includes(row.id) ? 'top' : null);
      li.appendChild(el('span', 'mono-final-rank', String(k + 1)));
      li.appendChild(el('b', null, row.name));
      li.appendChild(el('i', null, row.out ? 'faillite' : `${fmt(row.money)} ¤ en caisse`));
      li.appendChild(el('em', null, `${fmt(row.worth)} ¤`));
      list.appendChild(li);
    });
    box.appendChild(list);
    box.appendChild(el('p', 'mono-hint', 'La fortune compte l’argent, les terrains et les constructions.'));
    PZ.openModal(box);
  }

  /* ═══════════ Branchement ═══════════ */

  $('#mono-start').addEventListener('click', () => PZ.socket.emit('party:start'));
  $('#mono-leave').addEventListener('click', () => {
    PZ.socket.emit('party:leave');
    PZ.go('party');
  });
  $('#mono-code').addEventListener('click', async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.code);
      PZ.toast('Code copié — envoie-le à tes potes.', 'success');
    } catch {
      PZ.toast(`Le code est : ${state.code}`, 'info');
    }
  });
  $('#mono-laps').addEventListener('click', (e) => {
    const b = e.target.closest('[data-laps]');
    if (b) PZ.socket.emit('mono:configure', { laps: Number(b.dataset.laps) });
  });
  $('#mono-doublego').addEventListener('change', (e) => {
    PZ.socket.emit('mono:configure', { doubleGo: e.target.checked });
  });
  $('#mono-auctions').addEventListener('change', (e) => {
    PZ.socket.emit('mono:configure', { auctions: e.target.checked });
  });
  $('#mono-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#mono-chat-input');
    if (!input.value.trim()) return;
    PZ.socket.emit('party:say', { text: input.value });
    input.value = '';
  });


  // La barre de réactions, sous le chat du salon, et le repère qui dit
  // au-dessus de quel siège afficher la bulle.
  PZ.seatFinder['mono'] = (id) => document.querySelector(`#mono-seats .mono-seat[data-who="${id}"]`);
  $('#mono-chat-form').parentElement.appendChild(PZ.reactionBar());

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__monoBound) return;
    socket.__monoBound = true;
    socket.on('mono:state', render);
  }

  PZ.views.mono = {
    enter() { bind(); },
    leave() {
      if (barRaf) cancelAnimationFrame(barRaf);
      barRaf = null;
      void tradeWith;
    },
  };
})();
