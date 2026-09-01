'use strict';
/**
 * LA MINE — le clicker.
 *
 * Le navigateur anime tout de suite pour que ça reste nerveux, mais c'est
 * le serveur qui compte : il regroupe les coups envoyés, applique
 * l'endurance et plafonne la cadence. Un autoclic vide la barre plus vite
 * et finit par miner à perte — il ne rapporte pas plus qu'une main humaine.
 *
 * Il n'y a plus aucun revenu hors ligne : fermer l'onglet ne rapporte rien.
 */

(() => {
  const { $, fmt, el } = PZ;

  const rock = $('#rock');
  const floaters = $('#floaters');
  const ups = $('#ups');

  let state = null;
  let pending = 0;      // clics pas encore envoyés
  let flushTimer = null;
  let tickTimer = null;
  let localCoins = 0;   // solde affiché entre deux réponses du serveur

  /* ─── Rendu ─── */

  function render(mine) {
    state = mine;
    stamina = mine.stamina;
    $('#mine-perclick').textContent = fmt(mine.perClick);
    $('#mine-crit-r').textContent = Math.round(mine.critChance * 100);
    $('#mine-clicks').textContent = fmt(mine.clicks);
    $('#mine-earned').textContent = fmt(mine.earned);
    $('#mine-crit').textContent = Math.round(mine.critChance * 100);
    $('#mine-critx').textContent = mine.critMult;
    $('#mine-cap').textContent = mine.maxClicksPerSec;
    $('#mine-regen').textContent = String(mine.staminaRegen).replace('.', ',');
    $('#stam-note').textContent =
      `À bout de souffle, chaque coup ne rapporte plus que ${Math.round(mine.tiredFactor * 100)} %.`;
    renderStamina();
    renderUpgrades(mine.upgrades);
  }

  /* ─── L'endurance ─── */

  let stamina = 0;

  function renderStamina() {
    if (!state) return;
    const max = state.staminaMax;
    const value = Math.max(0, Math.min(max, stamina));
    const ratio = value / max;

    $('#stam-val').textContent = `${Math.round(value)} / ${max}`;
    $('#stam-fill').style.width = `${ratio * 100}%`;

    const box = $('.stamina');
    box.classList.toggle('low', ratio <= 0.35 && ratio > 0.02);
    box.classList.toggle('empty', ratio <= 0.02);
  }

  function renderUpgrades(list) {
    ups.replaceChildren();
    list.forEach((up) => {
      const btn = el('button', 'up');
      btn.disabled = up.price === null || !up.affordable;
      if (up.price === null) btn.classList.add('maxed');
      else if (up.affordable) btn.classList.add('can');
      btn.dataset.id = up.id;

      btn.appendChild(el('span', 'ic', up.icon));

      const mid = el('div');
      const nm = el('div', 'nm');
      nm.appendChild(el('span', null, up.name));
      if (up.price === null) nm.appendChild(el('span', 'lv', 'MAX'));
      else if (up.level) nm.appendChild(el('span', 'lv', `niv. ${up.level}`));
      mid.appendChild(nm);
      // Au niveau 0 on annonce simplement ce que ça apportera.
      mid.appendChild(el('div', 'ef',
        up.price === null ? up.effect : up.level ? `${up.effect} → ${up.next}` : up.next));
      btn.appendChild(mid);

      btn.appendChild(el('span', 'pr', up.price === null ? '—' : `${fmt(up.price)} 🪙`));
      ups.appendChild(btn);
    });
  }

  ups.addEventListener('click', (e) => {
    const btn = e.target.closest('.up');
    if (!btn || btn.disabled) return;
    PZ.socket.emit('mine:buy', { id: btn.dataset.id });
  });

  /* ─── Clic ─── */

  function floater(text, crit, tired) {
    const node = el('span', `floater${crit ? ' crit' : ''}${tired ? ' tired' : ''}`, text);
    const box = floaters.getBoundingClientRect();
    node.style.left = `${box.width / 2 - 30 + (Math.random() - 0.5) * 90}px`;
    node.style.top = `${box.height / 2 + (Math.random() - 0.5) * 40}px`;
    floaters.appendChild(node);
    setTimeout(() => node.remove(), 950);
  }

  function flush() {
    flushTimer = null;
    if (!pending || !PZ.socket) return;
    PZ.socket.emit('mine:click', { count: pending });
    pending = 0;
  }

  function hit(e) {
    if (!state) return;
    pending += 1;
    if (!flushTimer) flushTimer = setTimeout(flush, 120);

    // Estimation locale : le serveur corrigera au prochain message.
    const tired = stamina < 1;
    const gain = Math.max(1, Math.round(state.perClick * (tired ? state.tiredFactor : 1)));
    stamina = Math.max(0, stamina - 1);
    renderStamina();
    localCoins += gain;
    PZ.setCoins(localCoins);

    rock.classList.remove('hit');
    void rock.offsetWidth;
    rock.classList.add('hit');
    floater(`+${fmt(gain)}`, false, tired);
    SFX.mine();

    if (e && e.detail === 0) return; // clavier : pas de vibration
    if (navigator.vibrate) navigator.vibrate(8);
  }

  rock.addEventListener('pointerdown', hit);
  rock.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); hit(e); }
  });

  /* ─── Récupération affichée en continu ─── */

  function startTick() {
    stopTick();
    tickTimer = setInterval(() => {
      if (!state) return;
      // On rejoue localement la remontée d'endurance ; le serveur recale au
      // premier coup suivant.
      stamina = Math.min(state.staminaMax, stamina + state.staminaRegen / 5);
      renderStamina();
    }, 200);
  }
  function stopTick() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  }

  /* ─── Messages du serveur ─── */

  document.addEventListener('pz:profile', (e) => {
    // Le serveur fait foi : on recale l'estimation locale.
    localCoins = e.detail.coins;
  });

  function bind() {
    const socket = PZ.socket;
    if (!socket || socket.__mineBound) return;
    socket.__mineBound = true;

    socket.on('mine:state', ({ mine, me, idle, result }) => {
      localCoins = me.coins;
      render(mine);
      if (result) {
        PZ.toast(result.message, result.ok ? 'success' : 'error');
        if (result.ok) SFX.upgrade();
      }
    });

    socket.on('mine:hit', (result) => {
      // Le serveur dit exactement combien de clics il a retenus : on met
      // les compteurs à jour avec ça, sans attendre un état complet.
      if (state && result.counted) {
        state.clicks += result.counted;
        state.earned += result.coins;
        $('#mine-clicks').textContent = fmt(state.clicks);
        $('#mine-earned').textContent = fmt(state.earned);
      }
      // Le serveur fait autorité sur l'endurance.
      if (typeof result.stamina === 'number') {
        stamina = result.stamina;
        renderStamina();
      }
      if (result.tired) {
        PZ.toast('Tu es à bout de souffle — laisse la barre remonter.', 'warn');
      }
      if (result.crits > 0) {
        for (let i = 0; i < result.crits; i++) floater('CRITIQUE !', true);
        SFX.crit();
      }
      if (result.throttled) PZ.toast('Doucement — le serveur plafonne à 20 clics/seconde.', 'warn');
    });
  }

  PZ.views.mine = {
    enter() {
      bind();
      PZ.socket.emit('mine:open');
      startTick();
    },
    leave() {
      flush();
      stopTick();
    },
  };
})();
