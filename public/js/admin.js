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

  function render(data) {
    const s = data.stats;
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

    root.appendChild(renderPlayers({ total: data.total, players: data.players || [] }));
    root.appendChild(renderTables(data.tables || []));
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

    act('+1k 🪙', '', () => send('grant-coins', { id: p.id, amount: 1000 }));
    act('+500 XP', '', () => send('grant-xp', { id: p.id, amount: 500 }));
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
