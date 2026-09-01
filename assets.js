'use strict';
/**
 * LA VERSION DES FICHIERS.
 *
 * Le problème qu'on résout ici arrive à tous les sites, une fois, et il est
 * très désagréable : on pousse une mise à jour, le serveur la sert, et les
 * joueurs continuent de voir l'ancienne version. Pas une page sur deux —
 * un mélange des deux, ce qui est pire : le nouveau HTML avec l'ancienne
 * feuille de style, des icônes de la mauvaise couleur, une mise en page à
 * moitié cassée. On croit avoir raté son déploiement alors qu'il est
 * parfait.
 *
 * La cause : `express.static` dit au navigateur « garde ce fichier une
 * heure ». Le navigateur obéit, et il a raison — sans ça il retéléchargerait
 * 145 Ko de CSS à chaque page. Mais rien ne lui dit que le fichier a changé,
 * puisque l'adresse, elle, n'a pas bougé : c'est toujours /css/style.css.
 *
 * La solution est vieille comme le web et tient en une idée : SI LE CONTENU
 * CHANGE, L'ADRESSE CHANGE. On calcule une empreinte des fichiers au
 * démarrage et on la colle en fin d'adresse :
 *
 *     /css/style.css?v=8f3a1c
 *
 * Le navigateur voit une adresse qu'il ne connaît pas, il la télécharge.
 * Tant qu'on ne redéploie pas, l'empreinte ne bouge pas et il garde sa
 * copie. Au prochain déploiement, elle change, et il retélécharge — tout
 * seul, sans que personne ait à faire Ctrl+Maj+R.
 *
 * Le HTML, lui, n'est jamais mis en cache : c'est lui qui porte les
 * empreintes, il doit donc toujours être frais. Il est minuscule, ça ne
 * coûte rien.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC = path.join(__dirname, '..', 'public');

/**
 * L'empreinte du site.
 *
 * On hache le CONTENU des fichiers, pas leur date : sur un hébergeur qui
 * reconstruit tout à chaque déploiement, les dates changent même quand le
 * code n'a pas bougé, et on ferait retélécharger 300 Ko pour rien.
 */
function computeBuildId() {
  const hash = crypto.createHash('sha256');
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(css|js)$/.test(entry.name)) continue;
      hash.update(entry.name);
      hash.update(fs.readFileSync(full));
    }
  };
  walk(path.join(PUBLIC, 'css'));
  walk(path.join(PUBLIC, 'js'));
  return hash.digest('hex').slice(0, 10);
}

const BUILD = computeBuildId();

/**
 * Colle l'empreinte sur les adresses de feuilles de style et de scripts.
 *
 * On ne touche qu'aux adresses locales — celles qui commencent par « / ».
 * Un script tiers, s'il y en avait un un jour, n'a pas à recevoir notre
 * numéro de version.
 */
function stamp(html) {
  return html
    .replace(/(href=")(\/[^"]+\.css)(")/g, `$1$2?v=${BUILD}$3`)
    .replace(/(src=")(\/[^"]+\.js)(")/g, `$1$2?v=${BUILD}$3`);
}

/**
 * Sert une page HTML tamponnée, sans cache.
 *
 * Le fichier est relu à chaque requête plutôt que gardé en mémoire : en
 * développement on veut voir ses modifications sans redémarrer, et en
 * production ça représente quelques microsecondes sur une page qui en met
 * déjà des centaines à traverser le réseau.
 */
function sendPage(res, file, status = 200) {
  let html;
  try {
    html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
  } catch {
    return res.status(500).type('text/plain').send('Page introuvable sur le serveur.');
  }
  res.status(status);
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.type('html').send(stamp(html));
}

module.exports = { BUILD, stamp, sendPage };
