'use strict';
/**
 * LE MARCHÉ.
 *
 * Un joueur met un doublon en vente au prix qu'il veut, un autre l'achète.
 * Toute la logique — la commission, le prix plancher, le fait qu'on ne vende
 * jamais son dernier exemplaire — est côté serveur. Ici on affiche, et
 * surtout on rend LISIBLE ce qui est une affaire et ce qui n'en est pas une :
 * chaque offre montre son rapport au prix de revente automatique, parce que
 * sans ce repère personne ne sait si 400 pièces pour un objet épique est
 * correct ou ridicule.
 */

(() => {
  const { $, el, fmt, timeOf } = PZ;

  let state = null;
  const query = { sort: 'recent', rarity: 'all', search: '' };

  /* ─── Ce qu'on peut vendre ─── */

  function renderSell(m) {
    const select = $('#mk-item');
    const keep = select.value;
    select.replaceChildren();

    if (!m.owned.length) {
      const opt = el('option', null, 'Aucun doublon à vendre');
      opt.value = '';
      select.appendChild(opt);
      select.disabled = true;
      $('#mk-hint').textContent =
        'Le dernier exemplaire d’un objet reste toujours dans ta collection : on ne vend que les doublons.';
      return;
    }

    select.disabled = false;
    m.owned.forEach((o) => {
      const opt = el('option', null, `${o.emoji} ${o.name} — ${o.rarity} (${o.spare} en double)`);
      opt.value = o.id;
      select.appendChild(opt);
    });
    if (keep && m.owned.some((o) => o.id === keep)) select.value = keep;
    updateHint(m);
  }

  function updateHint(m) {
    const item = m.owned.find((o) => o.id === $('#mk-item').value);
    if (!item) return;

    const price = $('#mk-price');
    price.min = String(item.min);
    price.max = String(item.max);
    if (!price.value || Number(price.value) < item.min) price.value = String(Math.round(item.base * 2));

    $('#mk-count').max = String(item.spare);
    const asked = Math.max(item.min, Number(price.value) || item.min);
    const net = asked - Math.ceil(asked * (m.fee / 100));

    $('#mk-hint').textContent =
      `Revente automatique : ${fmt(item.base)} ¤. Tu peux demander entre ${fmt(item.min)} et ` +
      `${fmt(item.max)}. À ${fmt(asked)} tu touches ${fmt(net)} après la commission de ${m.fee} %.`;
  }

  /* ─── Les chiffres du marché ─── */

  function renderStats(m) {
    const box = $('#mk-stats');
    box.replaceChildren();
    box.appendChild(el('div', 'panel-head')).appendChild(el('h2', null, 'Le marché'));

    const grid = el('div', 'mk-figures');
    const fig = (value, label) => {
      const node = el('div');
      node.appendChild(el('b', null, value));
      node.appendChild(el('span', null, label));
      return node;
    };
    grid.appendChild(fig(fmt(m.total), 'offres en ligne'));
    grid.appendChild(fig(`${m.mine}/${m.maxListings}`, 'tes offres'));
    grid.appendChild(fig(fmt(m.sales), 'ventes conclues'));
    grid.appendChild(fig(fmt(m.burned), 'pièces détruites'));
    box.appendChild(grid);

    box.appendChild(el('p', 'fine',
      'Les pièces prélevées en commission ne vont à personne : elles disparaissent. ' +
      'C’est ce qui empêche deux comptes complices de se repasser un objet pour ' +
      'fabriquer des pièces, et ce qui garde de la valeur à celles qui restent.'));
  }

  /* ─── Les offres ─── */

  function renderList(m) {
    const box = $('#mk-list');
    box.replaceChildren();
    $('#mk-count-label').textContent = fmt(m.total);

    if (!m.listings.length) {
      box.appendChild(el('div', 'empty',
        query.search || query.rarity !== 'all'
          ? 'Rien ne correspond à cette recherche.'
          : 'Le marché est vide. Sois le premier à mettre un doublon en vente.'));
      return;
    }

    const frag = document.createDocumentFragment();
    m.listings.forEach((l) => {
      const node = el('div', `mk-row${l.mine ? ' mine' : ''}`);
      node.style.setProperty('--rc', l.color);

      node.appendChild(el('span', 'mk-emoji', l.emoji));

      const info = el('div', 'mk-info');
      info.appendChild(el('b', null, l.count > 1 ? `${l.count} × ${l.name}` : l.name));
      const meta = el('span', 'mk-meta');
      meta.appendChild(el('i', 'mk-rarity', l.rarity));
      meta.appendChild(el('span', null, `par ${l.seller}`));
      info.appendChild(meta);
      node.appendChild(info);

      // Le repère qui rend le prix lisible d'un coup d'œil.
      const ratio = el('span', 'mk-ratio', `×${String(l.ratio).replace('.', ',')}`);
      ratio.dataset.tip = `${fmt(l.price)} pièces pour un objet qui se revend automatiquement ${fmt(l.base)}`;
      if (l.ratio <= 2) ratio.classList.add('good');
      else if (l.ratio >= 12) ratio.classList.add('steep');
      node.appendChild(ratio);

      node.appendChild(el('span', 'mk-price', `${fmt(l.price)} ¤`));

      if (l.mine) {
        const cancel = el('button', 'btn btn-soft', 'Retirer');
        cancel.addEventListener('click', () => PZ.socket.emit('market:cancel', { id: l.id }));
        node.appendChild(cancel);
      } else {
        const buy = el('button', 'btn btn-green', 'Acheter');
        buy.disabled = !PZ.profile || PZ.profile.coins < l.price;
        buy.addEventListener('click', () => {
          SFX.chip();
          PZ.socket.emit('market:buy', { id: l.id });
        });
        node.appendChild(buy);
      }

      frag.appendChild(node);
    });
    box.appendChild(frag);
  }

  function renderHistory(m) {
    const box = $('#mk-history');
    box.replaceChildren();
    if (!m.history.length) {
      box.appendChild(el('div', 'empty', 'Aucune vente pour l’instant.'));
      return;
    }
    m.history.forEach((h) => {
      const row = el('div', 'mk-sale');
      row.appendChild(el('span', 'mk-emoji', h.emoji));
      row.appendChild(el('b', null, h.count > 1 ? `${h.count} × ${h.name}` : h.name));
      row.appendChild(el('span', 'fine', `à ${h.buyer}`));
      row.appendChild(el('span', 'mk-net', `+${fmt(h.net)} ¤`));
      row.appendChild(el('i', null, timeOf(h.at)));
      box.appendChild(row);
    });
  }

  /* ─── Rendu complet ─── */

  function render(m) {
    state = m;
    $('#mk-fee').textContent = String(m.fee);
    renderSell(m);
    renderStats(m);
    renderList(m);
    renderHistory(m);
  }

  /* ─── Interactions ─── */

  $('#mk-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const itemId = $('#mk-item').value;
    if (!itemId) return PZ.toast('Tu n’as aucun doublon à vendre.', 'warn');
    PZ.socket.emit('market:list', {
      itemId,
      price: Number($('#mk-price').value) || 0,
      count: Number($('#mk-count').value) || 1,
    });
  });

  $('#mk-item').addEventListener('change', () => { if (state) updateHint(state); });
  $('#mk-price').addEventListener('input', () => { if (state) updateHint(state); });

  let searchTimer = null;
  $('#mk-search').addEventListener('input', (e) => {
    query.search = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refresh, 220);
  });
  $('#mk-rarity').addEventListener('change', (e) => { query.rarity = e.target.value; refresh(); });
  $('#mk-sort').addEventListener('change', (e) => { query.sort = e.target.value; refresh(); });

  function refresh() {
    if (PZ.socket) PZ.socket.emit('market:open', query);
  }

  /* ─── Branchement ─── */

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__mkBound) return;
    socket.__mkBound = true;

    socket.on('market:state', render);

    // Quelqu'un a acheté ou déposé quelque chose : on se remet à jour, mais
    // seulement si on regarde la page — sinon c'est du trafic pour rien.
    socket.on('market:changed', () => { if (PZ.view === 'market') refresh(); });
  }

  PZ.views.market = {
    enter() { bind(); refresh(); },
  };
})();
