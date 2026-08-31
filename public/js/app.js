'use strict';
/**
 * Noyau du client : connexion, navigation, profil, classement, présence.
 * Les jeux vivent dans leurs propres fichiers et se branchent sur `PZ`.
 */

const PZ = {
  socket: null,
  me: null,
  profile: null,
  view: 'home',
  views: {}, // nom → { enter(), leave() }
};
window.PZ = PZ;

/* ─── Raccourcis ───────────────────────────────────────── */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
PZ.$ = $;
PZ.$$ = $$;

const NBSP = ' ';
function fmt(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('fr-FR').replace(/ /g, NBSP);
}
PZ.fmt = fmt;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
PZ.el = el;

function avatarUrl(user) {
  if (user && user.avatar) return user.avatar;
  const seed = encodeURIComponent((user && user.name) || '?');
  return `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect width='40' height='40' rx='20' fill='%232f4553'/><text x='20' y='26' font-size='18' text-anchor='middle' fill='%23b1bad3' font-family='sans-serif'>${seed.slice(0, 1).toUpperCase()}</text></svg>`;
}
PZ.avatarUrl = avatarUrl;

/* ─── Notifications ────────────────────────────────────── */

function toast(message, kind = 'info') {
  const box = $('#toasts');
  const node = el('div', `toast ${kind}`, message);
  box.appendChild(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 300);
  }, 3600);
}
PZ.toast = toast;

/* ─── Infobulles ───────────────────────────────────────── */
/* Une seule bulle en position fixe : rien ne peut la rogner. */

const tip = $('#tip');
function showTip(target) {
  const text = target.dataset.tip;
  if (!text) return;
  tip.textContent = text;
  tip.hidden = false;
  const r = target.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  let left = r.left + r.width / 2 - t.width / 2;
  left = Math.max(8, Math.min(left, innerWidth - t.width - 8));
  let top = r.top - t.height - 8;
  if (top < 8) top = r.bottom + 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
function hideTip() { tip.hidden = true; }

document.addEventListener('pointerover', (e) => {
  const t = e.target.closest('[data-tip]');
  if (t) showTip(t); else hideTip();
});
document.addEventListener('focusin', (e) => {
  const t = e.target.closest('[data-tip]');
  if (t) showTip(t); else hideTip();
});
document.addEventListener('pointerdown', hideTip);
addEventListener('scroll', hideTip, true);

/* ─── Fenêtre modale ───────────────────────────────────── */

const modal = $('#modal');
const modalBox = $('#modal-box');

function openModal(node, { closable = true } = {}) {
  modalBox.replaceChildren(node);
  modal.hidden = false;
  modal.dataset.closable = closable ? '1' : '0';
}
function closeModal() {
  modal.hidden = true;
  modalBox.replaceChildren();
}
modal.addEventListener('click', (e) => {
  if (e.target === modal && modal.dataset.closable === '1') closeModal();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.hidden && modal.dataset.closable === '1') closeModal();
});
PZ.openModal = openModal;
PZ.closeModal = closeModal;

/* ─── Navigation ───────────────────────────────────────── */

function go(name) {
  if (!$(`#view-${name}`)) name = 'home';
  const previous = PZ.view;
  if (previous === name) return;

  const leaving = PZ.views[previous];
  if (leaving && leaving.leave) leaving.leave();

  PZ.view = name;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.rail-btn[data-go]').forEach((b) => b.classList.toggle('active', b.dataset.go === name));
  $('.rail').classList.remove('open');
  scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
  history.replaceState(null, '', `#${name}`);

  const entering = PZ.views[name];
  if (entering && entering.enter) entering.enter();

  const statuses = { mine: 'mine', plinko: 'plinko', roulette: 'roulette', blackjack: 'blackjack', vault: 'vault', admin: 'admin' };
  if (PZ.socket) PZ.socket.emit('presence:status', { status: statuses[name] || 'home' });
}
PZ.go = go;

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-go]');
  if (!target) return;
  e.preventDefault();
  go(target.dataset.go);
});

// Le bouton « Admin » du rail n'apparaît qu'une fois les droits obtenus.
// Pour les réclamer la première fois, on tape l'adresse à la main :
// https://mon-site/#admin — d'où l'écoute du changement d'ancre.
addEventListener('hashchange', () => {
  const wanted = location.hash.replace('#', '');
  if (wanted && $(`#view-${wanted}`) && wanted !== PZ.view) go(wanted);
});

$('#btn-menu').addEventListener('click', () => $('.rail').classList.toggle('open'));

/* ─── Champs de mise : ½ / 2× / Max ────────────────────── */

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.bet-input [data-amt]');
  if (!btn) return;
  const input = btn.closest('.bet-input').querySelector('input');
  const coins = PZ.profile ? PZ.profile.coins : 0;
  const min = Number(input.min) || 10;
  let value = Number(input.value) || min;

  if (btn.dataset.amt === 'half') value = Math.floor(value / 2);
  else if (btn.dataset.amt === 'double') value = value * 2;
  else if (btn.dataset.amt === 'max') value = coins;

  input.value = Math.max(min, Math.min(value, Math.max(min, coins)));
  input.dispatchEvent(new Event('change', { bubbles: true }));
});

/* ─── Profil ───────────────────────────────────────────── */

function applyProfile(profile) {
  const before = PZ.profile ? PZ.profile.coins : null;
  PZ.profile = profile;

  $('#coins').textContent = fmt(profile.coins);
  $('#me-level').textContent = profile.level;
  $('#me-name').textContent = PZ.me ? PZ.me.name : '';
  $('#me-avatar').src = avatarUrl(PZ.me);

  $('#stat-coins').textContent = fmt(profile.coins);
  $('#stat-rounds').textContent = fmt(profile.stats.rounds || 0);
  $('#stat-best').textContent = fmt(profile.stats.biggestWin || 0);
  $('#stat-coll').textContent = `${profile.collected || 0}/60`;

  if (profile.fair) {
    $('#fair-hash').textContent = profile.fair.serverSeedHash || '—';
    $('#fair-nonce').textContent = fmt(profile.fair.nonce || 0);
    $('#fair-seed').placeholder = profile.fair.clientSeed || 'ta-graine';
    const prev = profile.fair.previous;
    $('#fair-prev').classList.toggle('hidden', !prev);
    if (prev) {
      $('#fair-prev-seed').textContent = prev.serverSeed;
      $('#fair-prev-hash').textContent = prev.serverSeedHash;
      $('#fair-prev-client').textContent = prev.clientSeed;
    }
  }

  $('#rail-admin').classList.toggle('hidden', !profile.admin);

  if (before !== null && profile.coins !== before) {
    const bal = $('#balance');
    bal.classList.remove('pulse');
    void bal.offsetWidth;
    bal.classList.add('pulse');
  }

  document.dispatchEvent(new CustomEvent('pz:profile', { detail: profile }));
}
PZ.applyProfile = applyProfile;

/** Met à jour le solde localement, sans attendre le serveur. */
PZ.setCoins = (coins) => {
  if (!PZ.profile) return;
  PZ.profile.coins = coins;
  $('#coins').textContent = fmt(coins);
  $('#stat-coins').textContent = fmt(coins);
};

/* ─── Classement ───────────────────────────────────────── */

let lbSort = 'coins';

async function loadLeaderboard() {
  const list = $('#leaderboard');
  try {
    const res = await fetch(`/api/leaderboard?sort=${lbSort}&limit=15`);
    const data = await res.json();
    const rows = data.leaderboard || data.players || [];
    list.replaceChildren();
    if (!rows.length) {
      list.appendChild(el('li', 'empty', 'Personne au tableau. Va miner.'));
      return;
    }
    rows.forEach((p, i) => {
      const li = el('li');
      if (PZ.me && p.id === PZ.me.id) li.classList.add('me');
      li.appendChild(el('span', 'rk', String(i + 1)));

      const img = new Image(30, 30);
      img.src = avatarUrl(p);
      img.alt = '';
      li.appendChild(img);

      const who = el('div', 'who');
      who.appendChild(el('b', 'n', p.name));
      who.appendChild(el('span', 't', `Niv. ${p.level} · ${p.title}`));
      li.appendChild(who);

      li.appendChild(el('span', 'v', lbSort === 'xp' ? `${fmt(p.xp)} XP` : `${fmt(p.coins)} 🪙`));
      list.appendChild(li);
    });
  } catch {
    list.replaceChildren(el('li', 'empty', 'Classement indisponible.'));
  }
}

$('#lb-sort').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  $$('#lb-sort .seg').forEach((b) => b.classList.toggle('active', b === btn));
  lbSort = btn.dataset.sort;
  loadLeaderboard();
});

/* ─── Présence ─────────────────────────────────────────── */

function renderOnline(list) {
  $('#online-count').textContent = list.length;
  const box = $('#online');
  box.replaceChildren();
  list.forEach((p) => {
    const li = el('li');
    li.appendChild(el('span', 'dotlive'));
    const img = new Image(28, 28);
    img.src = avatarUrl(p);
    img.alt = '';
    li.appendChild(img);
    const who = el('div', 'who');
    who.appendChild(el('b', 'n', p.name));
    who.appendChild(el('span', 's', p.statusLabel));
    li.appendChild(who);
    box.appendChild(li);
  });
}

/* ─── Fil des gros coups ───────────────────────────────── */

function pushFeed(entry) {
  const box = $('#feed');
  const first = box.firstElementChild;
  if (first && first.classList.contains('empty')) first.remove();

  const li = el('li');
  const img = new Image(26, 26);
  img.src = avatarUrl(entry);
  img.alt = '';
  li.appendChild(img);

  const txt = el('div', 'txt');
  txt.appendChild(el('b', null, entry.name));
  txt.appendChild(el('span', null, ` · ${entry.game} · ${entry.text}`));
  li.appendChild(txt);

  if (entry.amount) li.appendChild(el('span', 'amt', `+${fmt(entry.amount)}`));
  if (entry.color) li.style.boxShadow = `inset 2px 0 0 ${entry.color}`;

  box.prepend(li);
  while (box.children.length > 30) box.lastElementChild.remove();
}

/* ─── Confettis ────────────────────────────────────────── */

const confettiCanvas = $('#confetti');
const cctx = confettiCanvas.getContext('2d');
let ccParticles = [];
let ccRaf = null;

function confetti(count = 130) {
  confettiCanvas.width = innerWidth;
  confettiCanvas.height = innerHeight;
  confettiCanvas.classList.add('on');
  const colors = ['#00e701', '#f5b544', '#41d3ff', '#8f6bff', '#ff4d5e', '#ffffff'];
  for (let i = 0; i < count; i++) {
    ccParticles.push({
      x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.5,
      y: innerHeight * 0.35 + (Math.random() - 0.5) * 80,
      vx: (Math.random() - 0.5) * 11,
      vy: -6 - Math.random() * 9,
      size: 4 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.28,
      color: colors[(Math.random() * colors.length) | 0],
      life: 1,
    });
  }
  if (!ccRaf) ccRaf = requestAnimationFrame(ccStep);
}
PZ.confetti = confetti;

function ccStep() {
  cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  ccParticles = ccParticles.filter((p) => p.life > 0);
  for (const p of ccParticles) {
    p.vy += 0.33;
    p.vx *= 0.994;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    if (p.y > confettiCanvas.height + 40) p.life = 0;
    cctx.save();
    cctx.translate(p.x, p.y);
    cctx.rotate(p.rot);
    cctx.fillStyle = p.color;
    cctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    cctx.restore();
  }
  if (ccParticles.length) {
    ccRaf = requestAnimationFrame(ccStep);
  } else {
    ccRaf = null;
    confettiCanvas.classList.remove('on');
  }
}

/* ─── Équité ───────────────────────────────────────────── */

$('#fair-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = $('#fair-seed').value.trim();
  if (!value) return toast('Écris une graine.', 'error');
  PZ.socket.emit('fair:rotate', { clientSeed: value });
  $('#fair-seed').value = '';
});

/* ─── Son ──────────────────────────────────────────────── */

$('#btn-sound').addEventListener('click', () => {
  const on = SFX.toggle();
  $('#btn-sound').querySelector('i').textContent = on ? '🔊' : '🔇';
  $('#btn-sound').querySelector('span').textContent = on ? 'Son' : 'Muet';
});

$('#btn-logout').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
});

/* ══════════════ CONNEXION ══════════════ */

async function boot() {
  try {
    const cfg = await (await fetch('/api/config')).json();
    if (!cfg.discord) {
      $('#btn-discord').disabled = true;
      $('#discord-off').classList.remove('hidden');
    }
  } catch { /* sans importance */ }

  let session = null;
  try {
    const res = await fetch('/api/me');
    if (res.ok) session = await res.json();
  } catch { /* non connecté */ }

  if (session && session.user) start(session.user);
  else showAuth();
}

function showAuth() {
  $('#screen-auth').classList.add('active');
  $('#app').classList.remove('active');
}

$('#btn-discord').addEventListener('click', () => { location.href = '/auth/discord'; });

$('#form-guest').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#guest-name').value.trim();
  if (name.length < 2) return toast('Deux lettres minimum.', 'error');
  const res = await fetch('/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return toast('Connexion impossible.', 'error');
  const data = await res.json();
  start(data.user);
});

function start(user) {
  PZ.me = user;
  $('#screen-auth').classList.remove('active');
  $('#app').classList.add('active');

  const socket = io({ transports: ['websocket', 'polling'] });
  PZ.socket = socket;

  socket.on('me', ({ user: u, profile }) => {
    PZ.me = u;
    applyProfile(profile);
  });
  socket.on('profile:update', applyProfile);
  socket.on('toast', ({ message, kind }) => toast(message, kind));
  socket.on('online:list', ({ online }) => renderOnline(online));
  socket.on('feed', pushFeed);

  socket.on('kicked', ({ reason }) => {
    const box = el('div');
    box.appendChild(el('h2', null, 'Session terminée'));
    box.appendChild(el('p', 'fine', reason || 'Tu as été déconnecté.'));
    openModal(box, { closable: false });
  });

  socket.on('disconnect', () => toast('Connexion perdue… ça se reconnecte tout seul.', 'warn'));
  socket.on('connect', () => socket.emit('me:refresh'));

  loadLeaderboard();
  setInterval(loadLeaderboard, 45000);

  const wanted = location.hash.replace('#', '');
  if (wanted && $(`#view-${wanted}`)) go(wanted);
}

boot();
