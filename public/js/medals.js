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
      const node = el('div', `tier${t.done ? ' done' : ''}`);

      node.appendChild(el('div', 'tier-icon', t.icon));
      node.appendChild(el('div', 'tier-name', t.name));
      node.appendChild(el('div', 'tier-need', `${t.need} objets`));

      if (t.cosmetic) {
        node.appendChild(el('div', 'tier-unlock', `débloque : ${t.cosmetic.name}`));
      }

      /*
       * Un palier n'appartient à personne : tout le monde peut avoir les
       * mêmes. On n'affiche donc plus qui l'a eu en premier — seulement si
       * TU l'as, et depuis quand. C'est ta collection, pas un podium.
       */
      const race = el('div', 'tier-race');
      if (t.done) {
        race.classList.add('mine');
        race.textContent = t.at
          ? `✓ décroché le ${new Date(t.at).toLocaleDateString('fr-FR')}`
          : '✓ décroché';
      } else {
        race.classList.add('open');
        race.textContent = `encore ${t.need - s.collected} objets`;
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
      'Le classement du mois se joue à l’XP, pas aux pièces. L’XP vient des caisses ' +
      'que tu ouvres — donc garder son magot sans jamais rien ouvrir ne rapporte rien. ' +
      'L’XP de la section Party ne compte pas ici : elle sert à être le meilleur entre ' +
      'potes, pas à gagner le lot. Le lot est remis à la main par un administrateur, ' +
      'le site ne fait que désigner le vainqueur.'));

    const list = el('ol', 'lb season-lb');
    if (!s.ranking.length) {
      list.appendChild(el('li', 'empty', 'Personne n’a encore marqué d’XP ce mois-ci.'));
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
      who.appendChild(el('span', 't', `${fmt(p.rounds)} manches jouées`));
      li.appendChild(who);
      li.appendChild(el('span', 'v', `${fmt(p.xp)} XP`));
      list.appendChild(li);
    });
    box.appendChild(list);

    if (s.you) {
      const you = el('div', 'season-you');
      you.appendChild(el('span', null, 'Ton XP du mois'));
      you.appendChild(el('b', null, `${fmt(s.you.xp || 0)} XP`));
      box.appendChild(you);

      // Le bénéfice reste affiché, en petit : c'est une statistique utile
      // pour savoir si le casino t'a été favorable, mais elle ne classe
      // plus personne.
      const side = el('p', 'fine season-side');
      side.textContent = `Bénéfice du casino ce mois-ci : ${s.you.coins >= 0 ? '+' : ''}${fmt(s.you.coins)} ¤ — ` +
        'ça ne compte pas au classement, c’est juste ce qui te finance les caisses.';
      box.appendChild(side);
    }

    if (s.hallOfFame && s.hallOfFame.length) {
      const hof = el('div', 'hof');
      hof.appendChild(el('h3', null, 'Le palmarès'));
      s.hallOfFame.forEach((w) => {
        const line = el('div', 'hof-line');
        line.appendChild(el('span', 'hof-month', w.label));
        line.appendChild(el('b', null, w.name));
        // Les mois d'avant le passage à l'XP n'ont que des pièces : on
        // affiche ce qu'on a, plutôt que « 0 XP » qui serait faux.
        line.appendChild(el('span', 'hof-coins',
          w.xp ? `${fmt(w.xp)} XP` : `+${fmt(w.coins)} ¤`));
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
