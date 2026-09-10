'use strict';
/**
 * LA CARTE DE FIN DE SOIRÉE.
 *
 * Une soirée se termine sur un classement affiché à l'écran, que personne
 * ne peut montrer à personne. Il faut avoir été là. Ce fichier dessine une
 * IMAGE : le podium, les chiffres, le meilleur moment — faite pour être
 * collée dans Discord le lendemain.
 *
 * POURQUOI DU SVG, ET PAS UNE VRAIE IMAGE
 * ───────────────────────────────────────
 * Dessiner un PNG côté serveur demande une bibliothèque native (canvas,
 * sharp, resvg). Sur un hébergement gratuit, c'est trois cents mégaoctets
 * de dépendances, un temps de démarrage qui double, et une mise à jour qui
 * casse le déploiement une fois sur deux.
 *
 * Le serveur écrit donc du SVG — du texte, aucune dépendance — et c'est le
 * NAVIGATEUR qui le transforme en PNG au moment du téléchargement, avec un
 * `<canvas>` qu'il a déjà. Le serveur reste léger, et le fichier obtenu est
 * une vraie image qu'on colle où on veut.
 *
 * UNE CONTRAINTE QUI EN DÉCOULE
 * ─────────────────────────────
 * Un SVG converti en image ne peut pas aller chercher de police ni d'avatar
 * sur le réseau : au moment de la conversion, tout doit déjà être dans le
 * fichier. On se limite donc aux polices du système et à des pastilles
 * dessinées — initiale et couleur tirée du nom. C'est moins joli que les
 * vraies têtes Discord, mais ça marche à tous les coups, et une carte qui
 * s'affiche à moitié ne se partage pas.
 */

const W = 1000;
const H = 620;

/** Les couleurs du site, en dur : le SVG ne lit pas la feuille de style. */
const C = {
  fond1: '#151119',
  fond2: '#0d0b11',
  trait: '#2c2536',
  texte: '#f4f1f8',
  pale: '#9d95ab',
  or: '#e8b53c',
  argent: '#c3cbd6',
  bronze: '#c08457',
  accent: '#ff3d8b',
};

/** Une couleur stable par personne, tirée de son nom. */
function teinte(nom) {
  let h = 0;
  for (const ch of String(nom || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
  return `hsl(${h} 58% 46%)`;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const nb = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ');

/** Coupe un nom trop long plutôt que de le laisser déborder du cadre. */
function court(nom, max = 16) {
  const s = String(nom || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Une pastille avec l'initiale : pas d'image à charger, donc jamais de trou. */
function pastille(x, y, r, nom) {
  const lettre = String(nom || '?').trim().charAt(0).toUpperCase() || '?';
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${teinte(nom)}"/>`
    + `<text x="${x}" y="${y + r * 0.34}" text-anchor="middle" font-size="${r * 0.95}"`
    + ` font-weight="700" fill="#fff">${esc(lettre)}</text>`;
}

/**
 * Dessine la carte.
 *
 * @param {object} soiree  { games, rounds, standings:[{name, points}], last }
 * @param {object} extra   { moment, date }
 */
function soiree(data = {}, extra = {}) {
  const table = (data.standings || []).slice(0, 6);
  const manches = data.rounds || (data.games || []).length;
  const jeux = (data.games || []).join(' · ');
  const date = extra.date || new Date().toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
    font-family="'Segoe UI', system-ui, -apple-system, sans-serif">`);

  /* ── Le fond ── */
  parts.push(`<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.fond1}"/><stop offset="1" stop-color="${C.fond2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0" r="0.8">
      <stop offset="0" stop-color="${C.accent}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${C.accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);
  parts.push(`<rect width="${W}" height="340" fill="url(#glow)"/>`);

  /* ── L'en-tête ── */
  parts.push(`<text x="56" y="72" font-size="17" font-weight="700" letter-spacing="3"
    fill="${C.accent}">PARTYZONE</text>`);
  parts.push(`<text x="56" y="122" font-size="42" font-weight="800" fill="${C.texte}">Soirée du ${esc(date)}</text>`);
  if (jeux) {
    parts.push(`<text x="56" y="156" font-size="18" fill="${C.pale}">${esc(jeux)}`
      + `${manches ? ` — ${manches} manches` : ''}</text>`);
  }
  parts.push(`<line x1="56" y1="186" x2="${W - 56}" y2="186" stroke="${C.trait}" stroke-width="2"/>`);

  /*
   * ── Le podium ──
   *
   * La hauteur d'une ligne n'est pas fixe : elle se déduit de la place qui
   * reste. Avec une hauteur en dur, une soirée à six joueurs poussait la
   * bande du bas hors de l'image — et une image tronquée ne se partage pas.
   * On calcule donc la zone disponible d'abord, et les lignes s'y logent.
   */
  const medaille = [C.or, C.argent, C.bronze];
  const HAUT = 216;
  const BAS = extra.moment ? H - 126 : H - 54;
  const pas = table.length ? Math.min(68, Math.floor((BAS - HAUT) / table.length)) : 0;
  const hauteur = Math.max(34, pas - 12);
  const petit = pas < 58;          // au-delà de quatre joueurs, on resserre
  const police = petit ? 19 : 23;
  const rayon = petit ? 15 : 20;

  let y = HAUT + Math.round(pas / 2);
  table.forEach((p, i) => {
    const or = i < 3;
    parts.push(`<rect x="56" y="${y - Math.round(hauteur / 2)}" width="${W - 112}" height="${hauteur}" rx="14"
      fill="${i === 0 ? 'rgba(232,181,60,.10)' : 'rgba(255,255,255,.035)'}"
      stroke="${i === 0 ? 'rgba(232,181,60,.35)' : C.trait}"/>`);
    parts.push(`<text x="86" y="${y + 8}" font-size="${police - 1}" font-weight="800"
      fill="${or ? medaille[i] : C.pale}">${i + 1}</text>`);
    parts.push(pastille(140, y - 2, rayon, p.name));
    parts.push(`<text x="176" y="${y + 8}" font-size="${police}" font-weight="700"
      fill="${C.texte}">${esc(court(p.name, 22))}</text>`);
    parts.push(`<text x="${W - 86}" y="${y + 8}" font-size="${police}" font-weight="800" text-anchor="end"
      fill="${or ? medaille[i] : C.pale}">${nb(p.points)} pts</text>`);
    y += pas;
  });

  if (!table.length) {
    parts.push(`<text x="56" y="250" font-size="20" fill="${C.pale}">Aucun classement.</text>`);
  }

  /* ── Le meilleur moment, toujours collé au bas de l'image ── */
  if (extra.moment) {
    const yy = H - 82;
    parts.push(`<rect x="56" y="${yy - 34}" width="${W - 112}" height="62" rx="14"
      fill="rgba(255,255,255,.04)" stroke="${C.trait}"/>`);
    parts.push(`<text x="80" y="${yy - 10}" font-size="13" font-weight="700" letter-spacing="2"
      fill="${C.pale}">LE MOMENT DE LA SOIRÉE</text>`);
    parts.push(`<text x="80" y="${yy + 16}" font-size="19" fill="${C.texte}">`
      + `${esc(court(extra.moment, 78))}</text>`);
  }

  parts.push(`<text x="${W - 56}" y="${H - 22}" font-size="13" text-anchor="end"
    fill="${C.trait}">partyzone</text>`);
  parts.push('</svg>');
  return parts.join('\n');
}

module.exports = { soiree, teinte, court, W, H };
