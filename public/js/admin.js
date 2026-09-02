'use strict';
/**
 * Panel d'administration.
 *
 * Tout ce qui est affiché ici est cosmétique : le serveur revérifie les
 * droits à chaque action. Masquer un bouton n'a jamais protégé personne.
 */

(() => {
  const { $, fmt, el } = PZ;

  const root = $('#admin-root');
  let query = { query: '', sort: 'coins' };
  let refreshTimer = null;

  /* ─── Réclamation des droits ─── */

  function renderClaim(keyConfigured) {
    root.replaceChildren();
    const panel = el('div', 'panel');
    panel.appendChild(el('h2', null, 'Accès réservé'));

    if (!keyConfigured) {
      panel.appendChild(el('p', 'fine', 'Aucune clé administrateur n’est configurée sur ce serveur. Ajoute la variable d’environnement ADMIN_KEY chez ton hébergeur (une phrase longue), redéploie, puis reviens ici.'));
      root.appendChild(panel);
      return;
    }

    panel.appendChild(el('p', 'fine', 'Saisis la clé ADMIN_KEY définie chez ton hébergeur. Une seule fois : le droit reste attaché à ton compte.'));
    const form = el('form', 'auth-guest');
    form.style.marginTop = '14px';
    const input = el('input', 'input');
    input.type = 'password';
    input.placeholder = 'Clé administrateur';
    form.appendChild(input);
    const submit = el('button', 'btn btn-green', 'Valider');
    form.appendChild(submit);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      PZ.socket.emit('admin:claim', { key: input.value });
      input.value = '';
    });
    panel.appendChild(form);
    root.appendChild(panel);
  }

  /* ─── Tableau de bord ─── */

  function stat(value, label) {
    const node = el('div', 'adm-stat');
    node.appendChild(el('b', null, value));
    node.appendChild(el('span', null, label));
    return node;
  }

  let cases = [];

  function render(data) {
    const s = data.stats;
    if (data.cases) cases = data.cases;
    root.replaceChildren();

    const grid = el('div', 'adm-grid');
    grid.appendChild(stat(fmt(s.players), 'joueurs'));
    grid.appendChild(stat(fmt(s.online), 'en ligne'));
    grid.appendChild(stat(fmt(s.tables), 'tables ouvertes'));
    grid.appendChild(stat(fmt(s.totalCoins), 'pièces en circulation'));
    grid.appendChild(stat(fmt(s.rounds), 'manches jouées'));
    grid.appendChild(stat(s.realRtp === null ? '—' : `${String(s.realRtp).replace('.', ',')} %`, 'redistribution réelle'));
    grid.appendChild(stat(fmt(s.totalOpened), 'caisses ouvertes'));
    grid.appendChild(stat(fmt(s.banned), 'bannis'));
    grid.appendChild(stat(`${s.uptime}s`, 'en service'));
    grid.appendChild(stat(`${s.memoryMb} Mo`, 'mémoire'));
    grid.appendChild(stat(s.storage, 'stockage'));
    grid.appendChild(stat(s.discord ? 'oui' : 'non', 'Discord configuré'));
    root.appendChild(grid);

    if (data.gate) root.appendChild(renderGate(data.gate));
    root.appendChild(renderPlayers({ total: data.total, players: data.players || [] }));
    root.appendChild(renderTables(data.tables || []));
    root.appendChild(renderLedger(data.ledger));
    root.appendChild(renderMarket(data.market || []));
    root.appendChild(renderLog(data.log || []));
    root.appendChild(renderBroadcast());
  }

  /* ─── Joueurs ─── */

  function renderPlayers(list) {
    const panel = el('div', 'panel');
    panel.style.marginTop = '12px';

    const head = el('div', 'panel-head');
    head.appendChild(el('h2', null, `Joueurs (${list.total})`));

    const tools = el('div', 'lobby-join');
    const search = el('input', 'input');
    search.placeholder = 'Chercher un pseudo ou un identifiant';
    search.value = query.query;
    search.style.width = '260px';
    search.addEventListener('change', () => { query.query = search.value.trim(); load(); });
    tools.appendChild(search);

    const sort = el('select', 'input');
    [['coins', 'Pièces'], ['xp', 'XP'], ['recent', 'Récents'], ['name', 'Nom']].forEach(([v, label]) => {
      const opt = el('option', null, label);
      opt.value = v;
      if (query.sort === v) opt.selected = true;
      sort.appendChild(opt);
    });
    sort.addEventListener('change', () => { query.sort = sort.value; load(); });
    tools.appendChild(sort);
    head.appendChild(tools);
    panel.appendChild(head);

    const scroll = el('div', 'adm-scroll');
    const table = el('table', 'adm-table');
    const thead = el('thead');
    const tr = el('tr');
    ['Joueur', 'Niveau', 'Pièces', 'Misé', 'Collection', 'Actions'].forEach((h) => tr.appendChild(el('th', null, h)));
    thead.appendChild(tr);
    table.appendChild(thead);

    const tbody = el('tbody');
    list.players.forEach((p) => tbody.appendChild(playerRow(p)));
    table.appendChild(tbody);
    scroll.appendChild(table);
    panel.appendChild(scroll);
    return panel;
  }

  function playerRow(p) {
    const row = el('tr');

    const cell = el('td');
    const who = el('div', 'adm-who');
    const img = new Image(26, 26);
    img.src = PZ.avatarUrl(p);
    img.alt = '';
    who.appendChild(img);
    who.appendChild(el('span', null, p.name));
    if (p.admin) who.appendChild(el('span', 'tag admin', p.envAdmin ? 'ADMIN·ENV' : 'ADMIN'));
    if (p.banned) who.appendChild(el('span', 'tag ban', 'BANNI'));
    cell.appendChild(who);
    row.appendChild(cell);

    row.appendChild(el('td', null, `${p.level} · ${p.title}`));
    row.appendChild(el('td', null, fmt(p.coins)));
    row.appendChild(el('td', null, fmt(p.wagered)));
    row.appendChild(el('td', null, `${p.collected}/${p.collectionTotal}`));

    const acts = el('td');
    const box = el('div', 'adm-acts');

    const act = (label, className, handler) => {
      const btn = el('button', `btn-mini ${className || ''}`.trim(), label);
      btn.addEventListener('click', handler);
      box.appendChild(btn);
    };

    act('+1k ¤', '', () => send('grant-coins', { id: p.id, amount: 1000 }));
    act('+500 XP', '', () => send('grant-xp', { id: p.id, amount: 500 }));
    act('🎁 Caisses', '', () => giveCases(p));
    act('✏️ Renommer', '', () => {
      const wanted = prompt(`Nouveau pseudo pour ${p.name} ?`, p.name);
      if (wanted === null) return;
      send('rename', { id: p.id, name: wanted.trim() });
    });
    act(p.banned ? 'Débannir' : 'Bannir', p.banned ? '' : 'danger', () => {
      if (p.banned) return send('unban', { id: p.id });
      const reason = prompt(`Raison du bannissement de ${p.name} ?`, 'Comportement inapproprié.');
      if (reason === null) return;
      send('ban', { id: p.id, reason });
    });
    if (!p.envAdmin) {
      act(p.admin ? 'Retirer admin' : 'Passer admin', '', () => send('set-admin', { id: p.id, value: !p.admin }));
    }
    act('Réinitialiser', 'danger', () => {
      if (confirm(`Remettre ${p.name} à zéro ? Pièces, collection, mine et XP seront effacés.`)) send('reset', { id: p.id });
    });
    act('Supprimer', 'danger', () => {
      if (confirm(`Supprimer définitivement le profil de ${p.name} ?`)) send('delete', { id: p.id });
    });

    acts.appendChild(box);
    row.appendChild(acts);
    return row;
  }

  /**
   * Distribuer des caisses à un joueur.
   *
   * L'administration ne paie rien — c'est le principe — donc la fenêtre
   * rappelle ce que ça vaut, histoire qu'on sache ce qu'on injecte dans
   * l'économie du site avant de valider.
   */
  function giveCases(p) {
    const box = el('div', 'adm-give');
    box.appendChild(el('h2', null, `Offrir des caisses à ${p.name}`));

    const select = el('select', 'input');
    cases.forEach((c) => {
      const opt = el('option', null, `${c.emoji} ${c.name} — ${fmt(c.price)} ¤ pièce`);
      opt.value = c.id;
      select.appendChild(opt);
    });

    const count = el('input', 'input');
    count.type = 'number';
    count.value = '1';
    count.min = '1';
    count.max = '50';

    const row = el('div', 'gift-form');
    row.appendChild(select);
    row.appendChild(count);
    box.appendChild(row);

    const worth = el('p', 'fine', '');
    const refresh = () => {
      const c = cases.find((x) => x.id === select.value);
      const n = Math.max(1, Math.min(50, Number(count.value) || 1));
      worth.textContent = c
        ? `Soit ${fmt(c.price * n)} pièces offertes, créées de rien. Le joueur reçoit un bon et l’ouvre quand il veut.`
        : '';
    };
    select.addEventListener('change', refresh);
    count.addEventListener('input', refresh);
    refresh();
    box.appendChild(worth);

    const actions = el('div', 'adm-give-acts');
    const ok = el('button', 'btn btn-gold', 'Envoyer');
    ok.addEventListener('click', () => {
      send('grant-case', {
        id: p.id,
        caseId: select.value,
        count: Math.max(1, Math.min(50, Number(count.value) || 1)),
      });
      PZ.closeModal();
    });
    const cancel = el('button', 'btn btn-soft', 'Annuler');
    cancel.addEventListener('click', PZ.closeModal);
    actions.appendChild(ok);
    actions.appendChild(cancel);
    box.appendChild(actions);

    PZ.openModal(box);
  }

  /* ─── Tables de blackjack ─── */

  function renderTables(tables) {
    const panel = el('div', 'panel');
    panel.style.marginTop = '12px';
    const head = el('div', 'panel-head');
    head.appendChild(el('h2', null, `Tables de blackjack (${tables.length})`));
    panel.appendChild(head);

    if (!tables.length) {
      panel.appendChild(el('div', 'empty', 'Aucune table ouverte.'));
      return panel;
    }

    const scroll = el('div', 'adm-scroll');
    const table = el('table', 'adm-table');
    const thead = el('thead');
    const tr = el('tr');
    ['Code', 'Hôte', 'Joueurs', 'Phase', 'Main', ''].forEach((h) => tr.appendChild(el('th', null, h)));
    thead.appendChild(tr);
    table.appendChild(thead);

    const tbody = el('tbody');
    tables.forEach((t) => {
      const row = el('tr');
      row.appendChild(el('td', null, t.code));
      row.appendChild(el('td', null, t.host));
      row.appendChild(el('td', null, `${t.humans}/5`));
      row.appendChild(el('td', null, t.phase));
      row.appendChild(el('td', null, String(t.hand)));
      const cell = el('td');
      const btn = el('button', 'btn-mini danger', 'Fermer');
      btn.addEventListener('click', () => send('close-table', { code: t.code }));
      cell.appendChild(btn);
      row.appendChild(cell);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    panel.appendChild(scroll);
    return panel;
  }

  /* ─── Économie ─── */

  /**
   * Le registre : ce que le site fabrique et ce qu'il détruit.
   *
   * La ligne qui compte est le NET. S'il est positif tous les jours, la
   * masse monétaire gonfle, et au bout de quelques mois plus rien n'a de
   * valeur — une caisse à 500 pièces ne veut rien dire quand tout le monde
   * en a deux millions. C'est le seul tableau du panel qu'il faut regarder
   * une fois par semaine.
   *
   * Les jeux n'apparaissent pas en « créé » ou « détruit » : une mise
   * n'est ni l'un ni l'autre, elle est risquée. Ce qu'on compte pour eux,
   * c'est le solde — et la redistribution réellement observée, qui doit
   * coller au chiffre affiché sur leur tuile.
   */
  function renderLedger(led) {
    const panel = el('div', 'panel');
    panel.style.marginTop = '12px';
    const head = el('div', 'panel-head');
    head.appendChild(el('h2', null, 'Économie'));
    head.appendChild(el('span', 'section-meta', 'Pièces créées et détruites — les 14 derniers jours'));
    panel.appendChild(head);

    if (!led || !led.daily || !led.daily.length) {
      panel.appendChild(el('div', 'empty', 'Rien d’enregistré pour l’instant. Le registre se remplit dès qu’on joue.'));
      return panel;
    }

    // Le bilan en trois chiffres, dont un seul compte vraiment.
    const grid = el('div', 'adm-grid');
    grid.appendChild(stat(fmt(led.total.mint), 'pièces créées'));
    grid.appendChild(stat(fmt(led.total.burn), 'pièces détruites'));
    const net = stat(`${led.total.net > 0 ? '+' : ''}${fmt(led.total.net)}`, 'création nette');
    net.classList.add(led.total.net > 0 ? 'bad' : 'good');
    grid.appendChild(net);
    panel.appendChild(grid);

    // La courbe : une barre par jour, au-dessus ou en dessous de zéro.
    const peak = Math.max(1, ...led.daily.map((d) => Math.abs(d.net)));
    const chart = el('div', 'led-chart');
    led.daily.forEach((d) => {
      const col = el('div', `led-day${d.net > 0 ? ' up' : ' down'}`);
      const bar = el('span');
      bar.style.height = `${Math.max(2, Math.round((Math.abs(d.net) / peak) * 100))}%`;
      col.appendChild(bar);
      col.dataset.tip = `${d.day} — ${d.net > 0 ? '+' : ''}${fmt(d.net)} (créé ${fmt(d.mint)}, détruit ${fmt(d.burn)})`;
      col.appendChild(el('i', null, d.day.slice(8)));
      chart.appendChild(col);
    });
    panel.appendChild(chart);

    const scroll = el('div', 'adm-scroll');
    const table = el('table', 'adm-table');
    const thead = el('thead');
    const tr = el('tr');
    ['Source', 'Créé', 'Détruit', 'Net', 'Misé', 'Manches', 'RTP réel'].forEach((h) => tr.appendChild(el('th', null, h)));
    thead.appendChild(tr);
    table.appendChild(thead);

    const tbody = el('tbody');
    led.sources.forEach((sv) => {
      const row = el('tr');
      row.appendChild(el('td', null, sv.source));
      row.appendChild(el('td', null, sv.mint ? fmt(sv.mint) : '—'));
      row.appendChild(el('td', null, sv.burn ? fmt(sv.burn) : '—'));
      const n = el('td', null, `${sv.net > 0 ? '+' : ''}${fmt(sv.net)}`);
      n.style.color = sv.net > 0 ? 'var(--lose)' : 'var(--win)';
      row.appendChild(n);
      row.appendChild(el('td', null, sv.staked ? fmt(sv.staked) : '—'));
      row.appendChild(el('td', null, sv.rounds ? fmt(sv.rounds) : '—'));
      row.appendChild(el('td', null, sv.rtp === null ? '—' : `${String(sv.rtp).replace('.', ',')} %`));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    panel.appendChild(scroll);

    // La sauvegarde, au même endroit : c'est le geste qu'on fait quand on
    // vient de regarder les chiffres et qu'ils font peur.
    const foot = el('div', 'led-foot');
    const dl = el('a', 'btn btn-soft', '⤓ Exporter toute la base en JSON');
    dl.href = '/api/admin/export';
    dl.setAttribute('download', '');
    foot.appendChild(dl);
    foot.appendChild(el('span', 'section-meta',
      'Profils, collections, marché, registre — tout, dans un fichier. À garder de côté avant une grosse mise à jour.'));
    panel.appendChild(foot);

    return panel;
  }

  /* ─── Marché ─── */

  /**
   * Les offres en vitrine, la plus surévaluée en tête.
   *
   * Le rapport au prix de revente automatique est la colonne qui compte :
   * une bricole affichée à cinquante fois sa valeur n'est pas une vente,
   * c'est un transfert de pièces entre deux comptes qui se connaissent.
   * Retirer l'offre rend l'objet à son vendeur — on ne confisque rien.
   */
  function renderMarket(listings) {
    const panel = el('div', 'panel');
    panel.style.marginTop = '12px';
    const head = el('div', 'panel-head');
    head.appendChild(el('h2', null, `Marché (${listings.length} offre${listings.length > 1 ? 's' : ''})`));
    head.appendChild(el('span', 'section-meta', 'Triées par rapport au prix de revente : les plus douteuses en haut.'));
    panel.appendChild(head);

    if (!listings.length) {
      panel.appendChild(el('div', 'empty', 'Aucune offre en vente.'));
      return panel;
    }

    const scroll = el('div', 'adm-scroll');
    const table = el('table', 'adm-table');
    const thead = el('thead');
    const tr = el('tr');
    ['Objet', 'Rareté', 'Vendeur', 'Prix', '×', 'Valeur', ''].forEach((h) => tr.appendChild(el('th', null, h)));
    thead.appendChild(tr);
    table.appendChild(thead);

    const tbody = el('tbody');
    listings.forEach((l) => {
      const row = el('tr');

      const nameCell = el('td');
      nameCell.appendChild(el('span', null, `${l.emoji} ${l.name}`));
      row.appendChild(nameCell);

      const rarity = el('td', null, l.rarity);
      rarity.style.color = l.color;
      row.appendChild(rarity);

      row.appendChild(el('td', null, l.seller || '—'));
      row.appendChild(el('td', null, `${fmt(l.price)} ¤`));
      row.appendChild(el('td', null, String(l.count)));

      // « ×3,4 » se lit d'un coup ; au-delà de dix fois la valeur, on le
      // signale en rouge sans rien décider à la place de l'administrateur.
      const ratio = el('td', null, l.ratio === null ? '—' : `×${String(l.ratio).replace('.', ',')}`);
      if (l.ratio !== null && l.ratio >= 10) ratio.style.color = 'var(--lose)';
      row.appendChild(ratio);

      const cell = el('td');
      const btn = el('button', 'btn-mini danger', 'Retirer');
      btn.title = 'Retire l’offre et rend l’objet à son vendeur';
      btn.addEventListener('click', () => send('market-remove', { listingId: l.id }));
      cell.appendChild(btn);
      row.appendChild(cell);

      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    panel.appendChild(scroll);
    return panel;
  }

  /* ─── Journal & annonce ─── */

  function renderLog(log) {
    const panel = el('div', 'panel');
    panel.style.marginTop = '12px';
    const head = el('div', 'panel-head');
    head.appendChild(el('h2', null, 'Journal des actions'));
    panel.appendChild(head);

    const list = el('ul', 'adm-log');
    if (!log.length) list.appendChild(el('li', null, 'Rien encore.'));
    log.forEach((entry) => {
      const li = el('li');
      const time = el('time', null, new Date(entry.at).toLocaleTimeString('fr-FR'));
      li.appendChild(time);
      li.appendChild(el('span', null, `${entry.actor} → ${entry.action} · ${entry.target}${entry.detail ? ` (${entry.detail})` : ''}`));
      list.appendChild(li);
    });
    panel.appendChild(list);
    return panel;
  }

  /* ─── L'ouverture du site ─── */

  /**
   * L'interrupteur de la porte.
   *
   * Il est en haut du panel, avant même la liste des joueurs, parce que
   * c'est la seule commande dont on a besoin dans l'urgence : le jour de
   * l'ouverture, et le jour où quelque chose casse.
   *
   * Il dit toujours l'état RÉEL en premier (ouvert / fermé), avant de
   * proposer de le changer. Un interrupteur qui n'affiche que ses trois
   * boutons oblige à deviner dans quelle position il se trouve.
   */
  function renderGate(gate) {
    const panel = el('div', 'panel');
    const head = el('div', 'panel-head');
    head.appendChild(el('h2', null, 'Ouverture du site'));

    const badge = el('span', `gate-state ${gate.open ? 'on' : 'off'}`,
      gate.open ? 'Ouvert' : 'Fermé au public');
    head.appendChild(badge);
    panel.appendChild(head);

    const when = new Date(gate.opensAt).toLocaleString('fr-FR', {
      dateStyle: 'full', timeStyle: 'short',
    });
    panel.appendChild(el('p', 'fine',
      gate.mode === 'auto'
        ? `Le site s’ouvrira tout seul le ${when}. Personne n’a besoin d’être devant l’écran.`
        : gate.mode === 'open'
          ? `Ouverture forcée : la date du ${when} est ignorée.`
          : `Fermeture forcée : seule la clé d’administration passe, quelle que soit l’heure.`));

    const row = el('div', 'gate-modes');
    [
      ['auto', 'Automatique', 'ouvre à la date prévue'],
      ['open', 'Ouvrir maintenant', 'tout le monde entre'],
      ['closed', 'Fermer', 'compte à rebours pour tous'],
    ].forEach(([mode, label, note]) => {
      const b = el('button', `gate-mode${gate.mode === mode ? ' on' : ''}`);
      b.appendChild(el('b', null, label));
      b.appendChild(el('span', null, note));
      b.addEventListener('click', () => send('site-gate', { mode }));
      row.appendChild(b);
    });
    panel.appendChild(row);

    const form = el('form', 'gate-when');
    const input = el('input', 'input');
    input.type = 'datetime-local';
    // La valeur d'un champ datetime-local est de l'heure LOCALE sans fuseau :
    // on retire donc le décalage avant de la formater, sinon le champ
    // afficherait l'heure de Greenwich à quelqu'un qui est à Paris.
    const d = new Date(gate.opensAt);
    input.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    form.appendChild(input);
    form.appendChild(el('button', 'btn btn-soft', 'Changer la date'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value) return;
      send('site-gate', { mode: 'auto', opensAt: new Date(input.value).getTime() });
    });
    panel.appendChild(form);

    return panel;
  }

  function renderBroadcast() {
    const panel = el('div', 'panel');
    panel.style.marginTop = '12px';
    const head = el('div', 'panel-head');
    head.appendChild(el('h2', null, 'Annonce à tout le site'));
    panel.appendChild(head);

    const form = el('form', 'auth-guest');
    const input = el('input', 'input');
    input.placeholder = 'Maintenance dans 10 minutes…';
    input.maxLength = 200;
    form.appendChild(input);
    form.appendChild(el('button', 'btn btn-green', 'Envoyer'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      send('announce', { text: input.value.trim() });
      input.value = '';
    });
    panel.appendChild(form);
    return panel;
  }

  /* ─── Réseau ─── */

  function send(action, payload) {
    PZ.socket.emit('admin:action', { action, payload, query });
  }

  function load() {
    PZ.socket.emit('admin:open', query);
  }

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__admBound) return;
    socket.__admBound = true;

    socket.on('admin:state', (data) => {
      if (data.denied) {
        renderClaim(data.keyConfigured);
        return;
      }
      render(data);
    });
  }

  PZ.views.admin = {
    async enter() {
      bind();
      if (!PZ.profile || !PZ.profile.admin) {
        try {
          const cfg = await (await fetch('/api/admin-config')).json();
          renderClaim(cfg.keyConfigured);
        } catch {
          renderClaim(false);
        }
        return;
      }
      load();
      // Le serveur pousse les changements ; ce battement n'est qu'un filet
      // de sécurité pour les compteurs qui bougent tout seuls (mémoire,
      // durée de fonctionnement).
      refreshTimer = setInterval(load, 20000);
    },
    leave() {
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = null;
      if (PZ.socket) PZ.socket.emit('admin:close');
    },
  };
})();
