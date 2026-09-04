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

  /** Cale le lecteur sur l'extrait de la manche, au bon endroit. */
  async function syncAudio(s) {
    if (!s.current || s.phase !== 'ecoute') return;
    await ensurePlayer();
    if (!ready) return;

    const elapsed = Math.max(0, (Date.now() - (s.serverNow - (s.deadline - s.serverNow) + s.levelMs)) / 1000);
    const at = s.current.offset + Math.min(elapsed, s.levelMs / 1000);

    if (playing !== s.current.videoId) {
      playing = s.current.videoId;
      player.loadVideoById({ videoId: s.current.videoId, startSeconds: at });
      player.setVolume(70);
    }
    try { player.playVideo(); } catch { /* le navigateur peut refuser avant un clic */ }
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
   * Lit une playlist sans clé d'API.
   *
   * On charge la playlist dans un lecteur caché, puis on avance de piste en
   * piste en relevant le titre de chacune. C'est lent — une demi-seconde
   * par morceau — mais ça ne demande ni compte Google ni quota, et ça se
   * fait une fois par soirée.
   */
  async function loadPlaylist(url) {
    const id = playlistIdFrom(url);
    if (!id) return PZ.toast('Colle l’adresse d’une playlist YouTube (elle contient « list= »).', 'error');

    const btn = $('#bt-load');
    btn.disabled = true;
    const status = $('#bt-status');
    status.textContent = 'Ouverture de la playlist…';

    try {
      const YT = await youtubeApi();
      if (!loader) {
        await new Promise((resolve) => {
          loader = new YT.Player('bt-loader', {
            height: '1', width: '1',
            playerVars: { listType: 'playlist', list: id, autoplay: 0, controls: 0 },
            events: { onReady: () => resolve() },
          });
        });
      } else {
        loader.cuePlaylist({ listType: 'playlist', list: id });
        await new Promise((r) => setTimeout(r, 1800));
      }

      const ids = loader.getPlaylist() || [];
      if (!ids.length) throw new Error('playlist vide');

      const tracks = [];
      for (let i = 0; i < ids.length && i < 200; i++) {
        loader.playVideoAt(i);
        loader.pauseVideo();
        // Le titre n'est disponible qu'une fois la vidéo chargée : on laisse
        // au lecteur le temps de basculer.
        await new Promise((r) => setTimeout(r, 420));
        const data = loader.getVideoData() || {};
        if (data.video_id) tracks.push({ id: data.video_id, title: data.title, author: data.author });
        status.textContent = `Lecture de la playlist… ${tracks.length} / ${ids.length}`;
      }
      loader.stopVideo();

      PZ.socket.emit('bt:playlist', { id, title: (loader.getVideoData() || {}).author || '', tracks });
      status.textContent = `${tracks.length} morceaux prêts.`;
    } catch (err) {
      status.textContent = 'Playlist illisible. Vérifie qu’elle est publique.';
      PZ.toast('Impossible de lire cette playlist. Elle doit être publique ou non répertoriée.', 'error');
      void err;
    } finally {
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
    socket.on('bt:state', render);
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
