'use strict';
/**
 * LE LAISSEZ-PASSER DES BANCS D'ESSAI.
 *
 * Depuis que le site a une porte, tout ce qui vient de l'extérieur est
 * renvoyé sur le compte à rebours — les bancs d'essai compris, et c'est
 * exactement ce qu'on veut : si les tests passaient à travers, ils ne
 * testeraient pas le vrai site.
 *
 * Ils entrent donc par la même porte que nous, avec la même clé. Un effet
 * de bord utile : le jour où la porte se casse, tous les bancs d'essai
 * échouent d'un coup sur « site_ferme », ce qui est un signal bien plus
 * clair qu'une page blanche découverte trois jours plus tard.
 */

/**
 * Demande un laissez-passer et renvoie le cookie à recoller devant les
 * autres, sous la forme « pz_gate=… ».
 *
 * Renvoie une chaîne vide si le site est déjà ouvert (rien à demander) ou
 * si aucune clé n'est configurée : dans les deux cas les tests doivent
 * continuer, pas s'arrêter.
 */
async function gatePass(base, key = process.env.ADMIN_KEY || 'test-admin-key') {
  try {
    const info = await fetch(`${base}/api/gate`).then((r) => r.json());
    if (info.open) return '';
  } catch {
    return '';
  }

  const res = await fetch(`${base}/api/gate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) {
    throw new Error(
      'Le site est fermé et la clé a été refusée. Vérifie ADMIN_KEY, ' +
      'ou ouvre le site depuis le panel d’administration.'
    );
  }
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  return raw.filter(Boolean).map((c) => c.split(';')[0]).join('; ');
}

/** Colle le laissez-passer devant un cookie de session, s'il y en a un. */
function withPass(pass, cookie) {
  return pass ? `${pass}; ${cookie}` : cookie;
}

/**
 * Pose le laissez-passer directement dans un navigateur d'essai.
 *
 * On ne passe plus par la page d'attente pour ça. Elle se redirige toute
 * seule vers l'accueil dès que le site est ouvert — et le jour de
 * l'ouverture, ça a fait échouer tous les parcours navigateur d'un coup :
 * le contexte d'exécution disparaissait au milieu du `fetch`. Le cookie
 * posé sur le contexte marche dans les deux cas, porte ouverte ou fermée.
 */
async function browserPass(ctx, base = 'http://localhost:3000') {
  const pass = await gatePass(base);
  if (!pass) return false;   // le site est ouvert : rien à poser
  const url = new URL(base);
  await ctx.addCookies(pass.split('; ').map((one) => {
    const at = one.indexOf('=');
    return { name: one.slice(0, at), value: one.slice(at + 1), domain: url.hostname, path: '/' };
  }));
  return true;
}

module.exports = { gatePass, withPass, browserPass };
