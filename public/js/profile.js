'use strict';
/**
 * MON PROFIL.
 *
 * Cette page ne calcule presque rien : tout était déjà stocké — total misé,
 * total récupéré, manches jouées, plus gros gain, collection, rang Party,
 * défis du jour — et absolument rien ne l'affichait. Deux heures de travail
 * pour une donnée qui existait depuis le premier jour.
 *
 * Trois partis pris :
 *
 *  · LE BÉNÉFICE NET EST LE PREMIER CHIFFRE. Pas le solde. Le solde dit
 *    combien on a maintenant ; le bénéfice dit si on joue bien. C'est aussi
 *    celui du classement mensuel, donc autant l'afficher là où on le
 *    cherche.
 *
 *  · SA PROPRE REDISTRIBUTION EST AFFICHÉE, MÊME QUAND ELLE EST MAUVAISE.
 *    Un site qui cache le chiffre quand il est défavorable ne mérite pas
 *    qu'on lui fasse confiance sur les autres. Il est comparé au taux
 *    théorique : au-dessus, on a eu de la chance ; en dessous, c'est la
 *    variance, et la page le dit plutôt que de laisser croire à une
 *    malédiction.
 *
 *  · LE PALMARÈS N'EST PAS UN CLASSEMENT DE PLUS. Il répond à une question
 *    précise : qui gagne à quoi. Et il garde la ligne « n'a jamais gagné »,
 *    parce que c'est celle dont on se moque le plus volontiers, et que se
 *    moquer gentiment est la moitié d'une soirée entre potes.
 */

(() => {
  const { $, el, fmt } = PZ;

  const root = $('#me-root');
  let quests = null;
  let palmares = null;

  const GAME_NAME = {
    undercover: 'Undercover', poker: 'Poker', uno: 'Uno',
    belote: 'Belote', monopoly: 'Monopoly', loup: 'Loup-garou',
  };

  /* ─── Briques ─── */

  function stat(value, label, note, tone) {
    const node = el('div', `mstat${tone ? ' ' + tone : ''}`);
    node.appendChild(el('b', null, value));
    node.appendChild(el('span', null, label));
    if (note) node.appendChild(el('i', null, note));
    return node;
  }

  function panel(title, meta) {
    const p = el('section', 'panel');
    p.style.marginTop = '14px';
    const head = el('div', 'panel-head');
    head.appendChild(el('h2', null, title));
    if (meta) head.appendChild(el('span', 'section-meta', meta));
    p.appendChild(head);
    return p;
  }

  /* ─── La page ─── */

  function render() {
    const p = PZ.profile;
    if (!p) return;
    root.replaceChildren();

    /* ── L'en-tête : qui je suis ── */
    const head = el('div', 'me-head');
    const img = new Image(72, 72);
    img.src = PZ.avatarUrl(PZ.me);
    img.alt = '';
    head.appendChild(img);

    const who = el('div', 'me-who');
    who.appendChild(el('h2', null, PZ.me ? PZ.me.name : '—'));
    who.appendChild(el('span', null, `Niveau ${p.level} · ${p.title}`));
    const bar = el('div', 'me-xp');
    const fill = el('i');
    fill.style.width = `${Math.round((p.ratio || 0) * 100)}%`;
    bar.appendChild(fill);
    who.appendChild(bar);
    who.appendChild(el('small', null, p.need
      ? `${fmt(p.into)} / ${fmt(p.need)} XP avant le niveau ${p.level + 1}`
      : 'Niveau maximum atteint.'));
    head.appendChild(who);
    root.appendChild(head);

    /* ── Les chiffres qui comptent ── */
    const st = p.stats || {};
    const wagered = st.wagered || 0;
    const returned = st.returned || 0;
    const net = returned - wagered;
    const rtp = wagered > 0 ? (returned / wagered) * 100 : null;

    const grid = el('div', 'me-grid');
    // Le bénéfice d'abord : c'est lui qui dit si on joue bien, et c'est lui
    // qui décide du classement du mois.
    grid.appendChild(stat(
      `${net >= 0 ? '+' : ''}${fmt(net)}`,
      'bénéfice net',
      net >= 0 ? 'tu es au-dessus de tes mises' : 'la banque a pris sa part',
      net >= 0 ? 'good' : 'bad',
    ));
    grid.appendChild(stat(fmt(p.coins), 'pièces en poche'));
    grid.appendChild(stat(fmt(st.rounds || 0), 'manches jouées'));
    grid.appendChild(stat(fmt(wagered), 'total misé'));
    grid.appendChild(stat(fmt(st.biggestWin || 0), 'plus gros gain'));
    grid.appendChild(stat(
      rtp === null ? '—' : `${rtp.toFixed(1).replace('.', ',')} %`,
      'ta redistribution',
      rtp === null ? 'joue une manche pour la voir'
        : rtp >= 96 ? 'au-dessus du taux annoncé' : 'la variance, pas une malédiction',
    ));
    root.appendChild(grid);

    if (wagered > 0) {
      const note = el('p', 'me-note');
      note.textContent = rtp >= 100
        ? 'Tu as récupéré plus que tu n’as misé. Ça arrive, et ça ne durera pas — les taux du site sont entre 95 et 99,5 %, ce qui veut dire que sur des milliers de manches, la maison gagne un peu. C’est écrit sur chaque tuile.'
        : `Sur ${fmt(st.rounds || 0)} manches, tu as récupéré ${fmt(returned)} des ${fmt(wagered)} misés. Les taux annoncés du site vont de 95 à 99,5 % : plus tu joues, plus ton chiffre s’en approche.`;
      root.appendChild(note);
    }

    /* ── La collection ── */
    const col = panel('Collection', `${fmt(p.collected || 0)} objets sur ${fmt(p.collectionTotal || 518)}`);
    const track = el('div', 'me-collect');
    const cf = el('i');
    cf.style.width = `${Math.round(((p.collected || 0) / (p.collectionTotal || 518)) * 100)}%`;
    track.appendChild(cf);
    col.appendChild(track);
    col.appendChild(el('p', 'fine', `${fmt((p.vault && p.vault.opened) || p.opened || 0)} caisses ouvertes.`));
    const go = el('button', 'btn btn-soft', 'Voir la collection');
    go.addEventListener('click', () => PZ.go('vault'));
    col.appendChild(go);
    root.appendChild(col);

    /* ── Les défis du jour ── */
    if (quests) {
      const q = panel('Défis du jour', `${quests.list.filter((x) => x.done).length}/${quests.list.length} accomplis`);
      const list = el('div', 'me-quests');
      quests.list.forEach((x) => {
        const row = el('div', `me-quest${x.done ? ' done' : ''}`);
        row.appendChild(el('b', null, x.label));
        row.appendChild(el('span', null, x.done ? `+${fmt(x.coins)} ¤ récupéré` : `${fmt(x.at)} / ${fmt(x.goal)}`));
        list.appendChild(row);
      });
      q.appendChild(list);
      root.appendChild(q);
    }

    /* ── Le rang Party ── */
    const party = p.party || { level: 1, title: '—', played: 0, won: 0 };
    const pr = panel('Rang Party', `${party.title} · niveau ${party.level}`);
    const pg = el('div', 'me-grid');
    pg.appendChild(stat(fmt(party.played || 0), 'parties jouées'));
    pg.appendChild(stat(fmt(party.won || 0), 'parties gagnées'));
    pg.appendChild(stat(
      party.played ? `${Math.round((party.won / party.played) * 100)} %` : '—',
      'taux de victoire',
    ));
    pr.appendChild(pg);
    pr.appendChild(el('p', 'fine',
      'Le rang Party ne compte aucune pièce : il compte les soirées passées ensemble.'));
    root.appendChild(pr);

    /* ── Le palmarès ── */
    root.appendChild(renderPalmares());
  }

  function renderPalmares() {
    const box = panel('Le palmarès', palmares
      ? `${fmt(palmares.total)} parties jouées en tout`
      : 'chargement…');

    if (!palmares) return box;
    if (!palmares.table.length) {
      box.appendChild(el('div', 'empty', 'Personne n’a encore fini de partie Party. Ouvrez un salon.'));
      return box;
    }

    palmares.table.forEach((row) => {
      const card = el('div', 'palm');
      const h = el('div', 'palm-head');
      h.appendChild(el('h3', null, GAME_NAME[row.game] || row.game));
      h.appendChild(el('span', null, `${fmt(row.parties)} partie${row.parties > 1 ? 's' : ''} · ${row.joueurs} joueur${row.joueurs > 1 ? 's' : ''}`));
      card.appendChild(h);

      if (!row.top.length) {
        card.appendChild(el('p', 'fine',
          `Pas encore assez de parties pour classer qui que ce soit — il en faut ${palmares.min} par personne.`));
      } else {
        const list = el('ol', 'palm-list');
        row.top.forEach((x, i) => {
          const li = el('li', i === 0 ? 'top' : null);
          li.appendChild(el('span', 'palm-rank', String(i + 1)));
          const face = new Image(24, 24);
          face.src = PZ.avatarUrl(x);
          face.alt = '';
          li.appendChild(face);
          li.appendChild(el('b', null, x.name));
          li.appendChild(el('i', null, `${x.won} sur ${x.played}`));
          li.appendChild(el('em', null, `${x.rate} %`));
          list.appendChild(li);
        });
        card.appendChild(list);
      }

      // La ligne dont on se moque le plus volontiers.
      if (row.jamais.length) {
        const never = el('p', 'palm-never');
        never.textContent = row.jamais.length === 1
          ? `${row.jamais[0]} n’a jamais gagné.`
          : `${row.jamais.slice(0, 4).join(', ')} n’ont jamais gagné.`;
        card.appendChild(never);
      }

      box.appendChild(card);
    });

    return box;
  }

  /* ─── Chargement ─── */

  async function loadPalmares() {
    try {
      const res = await fetch('/api/palmares');
      palmares = await res.json();
    } catch { palmares = { table: [], total: 0, min: 3 }; }
    if (PZ.view === 'me') render();
  }

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__meBound) return;
    socket.__meBound = true;
    const take = ({ quests: q }) => { quests = q; if (PZ.view === 'me') render(); };
    socket.on('quest:state', take);
    socket.on('quest:done', take);
  }

  document.addEventListener('pz:profile', () => { if (PZ.view === 'me') render(); });

  PZ.views.me = {
    enter() {
      bind();
      // Les défis arrivent à la connexion, bien avant qu'on ouvre cette
      // page : on les redemande plutôt que d'afficher un panneau vide.
      if (PZ.socket) PZ.socket.emit('me:refresh');
      render();
      loadPalmares();
    },
  };
})();
