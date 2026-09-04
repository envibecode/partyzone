'use strict';
/**
 * LOUP-GAROU — le village.
 *
 * Cette page ne connaît aucun rôle sauf le sien. Le serveur construit un
 * état PAR joueur : ton rôle, ce que tu as le droit de savoir, et rien
 * d'autre. Ouvrir la console du navigateur ne révèle donc rien — ce n'est
 * pas une précaution d'affichage, c'est la seule façon de faire tenir un
 * jeu de rôles cachés.
 *
 * Quatre partis pris :
 *
 *  · SON RÔLE EST TOUJOURS VISIBLE, EN BAS. On l'oublie au bout de deux
 *    nuits, et le redemander gâche la partie. Il reste affiché, discret,
 *    avec ce qu'il permet de faire.
 *
 *  · LA NUIT, L'ÉCRAN EST NOIR ET NE PROPOSE QU'UNE CHOSE. Le loup vote,
 *    la voyante regarde, la sorcière décide. Les autres dorment, et on le
 *    leur dit franchement plutôt que de leur montrer des boutons morts.
 *
 *  · PENDANT LE DÉBAT, LE CENTRE EST PRESQUE VIDE. C'est voulu : la parole
 *    se passe sur Discord, l'écran n'a rien à y faire. Il compte le temps,
 *    et c'est tout.
 *
 *  · LES MORTS RESTENT AFFICHÉS, AVEC LEUR RÔLE. Découvrir qu'on vient de
 *    brûler la voyante est la moitié du jeu.
 */

(() => {
  const { $, el } = PZ;

  let state = null;
  let barRaf = null;

  const PHASE_TEXT = {
    lobby: 'En attente',
    nuit: 'La nuit tombe',
    matin: 'Au matin',
    debat: 'Le débat',
    vote: 'Au vote',
    bucher: 'Le bûcher',
    chasseur: 'Le chasseur tire',
    over: 'Terminé',
  };

  /* ═══════════ Le village ═══════════ */

  function renderVillage(s) {
    const box = $('#lg-village');
    box.replaceChildren();

    s.players.forEach((p) => {
      const row = el('div', `lg-who${p.alive ? '' : ' dead'}${p.you ? ' you' : ''}${p.wolf ? ' wolf' : ''}`);
      row.dataset.who = p.id;
      if (!p.connected) row.classList.add('away');

      const img = new Image(28, 28);
      img.src = PZ.avatarUrl(p);
      img.alt = '';
      row.appendChild(img);

      const info = el('span', 'lg-who-info');
      const line = el('b');
      line.textContent = p.name;
      // Un loup reconnaît ses semblables : la règle le veut, sans quoi ils
      // ne pourraient pas se coordonner sans parler.
      if (p.wolf && !p.you) line.appendChild(el('i', 'lg-tag wolf', '🐺'));
      info.appendChild(line);

      // Le rôle d'un mort est public : c'est ce qui fait le sel du jeu.
      const sub = el('span');
      if (!p.alive && p.role && s.roles[p.role]) {
        sub.textContent = `${s.roles[p.role].emoji} ${s.roles[p.role].name}`;
      } else if (!p.alive) {
        sub.textContent = 'mort';
      } else if (s.phase === 'vote') {
        sub.textContent = p.voted ? 'a voté' : 'n’a pas voté';
      } else {
        sub.textContent = p.connected ? 'en vie' : 'absent';
      }
      info.appendChild(sub);
      row.appendChild(info);

      // Le vote des loups, entre loups seulement.
      if (p.wolfVote) {
        const t = s.players.find((x) => x.id === p.wolfVote);
        row.appendChild(el('span', 'lg-pick', t ? `→ ${t.name}` : '→'));
      }

      box.appendChild(row);
    });

    // La composition, dans le salon : on doit savoir dans quoi on entre.
    // Elle vient du serveur, qui la calcule avec la vraie règle — une
    // règle recopiée dans le navigateur est une règle qui divergera.
    const compo = $('#lg-compo');
    if (compo && s.compo) compo.textContent = s.compo.text;
  }

  /* ═══════════ La scène ═══════════ */

  function renderScene(s) {
    const box = $('#lg-scene');
    box.replaceChildren();
    box.className = `lg-scene ph-${s.phase}`;

    if (s.phase === 'lobby') {
      box.appendChild(el('h2', null, 'Le village dort encore'));
      box.appendChild(el('p', null,
        'Le site tient les rôles, les nuits et les votes. Le débat, lui, se fait de vive voix — '
        + 'mettez-vous sur un salon vocal Discord avant de lancer.'));
      return;
    }

    if (s.phase === 'nuit') {
      box.appendChild(el('h2', null, `Nuit ${s.night}`));
      box.appendChild(el('p', null, 'Le village s’endort. Fermez les yeux.'));
      return;
    }

    if (s.phase === 'matin' && s.lastNight) {
      box.appendChild(el('h2', null, 'Le jour se lève'));
      const dead = s.lastNight.dead || [];
      if (!dead.length) {
        box.appendChild(el('p', null, s.lastNight.saved
          ? 'Personne n’est mort cette nuit. Quelqu’un a été sauvé.'
          : 'Personne n’est mort cette nuit.'));
      } else {
        dead.forEach((d) => {
          const line = el('p', 'lg-death');
          line.textContent = s.revealRoles && s.roles[d.role]
            ? `${d.name} est mort${d.how === 'potion' ? ' empoisonné' : ' dévoré'} — c’était ${s.roles[d.role].name}.`
            : `${d.name} est mort${d.how === 'potion' ? ' empoisonné' : ' dévoré'}.`;
          box.appendChild(line);
        });
      }
      return;
    }

    if (s.phase === 'debat') {
      box.appendChild(el('h2', null, 'Parlez'));
      box.appendChild(el('p', null,
        'C’est le moment de vous accuser les uns les autres. À voix haute, sur Discord — '
        + 'l’écran ne fait que compter le temps.'));
      return;
    }

    if (s.phase === 'vote') {
      box.appendChild(el('h2', null, 'Qui envoie-t-on au bûcher ?'));
      const voted = s.players.filter((p) => p.alive && p.voted).length;
      const alive = s.players.filter((p) => p.alive).length;
      box.appendChild(el('p', null, `${voted} sur ${alive} ont voté. En cas d’égalité, personne ne meurt.`));
      return;
    }

    if (s.phase === 'bucher' && s.lastVote) {
      box.appendChild(el('h2', null, s.lastVote.tie ? 'Égalité' : 'Le bûcher'));
      const list = el('div', 'lg-tally');
      s.lastVote.counts.forEach((c) => {
        const row = el('div', c.id === s.lastVote.out ? 'out' : null);
        row.appendChild(el('span', null, c.name));
        row.appendChild(el('b', null, String(c.votes)));
        list.appendChild(row);
      });
      box.appendChild(list);
      if (s.lastVote.tie) {
        box.appendChild(el('p', null, 'Personne n’est brûlé aujourd’hui.'));
      }
      return;
    }

    if (s.phase === 'chasseur' && s.shot) {
      box.appendChild(el('h2', null, 'Le chasseur tire'));
      box.appendChild(el('p', null, s.shot.mine
        ? 'Tu meurs — mais tu emportes quelqu’un avec toi.'
        : `${s.shot.byName} était le chasseur. Il désigne sa dernière cible.`));
      return;
    }

    if (s.phase === 'over' && s.result) {
      box.appendChild(el('h2', 'lg-win', s.result.camp === 'loups'
        ? 'Les loups ont mangé le village'
        : 'Le village a éliminé tous les loups'));
      box.appendChild(el('p', null, `${s.result.nights} nuit${s.result.nights > 1 ? 's' : ''}.`));

      const table = el('div', 'lg-final');
      s.result.table.forEach((t) => {
        const row = el('div', t.won ? 'won' : null);
        row.appendChild(el('span', 'lg-final-emoji', t.emoji));
        row.appendChild(el('b', null, t.name));
        row.appendChild(el('i', null, t.roleName));
        row.appendChild(el('em', null, t.won ? 'gagne' : ''));
        table.appendChild(row);
      });
      box.appendChild(table);
    }
  }

  /* ═══════════ Son rôle, toujours visible ═══════════ */

  function renderRole(s) {
    const box = $('#lg-role');
    box.replaceChildren();
    if (!s.you.role) { box.hidden = true; return; }
    box.hidden = false;

    const card = el('div', `lg-card camp-${s.you.camp}${s.you.alive ? '' : ' dead'}`);
    card.appendChild(el('span', 'lg-card-emoji', s.you.emoji));
    const body = el('div');
    body.appendChild(el('b', null, s.you.alive ? s.you.roleName : `${s.you.roleName} — mort`));
    body.appendChild(el('span', null, s.you.alive
      ? s.you.blurb
      : 'Tu peux suivre la partie et parler aux autres morts. Les vivants ne te lisent pas.'));
    card.appendChild(body);
    box.appendChild(card);

    // Ce que la voyante a découvert, gardé sous les yeux : le retenir de
    // tête sur cinq nuits est le vrai jeu, mais pas au prix d'une erreur.
    if (s.you.seen && s.you.seen.length) {
      const seen = el('div', 'lg-seen');
      seen.appendChild(el('b', null, 'Ce que tu as vu'));
      s.you.seen.forEach((x) => {
        const row = el('div', s.roles[x.role].camp === 'loups' ? 'wolf' : null);
        row.appendChild(el('span', null, x.name));
        row.appendChild(el('i', null, `${s.roles[x.role].emoji} ${s.roles[x.role].name}`));
        seen.appendChild(row);
      });
      box.appendChild(seen);
    }
  }

  /* ═══════════ Ce qu'on peut faire ═══════════ */

  function targets(s, { exclude = [], onlyAlive = true } = {}) {
    return s.players.filter((p) => (onlyAlive ? p.alive : true) && !exclude.includes(p.id));
  }

  function pickGrid(s, list, onPick, current) {
    const grid = el('div', 'lg-grid');
    list.forEach((p) => {
      const b = el('button', `lg-pickbtn${current === p.id ? ' on' : ''}`);
      const img = new Image(30, 30);
      img.src = PZ.avatarUrl(p);
      img.alt = '';
      b.appendChild(img);
      b.appendChild(el('span', null, p.name));
      b.addEventListener('click', () => onPick(p.id));
      grid.appendChild(b);
    });
    void s;
    return grid;
  }

  function renderActions(s) {
    const box = $('#lg-actions');
    box.replaceChildren();
    const emit = (ev, payload) => PZ.socket.emit(ev, payload || {});

    if (s.phase === 'lobby' || s.phase === 'over') return;

    if (!s.you.alive) {
      box.appendChild(el('p', 'lg-hint',
        'Tu es mort. Tu vois tout, tu ne votes plus, et ce que tu écris n’est lu que par les autres morts.'));
      return;
    }

    /* ── Le chasseur ── */
    if (s.phase === 'chasseur') {
      if (!s.shot || !s.shot.mine) {
        box.appendChild(el('p', 'lg-hint', 'On attend son choix.'));
        return;
      }
      box.appendChild(el('p', 'lg-hint', 'Désigne qui part avec toi.'));
      box.appendChild(pickGrid(s, targets(s, { exclude: [s.you.id] }), (id) => emit('lg:shoot', { id })));
      return;
    }

    /* ── La nuit ── */
    if (s.phase === 'nuit') {
      if (s.you.role === 'loup') {
        box.appendChild(el('p', 'lg-hint', 'Choisissez votre victime. Vous voyez vos votes mutuels.'));
        box.appendChild(pickGrid(s,
          targets(s, { exclude: s.players.filter((p) => p.wolf).map((p) => p.id) }),
          (id) => emit('lg:wolf', { id }),
          s.you.wolfTarget));
        return;
      }

      if (s.you.role === 'voyante') {
        if (s.you.looked) {
          box.appendChild(el('p', 'lg-hint', 'Tu as regardé cette nuit. Garde-le pour toi — ou pas.'));
          return;
        }
        box.appendChild(el('p', 'lg-hint', 'De qui veux-tu connaître le rôle ?'));
        box.appendChild(pickGrid(s, targets(s, { exclude: [s.you.id] }), (id) => emit('lg:seer', { id })));
        return;
      }

      if (s.you.role === 'sorciere') {
        const w = s.you.witch;
        const wrap = el('div', 'lg-witch');

        if (w.victim) {
          const line = el('p', 'lg-hint');
          line.textContent = `Les loups dévorent ${w.victimName}.`;
          wrap.appendChild(line);
          if (w.heal) {
            const heal = el('button', 'btn btn-primary btn-block', `Sauver ${w.victimName}`);
            heal.dataset.tip = 'Une seule fois pour toute la partie';
            heal.addEventListener('click', () => emit('lg:witch', { heal: true }));
            wrap.appendChild(heal);
          } else if (w.saved) {
            wrap.appendChild(el('p', 'lg-hint', 'Tu l’as sauvé.'));
          } else {
            wrap.appendChild(el('p', 'lg-hint', 'Tu n’as plus de potion de vie.'));
          }
        } else {
          wrap.appendChild(el('p', 'lg-hint', 'Les loups n’ont pas encore choisi.'));
        }

        if (w.kill) {
          wrap.appendChild(el('p', 'lg-hint', 'Tu peux aussi empoisonner quelqu’un — une seule fois.'));
          wrap.appendChild(pickGrid(s, targets(s, { exclude: [s.you.id] }), (id) => {
            if (confirm('Empoisonner cette personne ? Tu n’as qu’une potion de mort.')) emit('lg:witch', { kill: id });
          }));
        } else if (w.killed) {
          wrap.appendChild(el('p', 'lg-hint', 'Ta potion de mort est utilisée.'));
        }

        box.appendChild(wrap);
        return;
      }

      box.appendChild(el('p', 'lg-hint', 'Tu dors. Rien à faire cette nuit — écoute le silence.'));
      return;
    }

    /* ── Le débat ── */
    if (s.phase === 'debat') {
      if (s.hostId === s.you.id) {
        const skip = el('button', 'btn btn-soft', 'Passer au vote');
        skip.dataset.tip = 'Quand tout le monde a parlé';
        skip.addEventListener('click', () => emit('lg:skip-debate'));
        box.appendChild(skip);
      }
      return;
    }

    /* ── Le vote ── */
    if (s.phase === 'vote') {
      box.appendChild(pickGrid(s, targets(s, { exclude: [s.you.id] }),
        (id) => emit('lg:vote', { id }), s.you.voted));
      const blank = el('button', 'btn btn-ghost', 'S’abstenir');
      blank.addEventListener('click', () => emit('lg:vote', { id: null }));
      box.appendChild(blank);
    }
  }

  /* ═══════════ Journal et chrono ═══════════ */

  function renderLog(s) {
    const box = $('#lg-log');
    box.replaceChildren();
    s.log.slice(0, 14).forEach((line) => {
      box.appendChild(el('div', `lg-line ${line.kind || ''}`.trim(), line.text));
    });
  }

  function renderBar(s) {
    if (barRaf) cancelAnimationFrame(barRaf);
    const bar = $('#lg-bar');
    const live = ['nuit', 'debat', 'vote', 'chasseur'].includes(s.phase);
    if (!s.deadline || !live) { bar.style.width = '0%'; return; }
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

  /* ═══════════ Rendu ═══════════ */

  let lastPhase = null;

  function render(s) {
    state = s;
    PZ.watchBanner(s);
    $('#view-lg').classList.toggle('watching', Boolean(s.watching));
    $('#lg-code').textContent = s.code;
    $('#lg-phase').textContent = PHASE_TEXT[s.phase] || s.phase;
    $('#view-lg').dataset.phase = s.phase;

    const host = s.hostId === s.you.id;
    $('#lg-start').classList.toggle('hidden', !(host && (s.phase === 'lobby' || s.phase === 'over')));
    $('#lg-settings').classList.toggle('hidden', !(host && s.phase === 'lobby'));
    [...$('#lg-debate').children].forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.debate) * 1000 === s.debateMs);
    });
    $('#lg-reveal').checked = Boolean(s.revealRoles);

    renderVillage(s);
    renderScene(s);
    renderRole(s);
    renderActions(s);
    renderLog(s);
    renderBar(s);
    PZ.roomChat($('#lg-chat'), s.chat);

    // Un son au changement de phase : la nuit tombe, le jour se lève. C'est
    // ce qui permet de suivre la partie en regardant ses potes plutôt que
    // son écran.
    if (window.SFX && s.phase !== lastPhase && s.phase !== 'lobby') {
      if (s.phase === 'nuit') SFX.jail();
      else if (s.phase === 'matin') SFX.reveal('rare');
      else if (s.phase === 'over') SFX.fanfare();
      else SFX.click();
    }
    lastPhase = s.phase;
  }

  /* ═══════════ Branchement ═══════════ */

  $('#lg-start').addEventListener('click', () => PZ.socket.emit('party:start'));
  $('#lg-leave').addEventListener('click', () => {
    PZ.socket.emit('party:leave');
    PZ.go('party');
  });
  $('#lg-code').addEventListener('click', async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.code);
      PZ.toast('Code copié — envoie-le à tes potes.', 'success');
    } catch {
      PZ.toast(`Le code est : ${state.code}`, 'info');
    }
  });
  $('#lg-debate').addEventListener('click', (e) => {
    const b = e.target.closest('[data-debate]');
    if (b) PZ.socket.emit('lg:configure', { debate: Number(b.dataset.debate) });
  });
  $('#lg-reveal').addEventListener('change', (e) => {
    PZ.socket.emit('lg:configure', { revealRoles: e.target.checked });
  });
  $('#lg-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#lg-chat-input');
    if (!input.value.trim()) return;
    PZ.socket.emit('party:say', { text: input.value });
    input.value = '';
  });

  PZ.seatFinder['lg'] = (id) => document.querySelector(`#lg-village .lg-who[data-who="${id}"]`);
  $('#lg-chat-form').parentElement.appendChild(PZ.reactionBar());

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__lgBound) return;
    socket.__lgBound = true;
    socket.on('lg:state', render);
  }

  PZ.views.lg = {
    enter() { bind(); },
    leave() { if (barRaf) cancelAnimationFrame(barRaf); barRaf = null; },
  };
})();
