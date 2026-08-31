/* ══════════════════════════════════════════════════════════
   MEMEVAULT — rendu client.

   Le serveur décide de tout (pièces, tirages, combo) ; ici on
   met en scène : la caisse s'ouvre, les cartes se retournent
   une par une, et le son suit la rareté.
   ══════════════════════════════════════════════════════════ */
window.PZVault = (() => {
  let state = null;
  let socket = null;
  let lastPulls = [];
  let log = [];
  let opening = false;
  let comboTimer = null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => window.PZ.util.esc(s);

  function init(sock) {
    socket = sock;
    socket.on('vault:state', (payload) => {
      state = payload.vault;
      if (payload.result) handleResult(payload.result);
      else render();
    });
  }

  function open() {
    if (!socket) return;
    socket.emit('vault:open');
    if (!state) $('#vault-root').innerHTML = '<div class="stage"><p class="muted">Ouverture du coffre…</p></div>';
  }

  function close() {
    clearInterval(comboTimer);
    comboTimer = null;
  }

  function pushLog(message, ok) {
    log.unshift({ message, ok });
    log = log.slice(0, 3);
  }

  /* ─── Mise en scène d'une ouverture ─────────────────── */

  function handleResult(result) {
    if (!result.ok) {
      pushLog(result.message, false);
      window.PZSfx.wrong();
      render();
      return;
    }
    if (!result.pulls) {
      // revente de doublons
      pushLog(result.message, true);
      window.PZSfx.coins();
      render();
      return;
    }

    opening = true;
    lastPulls = [];
    render();
    window.PZSfx.caseOpen();

    // Les cartes se retournent une par une, la dernière est la plus attendue.
    const ordered = result.pulls.slice().sort((a, b) => rarityRank(a.r) - rarityRank(b.r));
    ordered.forEach((pull, i) => {
      setTimeout(() => {
        lastPulls.push(pull);
        window.PZSfx.reveal(pull.r);
        if (['legendary', 'mythic', 'cursed'].includes(pull.r)) {
          window.PZConfetti.fire({
            count: pull.r === 'cursed' ? 200 : pull.r === 'mythic' ? 130 : 70,
            origin: { x: 0.5, y: 0.42 },
          });
        }
        if (i === ordered.length - 1) {
          opening = false;
          const dust = result.dust ? ` · +${result.dust} 🪙 (doublons)` : '';
          pushLog(`${result.caseName} : +${result.xp} XP${dust}`, true);
        }
        render();
      }, 420 + i * 260);
    });
  }

  function rarityRank(r) {
    return ['common', 'rare', 'epic', 'legendary', 'mythic', 'cursed'].indexOf(r);
  }

  /* ─── Rendu ─────────────────────────────────────────── */

  function render() {
    if (!state) return;
    const root = $('#vault-root');
    const col = state.collection;

    root.innerHTML = `
      <div class="vault-head">
        <div>
          <span class="eyebrow">Side quest</span>
          <h2>MemeVault</h2>
        </div>
        <div class="res-row">
          <span class="res coins">🪙 <b id="v-coins">${state.coins.toLocaleString('fr-FR')}</b></span>
          <span class="res combo ${state.combo > 0 ? 'hot' : ''}">🔥 COMBO <b>x${state.comboMult}</b>
            <span class="fine" id="v-combo-left"></span></span>
          <span class="res">📚 <b>${col.have}</b>/${col.total}</span>
        </div>
      </div>

      <div class="vault-grid">
        <div style="display:grid;gap:12px;min-width:0">
          <section class="panel">
            <header class="panel-head">
              <h2>${opening ? 'Ouverture…' : lastPulls.length ? 'Ton butin' : 'Choisis une caisse'}</h2>
              <span class="panel-note">Le combo monte tant que tu enchaînes — il retombe après 90 s.</span>
            </header>
            <div class="opening">
              ${lastPulls.length
                ? `<div class="pull-row">${lastPulls.map(pullHtml).join('')}</div>`
                : `<p class="muted" style="text-align:center;padding:14px 0">
                     Chaque caisse tire un meme au hasard. Les doublons se revendent
                     en pièces, une caisse est offerte toutes les 10 minutes, et si tu es
                     fauché il y a toujours une caisse de secours : tu ne peux jamais rester bloqué.
                   </p>`}
              ${log.length ? `<div class="vault-log">${log.map((l) => `<div class="${l.ok ? 'ok' : 'ko'}">${esc(l.message)}</div>`).join('')}</div>` : ''}
            </div>
          </section>

          <div class="case-list">${state.cases.map(caseHtml).join('')}</div>
        </div>

        <section class="panel collection">
          <header class="panel-head">
            <h2>Collection</h2>
            <span class="panel-note">${col.have} / ${col.total}</span>
          </header>

          <div class="col-bars">
            ${col.byRarity.map((r) => `
              <div class="col-bar">
                <span style="color:${r.color}">${esc(r.name)}</span>
                <span class="track"><i style="width:${(r.have / r.total) * 100}%;background:${r.color}"></i></span>
                <span class="cnt">${r.have}/${r.total}</span>
              </div>`).join('')}
          </div>

          <div class="item-grid">
            ${state.items.map((it) => `
              <div class="item ${it.count ? '' : 'locked'}"
                   data-tip="${esc(it.name)} · ${esc(it.rarity)}${it.count ? ' ×' + it.count : ' — pas encore trouvé'}"
                   style="${it.count ? `border-color:${it.color}` : ''}">
                ${it.count ? it.emoji : '❔'}
                ${it.count > 1 ? `<span class="n">×${it.count}</span>` : ''}
              </div>`).join('')}
          </div>

          <button class="btn btn-soft btn-block" data-act="sell" ${state.duplicates ? '' : 'disabled'}>
            Revendre ${state.duplicates} doublon${state.duplicates > 1 ? 's' : ''}
          </button>
          ${state.best ? `<p class="fine" style="text-align:center">Meilleure trouvaille : <b style="color:${state.best.color}">${state.best.emoji} ${esc(state.best.name)}</b></p>` : ''}
        </section>
      </div>`;

    wire();
    startComboTimer();
  }

  function caseHtml(box) {
    const isFreeCase = box.id === state.freeCaseId;
    const timerFree = state.freeReady && isFreeCase;
    const rescue = !timerFree && state.rescueReady && isFreeCase;
    const free = timerFree || rescue;
    const afford1 = free || state.coins >= box.price;
    const afford5 = state.coins >= box.price * (free ? 4 : 5);
    return `<article class="case" style="--case-glow:${box.color}33;border-color:${box.color}55">
      ${timerFree ? '<span class="case-free">OFFERTE</span>' : rescue ? '<span class="case-free" style="background:var(--info);color:#04203f">SECOURS</span>' : ''}
      <span class="case-emoji">${box.emoji}</span>
      <h3 style="color:${box.color}">${esc(box.name)}</h3>
      <p class="blurb">${esc(box.blurb)}</p>
      <div class="odds">
        ${box.odds.map((o) => `<i style="flex:${o.percent};background:${o.color}"></i>`).join('')}
      </div>
      <div class="odds-legend">
        ${box.odds.filter((o) => o.percent >= 0.05).map((o) => `<span><b style="background:${o.color}"></b>${o.percent}%</span>`).join('')}
      </div>
      <div class="case-price">${free ? 'GRATUIT' : box.price.toLocaleString('fr-FR') + ' 🪙'}</div>
      <div class="case-buttons">
        <button class="btn btn-primary" data-case="${box.id}" data-count="1" ${afford1 && !opening ? '' : 'disabled'}>Ouvrir</button>
        <button class="btn btn-soft" data-case="${box.id}" data-count="5" ${afford5 && !opening ? '' : 'disabled'}>×5</button>
      </div>
    </article>`;
  }

  function pullHtml(pull) {
    const big = ['legendary', 'mythic', 'cursed'].includes(pull.r);
    return `<div class="pull ${big ? 'hi' : ''}" style="--pull-color:${pull.color};--pull-glow:${pull.glow}">
      ${pull.isNew ? '<span class="new">NOUVEAU</span>' : ''}
      <span class="pe">${pull.emoji}</span>
      <span class="pn">${esc(pull.name)}</span>
      <span class="pr">${esc(pull.rarity)}</span>
      <span class="px">+${pull.xp} XP${pull.dust ? ` · +${pull.dust}🪙` : ''}</span>
    </div>`;
  }

  /* ─── Interactions ──────────────────────────────────── */

  function wire() {
    document.querySelectorAll('#vault-root [data-case]').forEach((el) => {
      el.addEventListener('click', () => {
        window.PZSfx.click();
        socket.emit('vault:pull', { caseId: el.dataset.case, count: Number(el.dataset.count) });
      });
    });
    const sell = $('#vault-root [data-act="sell"]');
    if (sell) sell.addEventListener('click', () => socket.emit('vault:sell'));
  }

  /** Petit compte à rebours du combo, pour donner envie d'enchaîner. */
  function startComboTimer() {
    clearInterval(comboTimer);
    const el = $('#v-combo-left');
    if (!el || !state.comboExpiresAt) return;
    const offset = Date.now() - state.serverNow;
    const tick = () => {
      const left = state.comboExpiresAt - (Date.now() - offset);
      if (left <= 0) {
        el.textContent = '';
        clearInterval(comboTimer);
        return;
      }
      el.textContent = Math.ceil(left / 1000) + 's';
    };
    tick();
    comboTimer = setInterval(tick, 500);
  }

  return { init, open, close, render };
})();
