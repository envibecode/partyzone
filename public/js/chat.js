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
    const nameNode = el('span', 'msg-name', m.name);
    head.appendChild(nameNode);
    // Contour d'avatar, pseudo en flammes, icône : les parures décrochées aux
    // paliers de collection se voient ici comme partout ailleurs.
    if (PZ.applyCosmetics) PZ.applyCosmetics(wrap, m.cosmetics, { avatar: img, name: nameNode });
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

  /*
   * COLLER EN BAS, VRAIMENT.
   *
   * Trois choses faisaient rater ça, et il fallait les trois pour que ça
   * marche vraiment :
   *
   *  1. On mesurait « est-ce que j'étais en bas ? » au moment d'ajouter un
   *     message. Mais quand le chat est dans une page pas encore affichée,
   *     sa hauteur vaut zéro : le calcul répondait « non », et on ne
   *     recollait jamais. C'est le cas de l'accueil, qui est monté avant
   *     même l'écran de connexion. On garde donc un état explicite —
   *     `stick` — vrai par défaut, et changé UNIQUEMENT quand la personne
   *     fait défiler elle-même.
   *
   *  2. Les avatars se chargent APRÈS coup et rallongent la liste. On
   *     collait en bas d'une liste qui grandissait juste après, et on se
   *     retrouvait quelques messages trop haut.
   *
   *  3. Quand la page devient visible, la liste passe d'une hauteur nulle à
   *     sa vraie hauteur : il faut recoller à ce moment-là aussi.
   */
  function toEnd(mount) {
    const log = mount.log;
    const go = () => { log.scrollTop = log.scrollHeight; };
    go();
    requestAnimationFrame(go);
    // Les images pas encore arrivées : on recolle quand chacune se pose.
    log.querySelectorAll('img').forEach((img) => {
      if (img.complete) return;
      const again = () => { if (mount.stick) go(); };
      img.addEventListener('load', again, { once: true });
      img.addEventListener('error', again, { once: true });
    });
  }

  /** Recolle en bas si la personne n'a pas remonté l'historique elle-même. */
  function keepEnd(mount) {
    if (mount.stick !== false) toEnd(mount);
  }

  /** Branche la surveillance d'un emplacement : défilement et visibilité. */
  function watch(mount) {
    mount.stick = true;
    mount.log.addEventListener('scroll', () => {
      // Une liste invisible mesure zéro : on ne conclut rien dans ce cas,
      // sinon un simple changement de page « décrocherait » le chat.
      if (!mount.log.clientHeight) return;
      mount.stick = atBottom(mount.log);
    }, { passive: true });

    // La page devient visible : la liste prend sa vraie hauteur, on recolle.
    if (typeof ResizeObserver === 'function') {
      let had = 0;
      new ResizeObserver(() => {
        const now = mount.log.clientHeight;
        if (now && !had) keepEnd(mount);
        had = now;
      }).observe(mount.log);
    }
  }

  function redraw(mount) {
    mount.log.replaceChildren();
    history.forEach((m) => mount.log.appendChild(nodeFor(m)));
    keepEnd(mount);
  }

  function append(m) {
    mounts.forEach((mount) => {
      mount.log.appendChild(nodeFor(m));
      while (mount.log.children.length > 80) mount.log.firstElementChild.remove();
      keepEnd(mount);
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
      watch(mount);
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

    /**
     * Le même « coller en bas », pour les chats de salon Party qui ne
     * passent pas par `mount` (ils sont redessinés par leur jeu).
     * Écrit une fois ici plutôt que recopié dans chaque jeu.
     */
    stick(log) {
      if (!log) return;
      if (log.__pzStick === undefined) {
        log.__pzStick = true;
        log.addEventListener('scroll', () => {
          if (!log.clientHeight) return;
          log.__pzStick = atBottom(log);
        }, { passive: true });
      }
      if (log.__pzStick) toEnd({ log, stick: true });
    },
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
