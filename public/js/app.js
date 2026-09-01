'use strict';
/**
 * Noyau du client : connexion, navigation, profil, notifications.
 * Chaque écran vit dans son propre fichier et se branche sur `PZ.views`.
 */

const PZ = {
  socket: null,
  me: null,
  profile: null,
  view: 'home',
  views: {},
};
window.PZ = PZ;

/* ─── Raccourcis ───────────────────────────────────────── */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
PZ.$ = $;
PZ.$$ = $$;

const NBSP = ' ';
function fmt(n) {
  return (Math.round(Number(n) || 0)).toLocaleString('fr-FR').replace(/ /g, NBSP);
}
/** Format court pour les petits espaces : 12,4 k / 3,2 M. */
function fmtShort(n) {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', ',')} M`;
  if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(1).replace('.', ',')} k`;
  return fmt(v);
}
PZ.fmt = fmt;
PZ.fmtShort = fmtShort;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
PZ.el = el;

function avatarUrl(user) {
  if (user && user.avatar) return user.avatar;
  const letter = ((user && user.name) || '?').slice(0, 1).toUpperCase();
  const safe = letter.replace(/[<>&"]/g, '?');
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect width='40' height='40' rx='20' fill='#1e293e'/><text x='20' y='27' font-size='18' font-weight='700' text-anchor='middle' fill='#93a1bb' font-family='sans-serif'>${safe}</text></svg>`
  )}`;
}
PZ.avatarUrl = avatarUrl;

const timeOf = (at) => new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
PZ.timeOf = timeOf;

/* ─── Notifications ────────────────────────────────────── */

function toast(message, kind = 'info') {
  const box = $('#toasts');
  const node = el('div', `toast ${kind}`, message);
  box.appendChild(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 300);
  }, 3800);
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
  let top = r.top - t.height - 9;
  if (top < 8) top = r.bottom + 9;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
const hideTip = () => { tip.hidden = true; };

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

const STATUS = {
  mine: 'mine', plinko: 'plinko', roulette: 'roulette',
  blackjack: 'blackjack', vault: 'vault', slots: 'slots',
  medals: 'medals', admin: 'admin',
  party: 'party', uc: 'undercover', pk: 'poker', market: 'market', soon: 'home',
};

function go(name) {
  if (!$(`#view-${name}`)) name = 'home';
  if (PZ.view === name) return;

  const leaving = PZ.views[PZ.view];
  if (leaving && leaving.leave) leaving.leave();

  PZ.view = name;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.topnav-btn[data-go]').forEach((b) => b.classList.toggle('active', b.dataset.go === name));
  scrollTo({ top: 0 });
  history.replaceState(null, '', `#${name}`);

  const entering = PZ.views[name];
  if (entering && entering.enter) entering.enter();

  if (PZ.socket) PZ.socket.emit('presence:status', { status: STATUS[name] || 'home' });
}
PZ.go = go;

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-go]');
  if (!target) return;
  e.preventDefault();
  go(target.dataset.go);
});

// Le bouton « Admin » reste caché tant qu'on n'a pas les droits : pour les
// réclamer la première fois, on tape l'adresse suivie de #admin.
addEventListener('hashchange', () => {
  const wanted = location.hash.replace('#', '');
  if (wanted && $(`#view-${wanted}`) && wanted !== PZ.view) go(wanted);
});

const menuBtn = $('#btn-menu');
if (menuBtn) {
  menuBtn.addEventListener('click', () => {
    const nav = $('#nav-left');
    nav.classList.toggle('open');
    $('#nav-right').classList.toggle('open');
  });
}

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

/** Les classes posées par une parure — les seules qu'on ait le droit de retirer. */
const COSMETIC_CLASS = /^(cos-|frame-|name-|badge-)/;

function applyProfile(profile) {
  const before = PZ.profile ? PZ.profile.coins : null;
  PZ.profile = profile;

  setCoinsDisplay(profile.coins);
  $('#me-level').textContent = profile.level;
  $('#me-name').textContent = PZ.me ? PZ.me.name : '';
  $('#me-title').textContent = profile.title;
  $('#me-avatar').src = avatarUrl(PZ.me);

  // Ses propres parures, dans le bandeau du haut : c'est là qu'on les regarde
  // le plus souvent. On repart à zéro à chaque fois, sinon changer de parure
  // empilerait les classes de l'ancienne et de la nouvelle.
  const avatar = $('#me-avatar');
  const nameSlot = $('#me-name');
  [avatar, nameSlot].forEach((node) => {
    [...node.classList].filter((c) => COSMETIC_CLASS.test(c)).forEach((c) => node.classList.remove(c));
  });
  const oldBadge = nameSlot.parentNode && nameSlot.parentNode.querySelector('.cos-badge');
  if (oldBadge) oldBadge.remove();
  if (PZ.applyCosmetics) PZ.applyCosmetics(null, profile.cosmetics, { avatar, name: nameSlot });

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

  $('#nav-admin').classList.toggle('hidden', !profile.admin);

  if (before !== null && profile.coins !== before) {
    const bal = $('#balance');
    bal.classList.remove('pulse');
    void bal.offsetWidth;
    bal.classList.add('pulse');
  }

  document.dispatchEvent(new CustomEvent('pz:profile', { detail: profile }));
}
PZ.applyProfile = applyProfile;

function setCoinsDisplay(coins) {
  $('#coins').textContent = fmtShort(coins);
  const tk = $('#tk-coins');
  if (tk) tk.textContent = fmt(coins);
}

/**
 * Solde affiché.
 *
 * Certains jeux — la roulette en tête — encaissent avant la fin de
 * l'animation. Si on montrait le solde tout de suite, on saurait qu'on a
 * gagné avant même que la bille s'arrête. Un écran peut donc geler
 * l'affichage le temps du suspense, puis le relâcher.
 */
let coinsFrozen = false;
let coinsPending = null;

PZ.setCoins = (coins) => {
  if (!PZ.profile) return;
  PZ.profile.coins = coins;
  if (coinsFrozen) { coinsPending = coins; return; }
  setCoinsDisplay(coins);
};

PZ.freezeCoins = () => { coinsFrozen = true; };
PZ.unfreezeCoins = () => {
  coinsFrozen = false;
  if (coinsPending !== null) {
    setCoinsDisplay(coinsPending);
    const bal = $('#balance');
    bal.classList.remove('pulse');
    void bal.offsetWidth;
    bal.classList.add('pulse');
    coinsPending = null;
  }
};

/* ─── Confettis ────────────────────────────────────────── */

const confettiCanvas = $('#confetti');
const cctx = confettiCanvas.getContext('2d');
let ccParticles = [];
let ccRaf = null;

function confetti(count = 130) {
  confettiCanvas.width = innerWidth;
  confettiCanvas.height = innerHeight;
  confettiCanvas.classList.add('on');
  const colors = ['#2ee66b', '#ffc23d', '#3fd6ff', '#8b6bff', '#ff4d6a', '#ffffff'];
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

/* ─── Classement ───────────────────────────────────────── */

let lbSort = 'coins';
let lbTimer = null;

async function loadLeaderboard() {
  const list = $('#leaderboard');
  if (!list) return;
  try {
    const data = await (await fetch(`/api/leaderboard?sort=${lbSort}&limit=20`)).json();
    const rows = data.leaderboard || [];
    list.replaceChildren();
    if (!rows.length) {
      list.appendChild(el('li', 'empty', lbSort === 'party'
        ? 'Personne n’a encore joué en Party. Ouvre un salon.'
        : 'Personne au tableau. Va miner.'));
      return;
    }
    rows.forEach((p, i) => {
      const li = el('li');
      if (PZ.me && p.id === PZ.me.id) li.classList.add('me');
      li.appendChild(el('span', 'rk', String(i + 1)));

      const img = new Image(34, 34);
      img.src = avatarUrl(p);
      img.alt = '';
      li.appendChild(img);

      const who = el('div', 'who');
      const nameNode = el('b', 'n', p.name);
      who.appendChild(nameNode);
      if (PZ.applyCosmetics) PZ.applyCosmetics(li, p.cosmetics, { avatar: img, name: nameNode });
      // Le classement Party affiche le rang Party, pas celui du casino :
      // ce sont deux progressions séparées et les mélanger n'aurait aucun sens.
      who.appendChild(el('span', 't', lbSort === 'party' && p.party
        ? `Party niv. ${p.party.level} · ${p.party.title}`
        : `Niv. ${p.level} · ${p.title}`));
      li.appendChild(who);

      li.appendChild(el('span', 'v',
        lbSort === 'party' ? `${fmt(p.party ? p.party.xp : 0)} XP 🎈`
          : lbSort === 'xp' ? `${fmt(p.xp)} XP`
            : `${fmt(p.coins)} 🪙`));
      list.appendChild(li);
    });
  } catch {
    list.replaceChildren(el('li', 'empty', 'Classement indisponible.'));
  }
}
PZ.loadLeaderboard = loadLeaderboard;

$('#lb-sort').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  $$('#lb-sort .seg').forEach((b) => b.classList.toggle('active', b === btn));
  lbSort = btn.dataset.sort;
  loadLeaderboard();
});

PZ.views.leaderboard = {
  enter() {
    loadLeaderboard();
    // Tant qu'on regarde le classement, il se rafraîchit tout seul.
    lbTimer = setInterval(loadLeaderboard, 12000);
  },
  leave() { clearInterval(lbTimer); lbTimer = null; },
};

/* ─── Le fil des gros coups ────────────────────────────── */

function pushFeed(entry) {
  const box = $('#feed');
  const first = box.firstElementChild;
  if (first && first.classList.contains('empty')) first.remove();

  const li = el('li');
  const img = new Image(28, 28);
  img.src = avatarUrl(entry);
  img.alt = '';
  li.appendChild(img);

  const txt = el('div', 'txt');
  txt.appendChild(el('b', null, entry.name));
  txt.appendChild(el('span', null, ` · ${entry.game} · ${entry.text}`));
  li.appendChild(txt);

  if (entry.amount) li.appendChild(el('span', 'amt', `+${fmtShort(entry.amount)}`));
  if (entry.color) li.style.boxShadow = `inset 3px 0 0 ${entry.color}`;

  box.prepend(li);
  while (box.children.length > 40) box.lastElementChild.remove();
}

/* ─── Annonces de l'administration ─────────────────────── */

/**
 * Une annonce ne doit pas se rater : au lieu d'un petit bandeau, on ouvre
 * une fenêtre avec une scène animée. Elles sont dessinées en CSS, il n'y a
 * donc aucun fichier à télécharger et rien ne dépend d'un service extérieur.
 */
const STICKERS = [
  { emoji: '📣', anim: 'shout',  colour: '#ffc23d' },
  { emoji: '🎉', anim: 'burst',  colour: '#2ee66b' },
  { emoji: '🚨', anim: 'siren',  colour: '#ff4d6a' },
  { emoji: '🎰', anim: 'shake',  colour: '#8b6bff' },
  { emoji: '🪩', anim: 'spin',   colour: '#3fd6ff' },
  { emoji: '🍀', anim: 'bounce', colour: '#2ee66b' },
  { emoji: '👀', anim: 'peek',   colour: '#ffc23d' },
  { emoji: '🔥', anim: 'flame',  colour: '#ff8a3d' },
];

function announce(text, kind = 'info') {
  // Un jackpot n'a pas la même tête qu'une annonce de l'administration : il
  // est doré, il dure plus longtemps, et il ne demande pas la permission.
  const jackpot = kind === 'jackpot';
  const pick = jackpot
    ? { emoji: '👑', colour: '#ffc23d', anim: 'an-pop' }
    : STICKERS[(Math.random() * STICKERS.length) | 0];
  const box = el('div', `announce${jackpot ? ' jackpot' : ''}`);
  box.style.setProperty('--c', pick.colour);

  const scene = el('div', 'announce-scene');
  scene.appendChild(el('span', `sticker ${pick.anim}`, pick.emoji));
  for (let i = 0; i < 6; i++) {
    const spark = el('span', 'spark');
    spark.style.setProperty('--i', String(i));
    scene.appendChild(spark);
  }
  box.appendChild(scene);

  box.appendChild(el('div', 'announce-kicker', jackpot ? 'JACKPOT' : 'Annonce'));
  box.appendChild(el('p', 'announce-text', text));

  const close = el('button', 'btn btn-gold modal-close', jackpot ? 'Chapeau' : 'Compris');
  close.addEventListener('click', closeModal);
  box.appendChild(close);

  openModal(box);
  SFX.fanfare();
  confetti(jackpot ? 220 : 70);
  if (jackpot) setTimeout(() => confetti(160), 700);
}
PZ.announce = announce;

/* ─── Équité ───────────────────────────────────────────── */

$('#fair-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = $('#fair-seed').value.trim();
  if (!value) return toast('Écris une graine.', 'error');
  PZ.socket.emit('fair:rotate', { clientSeed: value });
  $('#fair-seed').value = '';
});

/* ══════════════ CONNEXION ══════════════ */

/* ═══════════ L'INTRO ═══════════ */

/**
 * « Bienvenue dans la Taverne ». Les portes s'ouvrent, les braises montent,
 * et on entre.
 *
 * Une seule fois par session d'onglet : la première visite, c'est une
 * arrivée ; à la dixième actualisation de la page, c'est un obstacle. Le
 * bouton « passer » coupe court à tout moment, et l'intro est sautée
 * d'office quand on arrive directement sur le panel admin.
 *
 * Volontairement muette : les navigateurs bloquent le son tant que la page
 * n'a pas été cliquée, donc une fanfare ici ne se déclencherait qu'une fois
 * sur deux — ce qui est pire que pas de fanfare du tout.
 */
const INTRO_SEEN = 'pz.intro.seen';

function playIntro() {
  const node = $('#intro');
  if (!node) return Promise.resolve();

  let seen = false;
  try { seen = sessionStorage.getItem(INTRO_SEEN) === '1'; } catch { /* navigation privée */ }
  if (seen || location.hash === '#admin') { node.remove(); return Promise.resolve(); }

  try { sessionStorage.setItem(INTRO_SEEN, '1'); } catch { /* tant pis */ }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      node.classList.add('leaving');
      setTimeout(() => { node.remove(); resolve(); }, 800);
    };

    node.hidden = false;
    $('#intro-skip').addEventListener('click', finish);
    // Les portes finissent de s'ouvrir à 4,1 s ; on laisse respirer un instant.
    setTimeout(finish, 4600);
  });
}

async function boot() {
  const intro = playIntro();

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

  // On laisse l'intro se terminer avant de découvrir le site : les deux
  // choses se chargent en parallèle, mais s'affichent l'une après l'autre.
  await intro;

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

/* ─── Le menu du compte ─── */

const meMenu = $('#me-menu');
$('#me-chip').addEventListener('click', (e) => {
  e.stopPropagation();
  meMenu.hidden = !meMenu.hidden;
});
document.addEventListener('click', (e) => {
  if (!meMenu.hidden && !e.target.closest('.me-wrap')) meMenu.hidden = true;
});
meMenu.addEventListener('click', () => { meMenu.hidden = true; });

/**
 * Changer de compte.
 *
 * Se connecter avec le mauvais compte Discord arrive tout le temps, et sans
 * ce bouton il faut aller vider ses cookies pour s'en sortir. On efface la
 * session côté serveur puis on recharge : on retombe sur l'écran d'accueil.
 */
$('#btn-logout').addEventListener('click', async () => {
  const box = el('div');
  box.appendChild(el('h2', null, 'Changer de compte ?'));
  box.appendChild(el('p', 'fine',
    'Ta progression est enregistrée sur ce compte : tu la retrouveras en te ' +
    'reconnectant avec. Si tu joues en invité en revanche, ce compte-là ne ' +
    'sera plus accessible — un invité n’a pas de mot de passe pour revenir.'));

  const actions = el('div', 'modal-actions');
  const ok = el('button', 'btn btn-danger', 'Me déconnecter');
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    try { await fetch('/auth/logout', { method: 'POST' }); } catch { /* on recharge quand même */ }
    location.href = '/';
  });
  const cancel = el('button', 'btn btn-soft', 'Rester connecté');
  cancel.addEventListener('click', closeModal);
  actions.appendChild(ok);
  actions.appendChild(cancel);
  box.appendChild(actions);

  openModal(box);
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
  socket.on('feed', pushFeed);
  socket.on('announce', ({ text, kind }) => announce(text, kind));

  // Un renommage par l'administration : le pseudo change sous nos yeux.
  socket.on('me:renamed', ({ name }) => {
    if (PZ.me) PZ.me.name = name;
    if (PZ.profile) applyProfile(PZ.profile);
  });

  // Un cadeau peut arriver n'importe quand : on écoute ici, pas dans la page
  // des caisses, sinon on ne le saurait qu'en allant y faire un tour.
  socket.on('gift:received', (gift) => {
    const who = gift.admin ? `L’administration (${gift.from})` : gift.from;
    toast(`🎁 ${who} t’offre ${gift.count} × ${gift.caseName} ! Ouvre-la dans les caisses.`, 'success');
    if (window.SFX) SFX.fanfare();
  });

  socket.on('kicked', ({ reason }) => {
    const box = el('div');
    box.appendChild(el('h2', null, 'Session terminée'));
    box.appendChild(el('p', 'fine', reason || 'Tu as été déconnecté.'));
    openModal(box, { closable: false });
  });

  socket.on('disconnect', () => toast('Connexion perdue… ça se reconnecte tout seul.', 'warn'));
  socket.on('connect', () => socket.emit('me:refresh'));

  document.dispatchEvent(new CustomEvent('pz:ready'));

  const wanted = location.hash.replace('#', '');
  if (wanted && $(`#view-${wanted}`)) go(wanted);
  else if (PZ.views.home && PZ.views.home.enter) PZ.views.home.enter();
}

boot();
