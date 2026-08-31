/* ══════════════════════════════════════════════════════════
   Panel d'administration — rendu client.

   Toutes les actions repassent par le serveur, qui revérifie
   les droits : masquer un bouton ici ne protège rien, et ce
   n'est pas ce qui protège.
   ══════════════════════════════════════════════════════════ */
window.PZAdmin = (() => {
  let socket = null;
  let state = null;
  let selectedId = null;
  let query = { query: '', sort: 'xp' };

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => window.PZ.util.esc(s);
  const avatar = (p, size) => window.PZ.util.avatar(p, size);

  function init(sock) {
    socket = sock;
    socket.on('admin:state', (payload) => {
      state = payload;
      if (payload.query) query = { ...query, ...payload.query };
      render();
    });
  }

  function open() {
    if (!socket) return;
    socket.emit('admin:open', query);
    if (!state) $('#admin-root').innerHTML = '<div class="stage"><p class="muted">Chargement du panel…</p></div>';
  }

  function close() {}

  function act(action, payload = {}) {
    socket.emit('admin:action', { action, payload, query });
  }

  function refresh() {
    socket.emit('admin:open', query);
  }

  /* ─── Rendu ─────────────────────────────────────────── */

  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function fmtUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h ? `${h} h ${m} min` : `${m} min`;
  }

  function render() {
    if (!state) return;
    const s = state.stats;
    const selected = state.players.find((p) => p.id === selectedId);

    $('#admin-root').innerHTML = `
      <div class="admin-head">
        <div>
          <span class="eyebrow">Administration</span>
          <h2>Panel</h2>
        </div>
        <button class="btn btn-soft btn-sm" data-act="refresh">↻ Rafraîchir</button>
      </div>

      <div class="admin-stats">
        ${tile('👥', s.players, 'Joueurs')}
        ${tile('🟢', s.online, 'En ligne')}
        ${tile('🚪', s.rooms, 'Salons actifs')}
        ${tile('🎮', s.totalGames, 'Parties jouées')}
        ${tile('📦', s.totalOpened, 'Caisses ouvertes')}
        ${tile('⭐', s.totalXp.toLocaleString('fr-FR'), 'XP distribuée')}
        ${tile('⛔', s.banned, 'Bannis')}
        ${tile('🛡️', s.admins, 'Admins')}
      </div>

      <div class="admin-grid">
        <div class="admin-col">
          <section class="panel">
            <header class="panel-head">
              <h2>Annonce</h2>
              <span class="panel-note">Envoyée à tout le monde, tout de suite</span>
            </header>
            <form class="row" data-form="announce">
              <input class="input" id="ann-text" maxlength="200" placeholder="Soirée blind test à 21h, ramenez vos playlists" style="flex:3">
              <button class="btn btn-primary" type="submit" style="flex:0 0 auto">Envoyer</button>
            </form>
          </section>

          <section class="panel">
            <header class="panel-head">
              <h2>Salons actifs</h2>
              <span class="panel-note">${state.rooms.length} ouvert${state.rooms.length > 1 ? 's' : ''}</span>
            </header>
            ${state.rooms.length ? `
              <div class="table-scroll">
                <table class="admin-table">
                  <thead><tr><th>Code</th><th>Hôte</th><th class="ta-c">Joueurs</th><th>Jeu</th><th></th></tr></thead>
                  <tbody>
                    ${state.rooms.map((r) => `<tr>
                      <td><b class="mono">${esc(r.code)}</b></td>
                      <td>${esc(r.host)}</td>
                      <td class="ta-c">${r.connected}/${r.players}</td>
                      <td>${r.game ? `${esc(r.game)} <span class="fine">(${esc(r.phase || '')})</span>` : '<span class="fine">salon</span>'}</td>
                      <td class="ta-r"><button class="btn btn-soft btn-xs" data-close="${esc(r.code)}">Fermer</button></td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>` : '<p class="fine">Aucun salon ouvert pour le moment.</p>'}
          </section>

          <section class="panel">
            <header class="panel-head">
              <h2>Joueurs</h2>
              <span class="panel-note">${state.total} au total</span>
            </header>
            <div class="row" style="margin-bottom:12px">
              <input class="input" id="adm-search" placeholder="Chercher un pseudo ou un identifiant…" value="${esc(query.query || '')}" style="flex:3">
              <select class="input" id="adm-sort" style="flex:1;min-width:150px">
                <option value="xp" ${query.sort === 'xp' ? 'selected' : ''}>Trier par XP</option>
                <option value="recent" ${query.sort === 'recent' ? 'selected' : ''}>Plus récents</option>
                <option value="coins" ${query.sort === 'coins' ? 'selected' : ''}>Plus riches</option>
                <option value="name" ${query.sort === 'name' ? 'selected' : ''}>Alphabétique</option>
              </select>
            </div>
            <div class="table-scroll admin-players-scroll">
              <table class="admin-table">
                <thead><tr><th>Joueur</th><th class="ta-c">Niv.</th><th class="ta-r">XP</th><th class="ta-r">Pièces</th><th class="ta-c">Collection</th></tr></thead>
                <tbody>
                  ${state.players.map((p) => `<tr class="${p.id === selectedId ? 'sel' : ''} ${p.banned ? 'banned' : ''}" data-player="${esc(p.id)}">
                    <td><span class="who">${avatar(p, 'sm')}<span><b>${esc(p.name)}${p.admin ? ' 🛡️' : ''}${p.banned ? ' ⛔' : ''}</b><span>${p.provider === 'discord' ? 'Discord' : 'Invité'}</span></span></span></td>
                    <td class="ta-c lvl-cell">${p.level}</td>
                    <td class="ta-r xp-cell">${p.xp.toLocaleString('fr-FR')}</td>
                    <td class="ta-r">${p.coins.toLocaleString('fr-FR')}</td>
                    <td class="ta-c fine">${p.collected}/${p.collectionTotal}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
            ${state.players.length ? '' : '<p class="fine">Aucun joueur ne correspond.</p>'}
          </section>
        </div>

        <div class="admin-col">
          ${selected ? playerCard(selected) : `
            <section class="panel">
              <header class="panel-head"><h2>Fiche joueur</h2></header>
              <p class="fine">Clique sur une ligne du tableau pour agir sur un joueur.</p>
            </section>`}

          <section class="panel">
            <header class="panel-head"><h2>Serveur</h2></header>
            <div class="kv">
              <div><span>Stockage</span><b>${esc(s.storage)}</b></div>
              <div><span>Discord</span><b>${s.discord ? 'configuré' : 'non configuré'}</b></div>
              <div><span>Clé admin</span><b>${s.adminKey ? 'configurée' : 'absente'}</b></div>
              <div><span>Mémoire</span><b>${s.memoryMb} Mo</b></div>
              <div><span>En marche depuis</span><b>${fmtUptime(s.uptime)}</b></div>
            </div>
            ${s.storage === 'fichier JSON' ? `
              <p class="fine" style="margin-top:10px;color:var(--warn)">
                ⚠ Sans base de données, tout est perdu au prochain redéploiement.
                Ajoute une variable <code>DATABASE_URL</code>.
              </p>` : ''}
          </section>

          <section class="panel">
            <header class="panel-head"><h2>Journal</h2></header>
            <div class="log-list">
              ${state.log.length
                ? state.log.slice(0, 14).map((l) => `<div class="log-row">
                    <span class="fine">${fmtDate(l.at)}</span>
                    <span><b>${esc(l.actor)}</b> — ${esc(l.action)} <i>${esc(l.target)}</i>
                    ${l.detail ? `<span class="fine">${esc(l.detail)}</span>` : ''}</span>
                  </div>`).join('')
                : '<p class="fine">Rien pour l’instant.</p>'}
            </div>
          </section>
        </div>
      </div>`;

    wire();
  }

  function tile(icon, value, label) {
    return `<div class="admin-tile"><i>${icon}</i><b>${value}</b><span>${label}</span></div>`;
  }

  function playerCard(p) {
    return `<section class="panel player-card">
      <header class="panel-head"><h2>Fiche joueur</h2></header>
      <div class="pc-head">
        ${avatar(p, 'lg')}
        <div>
          <b>${esc(p.name)}</b>
          <span class="fine">${p.provider === 'discord' ? 'Compte Discord' : 'Invité'} · niveau ${p.level} · ${esc(p.title)}</span>
          <span class="fine mono">${esc(p.id)}</span>
        </div>
      </div>

      <div class="kv">
        <div><span>XP</span><b>${p.xp.toLocaleString('fr-FR')}</b></div>
        <div><span>Pièces</span><b>${p.coins.toLocaleString('fr-FR')}</b></div>
        <div><span>Parties</span><b>${p.games} (${p.wins} gagnées)</b></div>
        <div><span>Caisses</span><b>${p.opened}</b></div>
        <div><span>Collection</span><b>${p.collected}/${p.collectionTotal}</b></div>
        <div><span>Inscrit le</span><b>${fmtDate(p.createdAt)}</b></div>
        <div><span>Vu le</span><b>${fmtDate(p.updatedAt)}</b></div>
      </div>

      ${p.banned ? `<p class="banner">⛔ Banni — ${esc(p.banReason)}</p>` : ''}
      ${p.envAdmin ? '<p class="fine">Admin via la variable ADMIN_IDS : le droit ne peut pas être retiré ici.</p>' : ''}

      <div class="field">
        <label>Ajuster</label>
        <div class="row">
          <input class="input" id="pc-amount" type="number" value="100" step="10" style="min-width:100px">
          <button class="btn btn-soft btn-sm" data-act="grant-xp">± XP</button>
          <button class="btn btn-soft btn-sm" data-act="grant-coins">± Pièces</button>
        </div>
        <p class="fine">Un nombre négatif retire.</p>
      </div>

      <div class="field">
        <label>Modération</label>
        <div class="row">
          ${p.banned
            ? '<button class="btn btn-soft btn-sm" data-act="unban">Débannir</button>'
            : '<button class="btn btn-danger btn-sm" data-act="ban">Bannir</button>'}
          <button class="btn btn-soft btn-sm" data-act="set-admin" data-value="${p.admin ? '0' : '1'}">
            ${p.admin ? 'Retirer admin' : 'Passer admin'}
          </button>
        </div>
        ${p.banned ? '' : '<input class="input" id="pc-reason" placeholder="Motif du bannissement (optionnel)" maxlength="140">'}
      </div>

      <div class="field">
        <label>Zone rouge</label>
        <div class="row">
          <button class="btn btn-soft btn-sm" data-act="reset" data-confirm="Remettre ${esc(p.name)} à zéro (XP, stats, collection) ?">Réinitialiser</button>
          <button class="btn btn-danger btn-sm" data-act="delete" data-confirm="Supprimer définitivement le profil de ${esc(p.name)} ?">Supprimer</button>
        </div>
      </div>
    </section>`;
  }

  /* ─── Interactions ──────────────────────────────────── */

  function wire() {
    const root = $('#admin-root');

    root.querySelector('[data-act="refresh"]').addEventListener('click', refresh);

    root.querySelectorAll('[data-player]').forEach((tr) => {
      tr.addEventListener('click', () => {
        selectedId = selectedId === tr.dataset.player ? null : tr.dataset.player;
        render();
      });
    });

    root.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => act('close-room', { code: btn.dataset.close }));
    });

    const ann = root.querySelector('[data-form="announce"]');
    ann.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = $('#ann-text').value.trim();
      if (!text) return;
      act('announce', { text });
      $('#ann-text').value = '';
    });

    const search = $('#adm-search');
    let searchTimer = null;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        query.query = search.value.trim();
        refresh();
      }, 260);
    });
    $('#adm-sort').addEventListener('change', (e) => {
      query.sort = e.target.value;
      refresh();
    });

    // Actions de la fiche joueur
    root.querySelectorAll('.player-card [data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.act;
        if (btn.dataset.confirm && !window.confirm(btn.dataset.confirm)) return;
        const payload = { id: selectedId };
        if (action === 'grant-xp' || action === 'grant-coins') {
          payload.amount = Number($('#pc-amount').value) || 0;
        }
        if (action === 'ban') {
          const reason = $('#pc-reason');
          payload.reason = reason ? reason.value.trim() : '';
        }
        if (action === 'set-admin') payload.value = btn.dataset.value === '1';
        act(action, payload);
      });
    });
  }

  return { init, open, close, render };
})();
