'use strict';
/**
 * LA MINE, ET SA PREUVE DE PRÉSENCE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE BANC D'ESSAI EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 * Il a été écrit APRÈS une vraie panne, et c'est la meilleure raison d'en
 * écrire un.
 *
 * La mine demande une preuve de présence au bout de dix minutes de clics
 * d'affilée. La première version de ce contrôle avait un défaut qu'aucun
 * test ne voyait : LA QUESTION NE S'OUBLIAIT JAMAIS. Elle vit dans le
 * profil, donc elle survivait à la déconnexion et au redémarrage — et un
 * joueur dont l'onglet n'avait pas rechargé depuis la mise à jour ne voyait
 * jamais le bouton. Il cliquait dans le vide, indéfiniment, pendant que ses
 * copains minaient. Sur un compte tout neuf, ça remarchait : de quoi
 * chercher longtemps du mauvais côté.
 *
 * On vérifie donc les deux moitiés, et elles comptent autant l'une que
 * l'autre :
 *
 *  1. LA MINE PROTÈGE. Dix minutes de clics mécaniques, et elle s'arrête.
 *     Une nuit d'autoclic ne doit pas rapporter plus qu'un quart d'heure de
 *     jeu éveillé.
 *  2. LA MINE NE SE BLOQUE JAMAIS. Aucun chemin, même en ignorant la
 *     question, ne doit laisser un joueur définitivement incapable de miner.
 */

const clicker = require('../server/clicker');

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

const profil = (now) => ({
  id: 'a', name: 'Momo',
  vault: { coins: 0, items: {} },
  clicker: clicker.blankClicker(now),
});

/** Mine pendant `minutes`, en tapant toutes les `pas` millisecondes. */
function miner(p, depart, minutes, pas = 200) {
  let coins = 0;
  let bloque = 0;
  const fin = depart + minutes * 60000;
  for (let t = depart; t < fin; t += pas) {
    const r = clicker.click(p, 1, t);
    if (r.asleep) bloque += 1;
    coins += r.coins;
  }
  return { coins, bloque, fin };
}

(function main() {
  console.log('La mine — l’endurance, la preuve de présence, et le déblocage\n');

  const T0 = Date.parse('2026-09-11T20:00:00Z');

  /* ══════════ CE QUE ÇA RAPPORTE ══════════ */
  section('Ce que rapporte une main humaine');
  {
    const p = profil(T0);
    // Une minute de clics à cadence humaine.
    const { coins } = miner(p, T0, 1, 200);
    check('une minute de mine vaut quelques dizaines de pièces',
      coins > 20 && coins < 150, `${Math.round(coins)} pièces`);
    check('l’endurance est retombée', p.clicker.stamina < 20,
      `${Math.round(p.clicker.stamina)} points restants`);
  }

  section('Ce que rapporte une nuit d’autoclic');
  {
    const p = profil(T0);
    const { coins, bloque } = miner(p, T0, 8 * 60, 100);   // huit heures, dix clics/seconde
    check('la mine se met en pause pendant la nuit', bloque > 0, `${bloque} clics dans le vide`);
    check('huit heures d’autoclic rapportent une misère', coins < 3000,
      `${Math.round(coins)} pièces pour une nuit entière`);
  }

  /* ══════════ LA QUESTION ══════════ */
  section('La question arrive au bon moment');
  {
    const p = profil(T0);
    // Neuf minutes de clics serrés : pas encore de question.
    let t = T0;
    let asked = null;
    for (; t < T0 + 9 * 60000; t += 200) {
      const r = clicker.click(p, 1, t);
      if (r.asleep) { asked = t; break; }
    }
    check('rien ne se passe avant dix minutes', asked === null,
      asked ? `question à ${Math.round((asked - T0) / 60000)} min` : 'neuf minutes tranquilles');

    for (; t < T0 + 12 * 60000 && !asked; t += 200) {
      const r = clicker.click(p, 1, t);
      if (r.asleep) asked = t;
    }
    check('elle tombe peu après dix minutes', asked !== null
      && asked - T0 >= 10 * 60000 && asked - T0 < 11 * 60000,
      asked ? `${Math.round((asked - T0) / 60000)} min` : 'jamais posée');

    const bloque = clicker.click(p, 1, asked + 1000);
    check('tant qu’on ne répond pas, la mine ne rend rien',
      bloque.asleep && bloque.coins === 0);
    check('mais elle ne consomme ni endurance ni budget',
      bloque.counted === 0, 'on ne punit pas quelqu’un qui s’absente');

    const bouton = bloque.awake;
    check('le bouton se pose ailleurs que sur le rocher',
      bouton.x >= 0 && bouton.x <= 100 && bouton.y >= 0 && bouton.y <= 100,
      `${bouton.x} % / ${bouton.y} %`);

    const faux = clicker.stayAwake(p, 'nimportequoi', asked + 2000);
    check('un jeton inventé ne débloque rien', !faux.ok, faux.message);

    const vrai = clicker.stayAwake(p, bouton.token, asked + 3000);
    check('le bon jeton débloque', vrai.ok);
    const apres = clicker.click(p, 1, asked + 4000);
    check('et on remine aussitôt', !apres.asleep && apres.coins > 0, `${apres.coins} pièces`);
  }

  /* ══════════ LA PANNE D'ORIGINE ══════════ */
  section('La mine ne se bloque jamais définitivement');
  {
    const p = profil(T0);
    let t = T0;
    let question = null;
    for (; t < T0 + 12 * 60000; t += 200) {
      const r = clicker.click(p, 1, t);
      if (r.asleep) { question = r.awake; break; }
    }
    check('la question est bien posée', Boolean(question));

    // Le joueur ne répond pas : son onglet n'affiche pas le bouton.
    const cinqMin = clicker.click(p, 1, t + 5 * 60000);
    check('cinq minutes plus tard, la mine attend toujours', cinqMin.asleep,
      'la question a encore un sens : il est peut-être devant son écran');

    /*
     * C'EST LA VÉRIFICATION QUI COMPTE.
     *
     * Le lendemain, le même joueur revient et clique. Avant correction, il
     * cliquait dans le vide pour toujours — la question dormait dans son
     * profil et rien ne l'en sortait.
     */
    const lendemain = clicker.click(p, 1, t + 20 * 3600000);
    check('le lendemain, la mine remarche toute seule',
      !lendemain.asleep && lendemain.coins > 0,
      `${lendemain.coins} pièces — une question oubliée ne bloque personne`);

    check('et le compteur de session repart de zéro',
      p.clicker.awake === null && p.clicker.sessionStart >= t);
  }

  section('Rouvrir la page suffit aussi, après une longue absence');
  {
    const p = profil(T0);
    let t = T0;
    for (; t < T0 + 12 * 60000; t += 200) {
      if (clicker.click(p, 1, t).asleep) break;
    }
    check('la mine attend une réponse', Boolean(p.clicker.awake));

    const vue = clicker.view(p, t + 60000);
    check('en revenant tout de suite, la question est toujours là', Boolean(vue.awake),
      'sinon il suffirait de changer d’écran pour l’esquiver');

    const plusTard = clicker.view(p, t + clicker.AWAKE_EXPIRE_MS + 60000);
    check('après un quart d’heure, elle a disparu', plusTard.awake === null);
    check('et la page ne propose plus un bouton fantôme', p.clicker.awake === null);
  }

  section('Et une réponse tardive ne coince pas non plus');
  {
    const p = profil(T0);
    let t = T0;
    let question = null;
    for (; t < T0 + 12 * 60000; t += 200) {
      const r = clicker.click(p, 1, t);
      if (r.asleep) { question = r.awake; break; }
    }

    // On répond après la fenêtre de deux minutes : la question est reposée.
    const tard = clicker.stayAwake(p, question.token, t + 5 * 60000);
    check('une réponse hors délai est refusée', !tard.ok, tard.message);
    check('mais une nouvelle question est proposée', Boolean(tard.awake),
      'on ne laisse jamais quelqu’un sans porte de sortie');

    const bien = clicker.stayAwake(p, tard.awake.token, t + 5 * 60000 + 1000);
    check('et celle-là marche', bien.ok);

    // Et si on ne répond pas du tout à la seconde non plus : elle expire.
    clicker.click(p, 1, t + 6 * 60000);
    const p2 = profil(T0);
    let t2 = T0;
    for (; t2 < T0 + 12 * 60000; t2 += 200) {
      if (clicker.click(p2, 1, t2).asleep) break;
    }
    const trois = clicker.stayAwake(p2, 'faux', t2 + 20 * 3600000);
    check('un jeton perdu, vingt heures plus tard, ne bloque plus rien',
      trois.ok, 'la question a été oubliée avant même d’être examinée');
  }

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  process.exit(failures ? 1 : 0);
})();
