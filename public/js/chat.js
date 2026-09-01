'use strict';
/**
 * CHAT EN DIRECT, partagé par tout le site.
 *
 * On peut l'afficher à plusieurs endroits en même temps — le lobby, la
 * roulette, la table de blackjack. Chaque emplacement s'enregistre ici et
 * reçoit les mêmes messages ; il n'y a qu'un seul salon.
 */

(() => {
  const { $, el, avatarUrl, timeOf } = PZ;

  const mounts = [];      // { log, form, input }
  let history = [];       // du plus ancien au plus récent
  let bound = false;

  /* ─── Rendu d'un message ─── */

  function nodeFor(m) {
    if (m.system) {
      const wrap = el('div', `msg sys sys-${m.kind || 'info'}`);
      wrap.dataset.id = m.id;
      const body = el('div', 'msg-body');
      body.appendChild(el('div', 'msg-text', m.text));
      wrap.appendChild(body);
      return wrap;
    }

    const mine = PZ.me && m.userId === PZ.me.id;
    const wrap = el('div', `msg${mine ? ' you' : ''}${m.admin ? ' admin' : ''}`);
    wrap.dataset.id = m.id;

    const img = new Image(34, 34);
    img.src = avatarUrl(m);
    img.alt = '';
    wrap.appendChild(img);

    const body = el('div', 'msg-body');
    const head = el('div', 'msg-head');
    head.appendChild(el('span', 'msg-lvl', m.admin ? 'ADMIN' : `N${m.level}`));
    head.appendChild(el('span', 'msg-name', m.name));
    head.appendChild(el('span', 'msg-at', timeOf(m.at)));

    // Un administrateur peut retirer un message directement depuis le chat.
    if (PZ.profile && PZ.profile.admin) {
      const del = el('button', 'msg-del', '✕');
      del.title = 'Supprimer ce message';
      del.addEventListener('click', () => {
        PZ.socket.emit('admin:action', {
          action: 'delete-message',
          payload: { id: m.id, author: m.name },
        });
      });
      head.appendChild(del);
    }

    body.appendChild(head);
    body.appendChild(el('div', 'msg-text', m.text));
    wrap.appendChild(body);
    return wrap;
  }

  /* ─── Affichage ─── */

  function atBottom(log) {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  }

  function redraw(mount) {
    mount.log.replaceChildren();
    history.forEach((m) => mount.log.appendChild(nodeFor(m)));
    mount.log.scrollTop = mount.log.scrollHeight;
  }

  function append(m) {
    mounts.forEach((mount) => {
      // On ne colle en bas que si la personne y était déjà : sinon on la
      // laisse lire tranquillement ce qu'elle est en train de remonter.
      const stick = atBottom(mount.log);
      mount.log.appendChild(nodeFor(m));
      while (mount.log.children.length > 80) mount.log.firstElementChild.remove();
      if (stick) mount.log.scrollTop = mount.log.scrollHeight;
    });
  }

  function remove(id) {
    history = history.filter((m) => m.id !== id);
    mounts.forEach((mount) => {
      const node = mount.log.querySelector(`[data-id="${id}"]`);
      if (node) node.remove();
    });
  }

  /* ─── Branchement ─── */

  function bind() {
    if (bound || !PZ.socket) return;
    bound = true;

    PZ.socket.on('chat:history', ({ messages }) => {
      history = messages || [];
      mounts.forEach(redraw);
    });

    PZ.socket.on('chat:message', (m) => {
      history.push(m);
      while (history.length > 80) history.shift();
      append(m);
    });

    PZ.socket.on('chat:remove', ({ id }) => remove(id));

    PZ.socket.on('online:list', ({ online }) => {
      const playing = online.filter((p) => p.status !== 'home').length;
      const text = `${online.length} en ligne · ${playing} en train de jouer`;
      PZ.$$('.chat-stats').forEach((node) => { node.textContent = text; });
    });
  }

  /* ─── API ─── */

  PZ.chat = {
    /** Enregistre un emplacement d'affichage : { log, form, input }. */
    mount(mount) {
      mounts.push(mount);
      redraw(mount);

      if (mount.form) {
        mount.form.addEventListener('submit', (e) => {
          e.preventDefault();
          const text = mount.input.value.trim();
          if (!text) return;
          PZ.socket.emit('chat:say', { text });
          mount.input.value = '';
        });
      }
      bind();
      return mount;
    },

    /** Redessine partout : utile quand on vient d'obtenir les droits admin. */
    refresh() { mounts.forEach(redraw); },
  };

  document.addEventListener('pz:ready', bind);

  // Passer administrateur fait apparaître les croix de suppression.
  let wasAdmin = false;
  document.addEventListener('pz:profile', (e) => {
    const isAdmin = Boolean(e.detail.admin);
    if (isAdmin !== wasAdmin) {
      wasAdmin = isAdmin;
      mounts.forEach(redraw);
    }
  });
})();
