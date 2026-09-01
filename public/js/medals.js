'use strict';
/**
 * MÉDAILLES, PARURES ET CLASSEMENT DU MOIS.
 *
 * Les cosmétiques sont entièrement décoratifs et rendus en CSS : un contour
 * d'avatar, un effet sur le pseudo, une icône animée. Ils se voient partout
 * sur le site, ce qui est tout l'intérêt — une médaille qu'on est seul à
 * voir ne sert à rien.
 */

(() => {
  const { $, $$, fmt, el, timeOf } = PZ;

  let state = null;

  /* ═══════════ La progression ═══════════ */

  function renderProgress(s) {
    $('#med-have').textContent = fmt(s.collected);
    $('#med-total').textContent = fmt(s.total);
    $('#med-fill').style.width = `${(s.collected / s.total) * 100}%`;

    const next = s.tiers.find((t) => !t.done);
    $('#med-next').textContent = next
      ? `Prochain palier : ${next.icon} ${next.name} à ${next.need} objets — encore ${next.need - s.collected}.`
      : 'Tous les paliers sont tombés. Il ne reste plus rien à décrocher.';
  }

  /* ═══════════ Les paliers ═══════════ */

  function renderTiers(s) {
    const box = $('#tiers');
    box.replaceChildren();

    s.tiers.forEach((t) => {
      const node = el('div', `tier${t.done ? ' done' : ''}${t.first ? ' first' : ''}`);

      node.appendChild(el('div', 'tier-icon', t.icon));
      node.appendChild(el('div', 'tier-name', t.name));
      node.appendChild(el('div', 'tier-need', `${t.need} objets`));

      if (t.cosmetic) {
        node.appendChild(el('div', 'tier-unlock', `débloque : ${t.cosmetic.name}`));
      }

      // La course au premier : soit c'est toi, soit c'est quelqu'un, soit
      // c'est encore libre.
      const race = el('div', 'tier-race');
      if (t.first) {
        race.classList.add('mine');
        race.textContent = '🥇 Tu l’as eu en premier';
      } else if (t.heldBy) {
        race.textContent = `🥇 ${t.heldBy.name}`;
        race.dataset.tip = `Premier du site à ce palier, le ${new Date(t.heldBy.at).toLocaleDateString('fr-FR')}`;
      } else {
        race.classList.add('open');
        race.textContent = '🥇 encore libre';
      }
      node.appendChild(race);

      box.appendChild(node);
    });
  }

  /* ═══════════ Les parures ═══════════ */

  const KIND_LABEL = { frame: 'Contour d’avatar', name: 'Effet de pseudo', badge: 'Icône' };

  function renderCosmetics(s) {
    const box = $('#cosmetics');
    box.replaceChildren();

    ['frame', 'name', 'badge'].forEach((kind) => {
      const group = el('div', 'cos-group');
      group.appendChild(el('h3', null, KIND_LABEL[kind]));

      const row = el('div', 'cos-row');

      // « Aucun » est toujours disponible : on doit pouvoir tout retirer.
      const none = el('button', `cos${!s.equipped[kind] ? ' on' : ''}`);
      none.appendChild(el('span', 'cos-preview none', '∅'));
      none.appendChild(el('span', 'cos-name', 'Aucun'));
      none.addEventListener('click', () => PZ.socket.emit('medals:equip', { kind, id: null }));
      row.appendChild(none);

      s.cosmetics.filter((c) => c.kind === kind).forEach((c) => {
        const node = el('button', `cos${c.equipped ? ' on' : ''}${c.unlocked ? '' : ' locked'}`);
        node.disabled = !c.unlocked;

        const preview = el('span', 'cos-preview');
        if (kind === 'frame') {
          preview.classList.add('frame-demo', c.id);
          preview.appendChild(el('span', 'avatar-dot', '🙂'));
        } else if (kind === 'name') {
          preview.classList.add('name-demo', c.id);
          preview.textContent = 'Pseudo';
        } else {
          preview.textContent = c.icon || '✦';
          preview.classList.add('badge-demo', c.id);
        }
        node.appendChild(preview);
        node.appendChild(el('span', 'cos-name', c.name));
        node.appendChild(el('span', 'cos-hint', c.unlocked ? c.hint : 'Verrouillé'));

        node.addEventListener('click', () => PZ.socket.emit('medals:equip', { kind, id: c.id }));
        row.appendChild(node);
      });

      group.appendChild(row);
      box.appendChild(group);
    });
  }

  /* ═══════════ Le mois en cours ═══════════ */

  let seasonTimer = null;

  function renderSeason(s) {
    const box = $('#season-body');
    box.replaceChildren();

    const head = el('div', 'season-head');
    head.appendChild(el('b', null, s.label));
    head.appendChild(el('span', 'season-prize', `🏆 ${s.prize}`));
    box.appendChild(head);

    const left = el('div', 'season-left');
    left.id = 'season-left';
    box.appendChild(left);

    const tick = () => {
      const ms = s.endsAt - (Date.now() - (Date.now() - s.serverNow));
      const remaining = Math.max(0, s.endsAt - Date.now());
      const d = Math.floor(remaining / 86400000);
      const h = Math.floor((remaining % 86400000) / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      left.textContent = `Fin dans ${d} j ${h} h ${m} min`;
      void ms;
    };
    tick();
    clearInterval(seasonTimer);
    seasonTimer = setInterval(tick, 30000);

    box.appendChild(el('p', 'fine',
      'Le classement du mois compte le BÉNÉFICE net, pas le solde : miser gros et tout ' +
      'récupérer ne fait pas monter. Le lot est remis à la main par un administrateur, ' +
      'le site ne fait que désigner le vainqueur.'));

    const list = el('ol', 'lb season-lb');
    if (!s.ranking.length) {
      list.appendChild(el('li', 'empty', 'Personne n’est encore en positif ce mois-ci.'));
    }
    s.ranking.slice(0, 10).forEach((p) => {
      const li = el('li');
      if (PZ.me && p.id === PZ.me.id) li.classList.add('me');
      li.appendChild(el('span', 'rk', String(p.rank)));
      const img = new Image(30, 30);
      img.src = PZ.avatarUrl(p);
      img.alt = '';
      li.appendChild(img);
      const who = el('div', 'who');
      who.appendChild(el('b', 'n', p.name));
      who.appendChild(el('span', 't', `${fmt(p.rounds)} manches`));
      li.appendChild(who);
      li.appendChild(el('span', 'v', `+${fmt(p.coins)} 🪙`));
      list.appendChild(li);
    });
    box.appendChild(list);

    if (s.you) {
      const you = el('div', 'season-you');
      you.appendChild(el('span', null, 'Ton bénéfice du mois'));
      const v = el('b', null, `${s.you.coins >= 0 ? '+' : ''}${fmt(s.you.coins)} 🪙`);
      v.style.color = s.you.coins >= 0 ? 'var(--green)' : 'var(--red)';
      you.appendChild(v);
      box.appendChild(you);
    }

    if (s.hallOfFame && s.hallOfFame.length) {
      const hof = el('div', 'hof');
      hof.appendChild(el('h3', null, 'Le palmarès'));
      s.hallOfFame.forEach((w) => {
        const line = el('div', 'hof-line');
        line.appendChild(el('span', 'hof-month', w.label));
        line.appendChild(el('b', null, w.name));
        line.appendChild(el('span', 'hof-coins', `+${fmt(w.coins)} 🪙`));
        hof.appendChild(line);
      });
      box.appendChild(hof);
    }
  }

  /* ═══════════ Branchement ═══════════ */

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__medBound) return;
    socket.__medBound = true;

    socket.on('medals:state', (s) => {
      state = s;
      renderProgress(s);
      renderTiers(s);
      renderCosmetics(s);
    });

    socket.on('season:state', renderSeason);
  }

  PZ.views.medals = {
    enter() {
      bind();
      PZ.socket.emit('medals:open');
      PZ.socket.emit('season:open');
    },
    leave() { clearInterval(seasonTimer); seasonTimer = null; },
  };

  /* ═══════════ Les parures, partout ailleurs ═══════════ */

  /**
   * Applique la parure d'un joueur à un élément quelconque : une ligne de
   * chat, une entrée du classement, un siège de blackjack. Les autres
   * fichiers appellent ça plutôt que de connaître les noms de classes.
   */
  PZ.applyCosmetics = (node, cosmetics, { avatar, name } = {}) => {
    if (!cosmetics) return;
    if (avatar && cosmetics.frame) avatar.classList.add('cos-frame', cosmetics.frame);
    if (name && cosmetics.name) name.classList.add('cos-name', cosmetics.name);
    if (name && cosmetics.badge) {
      const badge = el('span', 'cos-badge', cosmetics.badge);
      name.after(badge);
    }
    void node;
  };
})();
