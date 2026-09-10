'use strict';
/**
 * BLINDTEST — l'écran.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COMMENT LE SON MARCHE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Chaque joueur a son propre lecteur YouTube, caché, et tous jouent la même
 * vidéo au même endroit. Le serveur envoie l'identifiant et le point de
 * départ ; chaque navigateur calcule combien de temps s'est écoulé depuis
 * le début de la manche et se cale dessus. Les écarts se comptent en
 * dixièmes de seconde, ce qui ne se remarque pas quand on est chacun chez
 * soi — et c'est la seule façon de faire sans diffuser le son depuis le
 * serveur.
 *
 * L'HÔTE FAIT UNE CHOSE DE PLUS : il charge la playlist dans son lecteur,
 * en lit le contenu, et l'envoie au serveur. C'est ce qui évite d'avoir à
 * demander une clé d'API Google, un projet et un quota pour jouer avec
 * trois potes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TROIS PARTIS PRIS
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  · LE LECTEUR EST INVISIBLE, mais il y a une VRAIE pochette animée à la
 *    place. Un blindtest où l'on regarde un rectangle noir est un
 *    blindtest triste ; un blindtest où l'on voit la vidéo n'est plus un
 *    blindtest.
 *
 *  · ON VOIT QUI A RÉPONDU, JAMAIS QUOI. C'est ce qui met la pression sans
 *    donner la réponse : quand trois pastilles s'allument et pas la
 *    quatrième, on sait qu'on est en retard.
 *
 *  · LA MUSIQUE VA AU BOUT. Elle ne s'arrête pas au premier bon buzz —
 *    couper le son punirait les trois autres, qui n'ont plus rien à
 *    chercher.
 */

(() => {
  const { $, el, fmt } = PZ;

  let state = null;
  let barRaf = null;
  let player = null;        // le lecteur YouTube de ce navigateur
  let ready = false;
  let loader = null;        // le lecteur qui sert à lire une playlist (hôte)
  let playing = null;       // l'identifiant vidéo en cours de lecture

  const PHASE_TEXT = {
    lobby: 'En attente',
    ecoute: 'Écoute',
    reponse: 'La réponse',
    over: 'Terminé',
  };

  /* ═══════════ Le lecteur YouTube ═══════════ */

  /**
   * On charge l'API une seule fois, à la demande.
   *
   * Elle appelle une fonction globale quand elle est prête : c'est
   * l'interface imposée par YouTube, on s'y plie plutôt que de la
   * contourner.
   */
  let apiPromise = null;
  function youtubeApi() {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve) => {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === 'function') prev();
        resolve(window.YT);
      };
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    });
    return apiPromise;
  }

  async function ensurePlayer() {
    if (player) return player;
    const YT = await youtubeApi();
    await new Promise((resolve) => {
      player = new YT.Player('bt-player', {
        height: '180', width: '320',
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: () => { ready = true; resolve(); },
          onStateChange: () => {},
        },
      });
    });
    return player;
  }

  /**
   * OÙ EN EST-ON DE L'EXTRAIT ?
   *
   * Le serveur envoie deux choses : `deadline`, l'instant où la manche se
   * termine, et `serverNow`, son horloge au moment de l'envoi. La manche
   * dure `levelMs`. Le temps déjà écoulé vaut donc :
   *
   *     levelMs − (deadline − serverNow)
   *
   * plus ce qui s'est passé depuis qu'on a reçu le message. Rien de plus.
   *
   * L'ancien calcul mélangeait les deux horloges et sortait un milliard et
   * demi de secondes ; l'écrêtage le ramenait pile à la fin de l'extrait.
   * Résultat : à chaque manche, la musique démarrait sur les dernières
   * fractions de seconde avant de s'arrêter. C'est ça, « le blindtest ne
   * marche pas ».
   */
  function elapsedOf(s) {
    const sent = s.levelMs - (s.deadline - s.serverNow);
    const since = Date.now() - (s.receivedAt || Date.now());
    return Math.max(0, Math.min(s.levelMs, sent + since)) / 1000;
  }

  /** Cale le lecteur sur l'extrait de la manche, au bon endroit. */
  async function syncAudio(s) {
    if (!s.current || s.phase !== 'ecoute') return;
    await ensurePlayer();
    if (!ready) return;

    const at = s.current.offset + elapsedOf(s);

    if (playing !== s.current.videoId) {
      playing = s.current.videoId;
      player.loadVideoById({ videoId: s.current.videoId, startSeconds: at });
      player.setVolume(75);
    }
    try { player.playVideo(); } catch { /* le navigateur peut refuser avant un clic */ }
    checkSound();
  }

  /*
   * LE NAVIGATEUR REFUSE LE SON TANT QU'ON N'A RIEN CLIQUÉ.
   *
   * C'est la règle de tous les navigateurs modernes, et elle ne se
   * contourne pas — il faut un clic. L'hôte en fait un en lançant la
   * partie ; les autres, non : ils arrivent, la musique démarre pour tout
   * le monde sauf eux, et ils croient que le jeu est cassé.
   *
   * On regarde donc si le lecteur joue vraiment, et sinon on affiche un
   * bouton. Un clic dessus suffit, une fois pour la soirée.
   */
  let unlocked = false;
  let soundTimer = null;

  function checkSound() {
    clearTimeout(soundTimer);
    soundTimer = setTimeout(() => {
      if (!player || !ready || unlocked) return;
      let st = -1;
      try { st = player.getPlayerState(); } catch { return; }
      // 1 = en lecture, 3 = en train de charger. Tout le reste, pendant une
      // manche, veut dire que le navigateur a dit non.
      showUnlock(st !== 1 && st !== 3);
    }, 900);
  }

  function showUnlock(on) {
    const stage = $('#bt-stage');
    let box = stage.querySelector('.bt-unlock');
    if (!on) { if (box) box.remove(); return; }
    if (box) return;

    box = el('div', 'bt-unlock');
    box.appendChild(el('span', null,
      'Ton navigateur bloque le son tant que tu n’as rien cliqué sur cette page. '
      + 'Un clic ici et c’est réglé pour toute la soirée.'));
    const btn = el('button', 'btn btn-primary', '🔊 Activer le son');
    btn.addEventListener('click', () => {
      unlocked = true;
      try { player.unMute(); player.setVolume(75); player.playVideo(); } catch { /* rien */ }
      box.remove();
    });
    box.appendChild(btn);
    stage.prepend(box);
  }

  function stopAudio() {
    playing = null;
    if (player && ready) { try { player.stopVideo(); } catch { /* rien */ } }
  }

  /* ═══════════ Charger une playlist (l'hôte) ═══════════ */

  /** L'identifiant d'une playlist, quelle que soit la forme de l'adresse. */
  function playlistIdFrom(input) {
    const raw = String(input || '').trim();
    const m = raw.match(/[?&]list=([\w-]+)/) || raw.match(/^([\w-]{12,})$/);
    return m ? m[1] : null;
  }

  /**
   * LIT UNE PLAYLIST SANS CLÉ D'API.
   *
   * On charge la playlist dans un lecteur caché, muet, puis on avance de
   * piste en piste en relevant le titre de chacune. C'est lent — environ un
   * tiers de seconde par morceau — mais ça ne demande ni compte Google, ni
   * projet, ni quota, et ça se fait une fois par soirée.
   *
   * Trois choses rataient, et il fallait les trois pour que ça marche :
   *
   *  · ON NE LAISSAIT PAS LE TEMPS À LA PLAYLIST D'ARRIVER. `onReady` se
   *    déclenche quand le LECTEUR est prêt, pas quand la playlist est
   *    chargée. On lisait donc une liste vide et on annonçait « playlist
   *    illisible » à quelqu'un qui avait collé la bonne adresse.
   *
   *  · LE LECTEUR FAISAIT UN PIXEL SUR UN PIXEL. YouTube refuse de jouer
   *    dans un lecteur qu'il considère invisible, sans dire pourquoi.
   *
   *  · IL N'ÉTAIT PAS MUET. Parcourir cinquante morceaux faisait donc
   *    entendre cinquante demi-secondes de musique à l'hôte.
   */
  let scanning = false;

  /** Attend qu'une condition devienne vraie, sans bloquer la page. */
  function until(fn, ms, step = 150) {
    const started = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        let v = null;
        try { v = fn(); } catch { v = null; }
        if (v) return resolve(v);
        if (Date.now() - started > ms) return resolve(null);
        setTimeout(tick, step);
      };
      tick();
    });
  }

  async function loadPlaylist(url) {
    if (scanning) return;
    const id = playlistIdFrom(url);
    if (!id) return PZ.toast('Colle l’adresse d’une playlist YouTube (elle contient « list= »).', 'error');

    const btn = $('#bt-load');
    const status = $('#bt-status');
    scanning = true;
    btn.disabled = true;
    status.textContent = 'Ouverture de la playlist…';

    try {
      const YT = await youtubeApi();

      if (!loader) {
        await new Promise((resolve) => {
          loader = new YT.Player('bt-loader', {
            height: '180', width: '320',
            playerVars: { listType: 'playlist', list: id, autoplay: 0, controls: 0, playsinline: 1 },
            events: { onReady: () => resolve() },
          });
        });
      } else {
        loader.cuePlaylist({ listType: 'playlist', list: id });
      }

      // Le lecteur est prêt : la playlist, pas forcément. On attend qu'elle
      // arrive vraiment, jusqu'à quinze secondes.
      try { loader.mute(); } catch { /* pas encore prêt, ce n'est pas grave */ }
      const ids = await until(() => {
        const list = loader.getPlaylist();
        return list && list.length ? list : null;
      }, 15000);

      if (!ids) {
        status.textContent = 'Playlist vide ou privée.';
        PZ.toast('Aucun morceau trouvé. La playlist doit être publique ou non répertoriée, '
          + 'et contenir au moins quatre titres.', 'error');
        return;
      }

      const total = Math.min(ids.length, 200);
      const tracks = [];
      const seen = new Set();

      for (let i = 0; i < total; i++) {
        loader.playVideoAt(i);
        // Le titre n'est disponible qu'une fois la vidéo chargée : on attend
        // qu'il CHANGE, plutôt qu'un délai fixe au jugé. C'est plus rapide
        // sur une bonne connexion, et plus sûr sur une mauvaise.
        const data = await until(() => {
          const d = loader.getVideoData() || {};
          return d.video_id && !seen.has(d.video_id) ? d : null;
        }, 2500, 120);

        if (data) {
          seen.add(data.video_id);
          if (data.title) tracks.push({ id: data.video_id, title: data.title, author: data.author });
        }
        status.textContent = `Lecture de la playlist… ${tracks.length} / ${total}`;
      }
      try { loader.stopVideo(); } catch { /* rien */ }

      if (tracks.length < 4) {
        status.textContent = `Seulement ${tracks.length} morceau(x) lisible(s).`;
        PZ.toast('Il faut au moins quatre morceaux lisibles. Certaines vidéos sont peut-être '
          + 'bloquées ou supprimées.', 'error');
        return;
      }

      PZ.socket.emit('bt:playlist', { id, title: (loader.getVideoData() || {}).author || '', tracks });
      status.textContent = `${tracks.length} morceaux prêts.`;
    } catch (err) {
      status.textContent = 'Playlist illisible. Vérifie qu’elle est publique.';
      PZ.toast('Impossible de lire cette playlist. Elle doit être publique ou non répertoriée.', 'error');
      void err;
    } finally {
      scanning = false;
      btn.disabled = false;
    }
  }

  /* ═══════════ Le rendu ═══════════ */

  function renderBoard(s) {
    const box = $('#bt-board');
    box.replaceChildren();
    s.board.forEach((p, i) => {
      const row = el('div', `bt-player${p.you ? ' you' : ''}${p.answered ? ' answered' : ''}`);
      row.dataset.who = p.id;
      if (!p.connected) row.classList.add('away');
      if (p.right === true) row.classList.add('right');
      if (p.right === false) row.classList.add('wrong');

      row.appendChild(el('span', 'bt-rank', String(i + 1)));
      const img = new Image(26, 26);
      img.src = PZ.avatarUrl(p);
      img.alt = '';
      row.appendChild(img);

      const info = el('span', 'bt-player-info');
      const name = el('b', null, p.name);
      if (p.first) name.appendChild(el('i', 'bt-first', '⚡'));
      info.appendChild(name);
      // Pendant l'écoute on montre QUI a répondu, jamais QUOI.
      info.appendChild(el('span', null,
        p.gained != null ? `+${fmt(p.gained)}`
          : p.answered ? 'a répondu'
            : p.streak >= 3 ? `série de ${p.streak}` : ''));
      row.appendChild(info);

      row.appendChild(el('b', 'bt-score', fmt(p.points)));
      box.appendChild(row);
    });
  }

  function renderStage(s) {
    const box = $('#bt-stage');
    box.replaceChildren();
    box.className = `bt-stage ph-${s.phase}`;

    if (s.phase === 'lobby') {
      box.appendChild(el('h2', null, s.playlist.count
        ? `${s.playlist.count} morceaux prêts`
        : 'Choisis une playlist'));
      box.appendChild(el('p', null, s.playlist.count
        ? 'Tout le monde entend le même extrait au même moment. Monte le son.'
        : 'L’hôte colle l’adresse d’une playlist YouTube publique. Aucune clé, aucun compte : '
          + 'c’est son navigateur qui la lit.'));
      return;
    }

    if (s.phase === 'ecoute' && s.current) {
      // La pochette : un disque qui tourne. On ne montre pas la vidéo — ce
      // serait donner la réponse — mais un rectangle noir serait triste.
      const disc = el('div', 'bt-disc');
      disc.appendChild(el('span', 'bt-disc-hole'));
      box.appendChild(disc);
      box.appendChild(el('h2', null, `Manche ${s.round} sur ${s.rounds}`));
      if (s.current.hint) {
        box.appendChild(el('p', 'bt-hint-line', `Indice : ${s.current.hint}`));
      }
      return;
    }

    if (s.phase === 'reponse' && s.current) {
      box.appendChild(el('span', 'bt-answer-tag', 'C’était'));
      box.appendChild(el('h2', 'bt-answer', s.current.title));
      if (s.current.author) box.appendChild(el('p', null, s.current.author));
      if (s.current.firstName) {
        box.appendChild(el('p', 'bt-first-line', `${s.current.firstName} a trouvé le premier.`));
      } else {
        box.appendChild(el('p', 'bt-miss', 'Personne n’a trouvé.'));
      }
      return;
    }

    if (s.phase === 'over' && s.result) {
      box.appendChild(el('h2', null, s.result.winnerIds.length
        ? `${s.result.table.filter((t) => s.result.winnerIds.includes(t.id)).map((t) => t.name).join(' et ')} gagne`
        : 'Personne n’a marqué'));

      // Le podium : trois marches, les têtes dessus.
      const podium = el('div', 'bt-podium');
      [1, 0, 2].forEach((rank) => {
        const p = s.result.table[rank];
        if (!p) return;
        const step = el('div', `bt-step p${rank + 1}`);
        const img = new Image(48, 48);
        img.src = PZ.avatarUrl(p);
        img.alt = '';
        step.appendChild(img);
        step.appendChild(el('b', null, p.name));
        step.appendChild(el('span', null, `${fmt(p.points)} pts`));
        step.appendChild(el('i', null, String(rank + 1)));
        podium.appendChild(step);
      });
      box.appendChild(podium);
      box.appendChild(el('p', null, `${s.result.rounds} manches.`));
    }
  }

  function renderChoices(s) {
    const box = $('#bt-choices');
    box.replaceChildren();
    if (!s.current || (s.phase !== 'ecoute' && s.phase !== 'reponse')) return;

    s.current.choices.forEach((title, i) => {
      const b = el('button', 'bt-choice');
      b.appendChild(el('span', 'bt-choice-key', String.fromCharCode(65 + i)));
      b.appendChild(el('span', 'bt-choice-text', title));

      if (s.phase === 'reponse') {
        if (i === s.current.answer) b.classList.add('good');
        else if (s.you.choice === i) b.classList.add('bad');
        b.disabled = true;
      } else {
        if (s.you.choice === i) b.classList.add('mine');
        b.disabled = s.you.answered || Boolean(s.watching);
        b.addEventListener('click', () => {
          PZ.socket.emit('bt:answer', { index: i });
          if (window.SFX) SFX.click();
        });
      }
      box.appendChild(b);
    });
  }

  function renderBar(s) {
    if (barRaf) cancelAnimationFrame(barRaf);
    const bar = $('#bt-bar');
    if (!s.deadline || s.phase === 'lobby' || s.phase === 'over') { bar.style.width = '0%'; return; }
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

  let lastPhase = null;
  let lastRound = 0;

  function render(s) {
    state = s;
    PZ.watchBanner(s);
    $('#view-bt').classList.toggle('watching', Boolean(s.watching));
    $('#bt-code').textContent = s.code;
    $('#bt-phase').textContent = PHASE_TEXT[s.phase] || s.phase;

    const host = s.you.isHost;
    $('#bt-start').classList.toggle('hidden', !(host && (s.phase === 'lobby' || s.phase === 'over')));
    $('#bt-settings').classList.toggle('hidden', !(host && s.phase === 'lobby'));
    $('#bt-skip').classList.toggle('hidden', !(host && (s.phase === 'ecoute' || s.phase === 'reponse')));

    [...$('#bt-level').children].forEach((b) => b.classList.toggle('active', b.dataset.level === s.level));
    [...$('#bt-rounds').children].forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.rounds) === s.roundsTarget);
    });

    renderStage(s);
    renderChoices(s);
    renderBoard(s);
    $('#bt-log').replaceChildren(...s.log.slice(0, 12).map((l) => el('div', `bt-line ${l.kind || ''}`.trim(), l.text)));
    renderBar(s);
    PZ.roomChat($('#bt-chat'), s.chat);

    /* ── Le son et les effets ── */
    if (s.phase === 'ecoute' && s.round !== lastRound) { stopAudio(); lastRound = s.round; }
    if (s.phase === 'ecoute') syncAudio(s);
    else if (s.phase !== 'reponse') stopAudio();

    if (s.phase !== lastPhase) {
      if (s.phase === 'reponse' && window.SFX) {
        // Un petit son sur la réponse, comme demandé : victoire ou raté.
        if (s.you.right) SFX.win(1); else if (s.you.answered) SFX.lose();
      }
      if (s.phase === 'over') {
        stopAudio();
        if (window.SFX) SFX.fanfare();
        // Les confettis, pour le vainqueur seulement — sinon c'est une
        // consolation, et une consolation n'est pas une fête.
        if (s.result && s.result.winnerIds.includes(s.you.id) && PZ.confetti) PZ.confetti();
      }
      lastPhase = s.phase;
    }
  }

  /* ═══════════ Branchement ═══════════ */

  $('#bt-start').addEventListener('click', () => PZ.socket.emit('party:start'));
  $('#bt-skip').addEventListener('click', () => PZ.socket.emit('bt:skip'));
  $('#bt-leave').addEventListener('click', () => {
    stopAudio();
    PZ.socket.emit('party:leave');
    PZ.go('party');
  });
  $('#bt-code').addEventListener('click', async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.code);
      PZ.toast('Code copié — envoie-le à tes potes.', 'success');
    } catch {
      PZ.toast(`Le code est : ${state.code}`, 'info');
    }
  });
  $('#bt-playlist-form').addEventListener('submit', (e) => {
    e.preventDefault();
    loadPlaylist($('#bt-url').value);
  });
  $('#bt-level').addEventListener('click', (e) => {
    const b = e.target.closest('[data-level]');
    if (b) PZ.socket.emit('bt:configure', { level: b.dataset.level });
  });
  $('#bt-rounds').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rounds]');
    if (b) PZ.socket.emit('bt:configure', { rounds: Number(b.dataset.rounds) });
  });
  $('#bt-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#bt-chat-input');
    if (!input.value.trim()) return;
    PZ.socket.emit('party:say', { text: input.value });
    input.value = '';
  });

  // Les touches A, B, C… répondent : à un blindtest, la souris est lente.
  addEventListener('keydown', (e) => {
    if (PZ.view !== 'bt' || !state || state.phase !== 'ecoute' || state.you.answered) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const i = e.key.toUpperCase().charCodeAt(0) - 65;
    if (i >= 0 && i < (state.current ? state.current.choices.length : 0)) {
      PZ.socket.emit('bt:answer', { index: i });
      if (window.SFX) SFX.click();
    }
  });

  PZ.seatFinder['bt'] = (id) => document.querySelector(`#bt-board .bt-player[data-who="${id}"]`);
  $('#bt-chat-form').parentElement.appendChild(PZ.reactionBar());

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__btBound) return;
    socket.__btBound = true;
    socket.on('bt:state', (s) => {
      // On note QUAND on a reçu l'état : c'est ce qui permet de rattraper
      // le temps passé entre l'envoi du serveur et l'affichage.
      s.receivedAt = Date.now();
      render(s);
    });
  }

  PZ.views.bt = {
    enter() { bind(); },
    leave() {
      if (barRaf) cancelAnimationFrame(barRaf);
      barRaf = null;
      // On coupe le son en quittant la page : sinon la musique continue
      // pendant qu'on fait autre chose, et c'est très pénible.
      stopAudio();
    },
  };
})();
