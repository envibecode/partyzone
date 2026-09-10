'use strict';
/**
 * LA CARTE DE FIN DE SOIRÉE.
 *
 * Une carte est une image qu'on va coller dans Discord. Elle n'a donc pas
 * droit à l'à-peu-près : ou elle s'affiche entière chez tout le monde, ou
 * elle ne sert à rien. On vérifie quatre choses, dans cet ordre :
 *
 *  1. QU'ELLE EST UN DOCUMENT VALIDE. Un SVG mal fermé ne s'affiche pas du
 *     tout — pas « à moitié », pas du tout.
 *
 *  2. QU'UN NOM NE PEUT PAS LA CASSER. Les pseudos contiennent des `&`, des
 *     `<`, des guillemets et des emojis. Un seul caractère non échappé, et
 *     le fichier entier devient illisible. C'est la faille classique de
 *     tout ce qui fabrique du balisage à la main.
 *
 *  3. QU'ELLE NE VA RIEN CHERCHER SUR LE RÉSEAU. C'est la contrainte qui
 *     décide de tout le reste du fichier : le navigateur convertit la carte
 *     en PNG avec un `<canvas>`, et un canvas qui a chargé une image
 *     distante refuse d'exporter. Une seule URL dans le SVG, et le bouton
 *     « télécharger » ne marche plus jamais.
 *
 *  4. QUE RIEN NE DÉBORDE DU CADRE. Un pseudo de quarante caractères ne
 *     doit pas sortir de l'image.
 */

const carte = require('../server/carte');

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

/**
 * Un analyseur de XML minimal : on n'a pas de dépendance, et on n'en veut
 * pas pour ça. Il suffit de vérifier que chaque balise ouverte est fermée,
 * dans le bon ordre, et qu'aucun `<` ou `&` ne traîne dans le texte.
 */
function parseXml(src) {
  const pile = [];
  let i = 0;
  let texte = '';

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { texte += src.slice(i); break; }
    texte += src.slice(i, lt);

    const gt = (() => {
      // Il faut sauter les `>` qui vivent à l'intérieur d'un attribut.
      let j = lt + 1;
      let quote = null;
      for (; j < src.length; j++) {
        const c = src[j];
        if (quote) { if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === '>') return j;
      }
      return -1;
    })();
    if (gt === -1) throw new Error(`balise non fermée à l’octet ${lt}`);

    const brut = src.slice(lt + 1, gt).trim();
    if (brut.startsWith('!') || brut.startsWith('?')) { i = gt + 1; continue; }

    if (brut.startsWith('/')) {
      const nom = brut.slice(1).trim();
      const haut = pile.pop();
      if (haut !== nom) throw new Error(`</${nom}> ferme <${haut || 'rien'}>`);
    } else if (!brut.endsWith('/')) {
      pile.push(brut.split(/[\s/>]/)[0]);
    }
    i = gt + 1;
  }

  if (pile.length) throw new Error(`balise(s) jamais fermée(s) : ${pile.join(', ')}`);

  // Le texte hors balises ne doit contenir ni `<` ni `&` nu.
  const nu = texte.match(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i);
  if (nu) throw new Error(`esperluette non échappée : ${texte.slice(nu.index, nu.index + 12)}`);
  return { texte };
}

const soiree = (over = {}) => ({
  games: ['Uno', 'Belote', 'Blindtest'],
  rounds: 3,
  standings: [
    { id: 'a', name: 'Momo', points: 24 },
    { id: 'b', name: 'Léa', points: 19 },
    { id: 'c', name: 'Ana', points: 14 },
    { id: 'd', name: 'Théo', points: 8 },
  ],
  ...over,
});

(function main() {
  console.log('La carte de fin de soirée — une image, pas un tableau\n');

  /* ── UN DOCUMENT VALIDE ── */
  section('C’est bien une image');
  {
    const svg = carte.soiree(soiree(), { moment: 'Momo sort 68 000 pièces d’une mise de 2 000 — 34× à Horse House.' });

    let erreur = null;
    try { parseXml(svg); } catch (e) { erreur = e.message; }
    check('le SVG est bien formé', erreur === null, erreur || '');
    check('il s’annonce comme du SVG', /^<svg[\s>]/.test(svg.trim()));
    check('il a la bonne taille', svg.includes(`width="${carte.W}"`) && svg.includes(`height="${carte.H}"`));
    check('il porte le nom du site', /PARTYZONE/.test(svg));
    check('il montre les quatre joueurs',
      ['Momo', 'Léa', 'Ana', 'Théo'].every((n) => svg.includes(n)));
    check('il montre les points', /24 pts/.test(svg));
    check('il nomme les jeux', /Uno · Belote · Blindtest/.test(svg));
    check('il raconte le moment de la soirée', /LE MOMENT DE LA SOIRÉE/.test(svg) && /68/.test(svg));
  }

  /* ── LES NOMS HOSTILES ── */
  section('Un pseudo ne peut pas la casser');
  {
    const noms = [
      'Tom & Jerry',
      '<script>alert(1)</script>',
      'le "vrai" champion',
      "l'obstiné",
      'Ω 🐴 émoji',
      '&amp;',
    ];
    const svg = carte.soiree(soiree({
      standings: noms.map((name, i) => ({ id: String(i), name, points: 10 - i })),
      games: ['Uno & co', '<b>'],
    }), { moment: 'Ana & Léa <ont> "gagné"' });

    let erreur = null;
    try { parseXml(svg); } catch (e) { erreur = e.message; }
    check('le document reste valide', erreur === null, erreur || '');
    check('le script n’est pas exécutable', !/<script/i.test(svg));
    check('l’esperluette est échappée', svg.includes('Tom &amp; Jerry'));
    check('les guillemets aussi', svg.includes('&quot;') || svg.includes('&#39;'));
    check('un « &amp; » déjà écrit n’est pas doublé de travers',
      svg.includes('&amp;amp;'), 'le texte littéral « &amp; » doit ressortir tel quel');
  }

  /* ── AUCUN RÉSEAU ── */
  section('Elle ne charge rien de l’extérieur');
  {
    const svg = carte.soiree(soiree({
      standings: [{ id: 'a', name: 'Momo', points: 12, avatar: 'https://cdn.discordapp.com/avatars/1/2.png' }],
    }), { moment: 'Rien de spécial.' });

    check('pas de balise <image>', !/<image\b/i.test(svg));
    check('pas de http(s) dans le fichier',
      !/https?:\/\/(?!www\.w3\.org)/i.test(svg),
      'un canvas qui a chargé une image distante refuse d’exporter');
    check('pas de @import de police', !/@import|@font-face/i.test(svg));
    check('l’avatar est remplacé par une pastille', /<circle/.test(svg) && />M</.test(svg));
    check('la pastille a une couleur stable',
      carte.teinte('Momo') === carte.teinte('Momo') && carte.teinte('Momo') !== carte.teinte('Léa'));
  }

  /* ── LE CADRE ── */
  section('Rien ne déborde');
  {
    const long = 'Jean-Christophe de la Villardière-Montcourt';
    check('un nom trop long est coupé', carte.court(long, 22).length <= 22);
    check('et il se termine par des points de suspension', carte.court(long, 22).endsWith('…'));
    check('un nom court n’est pas touché', carte.court('Momo', 22) === 'Momo');

    const svg = carte.soiree(soiree({
      standings: Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `Joueur ${i}`, points: 20 - i })),
    }), { moment: long.repeat(4) });
    check('on ne dessine que le haut du classement',
      !svg.includes('Joueur 7'), 'douze lignes ne tiennent pas dans le cadre');

    // Toutes les coordonnées verticales doivent rester dans l'image.
    const ys = [...svg.matchAll(/\sy="(-?\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
    check('tout tient dans la hauteur',
      ys.every((y) => y >= -40 && y <= carte.H + 4),
      `de ${Math.min(...ys)} à ${Math.max(...ys)} pour ${carte.H} de haut`);
  }

  /* ── LES CAS VIDES ── */
  section('Les soirées qui n’ont rien à raconter');
  {
    const vide = carte.soiree();
    let erreur = null;
    try { parseXml(vide); } catch (e) { erreur = e.message; }
    check('une carte sans classement reste valide', erreur === null, erreur || '');
    check('elle le dit plutôt que de mentir', /Aucun classement/.test(vide));

    const sansMoment = carte.soiree(soiree(), {});
    check('sans moment marquant, pas de bande vide', !/LE MOMENT/.test(sansMoment));
    let e2 = null;
    try { parseXml(sansMoment); } catch (e) { e2 = e.message; }
    check('et ça reste valide', e2 === null, e2 || '');
  }

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  process.exit(failures ? 1 : 0);
})();
