'use strict';
/**
 * LE FIL DISCORD.
 *
 * Le site sait plein de choses que personne ne voit, parce qu'il faut avoir
 * l'onglet ouvert pour les apprendre. Or la bande ne vit pas sur le site :
 * elle vit sur Discord. Une table de belote qui s'ouvre pendant que tout le
 * monde discute ailleurs, c'est une soirée qui n'a pas lieu.
 *
 * Ce fichier envoie donc quelques messages, sur un webhook. Pas un bot avec
 * un compte, un jeton et des permissions — un webhook : une adresse qu'on
 * copie depuis les réglages d'un salon Discord, et c'est tout.
 *
 * CE QU'ON ENVOIE, ET SEULEMENT ÇA
 * ────────────────────────────────
 * Le piège d'une intégration comme celle-là, c'est le bruit. Un salon qui
 * reçoit trente messages par soirée finit en sourdine, et on a alors perdu
 * l'intérêt de la chose. On envoie donc quatre types de messages, pas un de
 * plus :
 *
 *  · une table qui s'ouvre — c'est l'invitation, la seule urgente ;
 *  · le journal du lendemain — une fois par jour, le matin ;
 *  · le vainqueur du mois — une fois par mois ;
 *  · le prix Citron — une fois par semaine.
 *
 * Rien n'est envoyé si `DISCORD_WEBHOOK_URL` n'est pas renseignée : le site
 * marche exactement pareil sans.
 */

const URL_WEBHOOK = process.env.DISCORD_WEBHOOK_URL || '';
const SITE = process.env.PUBLIC_URL || '';

/** Deux messages identiques d'affilée n'apportent rien. */
let dernier = '';
let dernierAt = 0;

const actif = () => Boolean(URL_WEBHOOK);

/**
 * Envoie un message. Ne jette jamais : Discord qui tousse ne doit pas
 * empêcher une partie de se lancer.
 */
async function envoyer(content, { unique = true } = {}) {
  if (!actif() || !content) return false;

  const now = Date.now();
  if (unique && content === dernier && now - dernierAt < 60000) return false;
  dernier = content;
  dernierAt = now;

  try {
    const res = await fetch(URL_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
      body: JSON.stringify({
        content: content.slice(0, 1900),
        // Personne n'a envie d'être mentionné par un site de jeu.
        allowed_mentions: { parse: [] },
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('[discord]', err.message);
    return false;
  }
}

/* ─── Les quatre messages ──────────────────────────────── */

/** « Léa vient d'ouvrir une table de belote. » */
function table({ host, gameName, code, max }) {
  return envoyer(
    `🎲 **${host}** vient d’ouvrir une table de **${gameName}** — code \`${code}\`, `
    + `${max} places.${SITE ? ` ${SITE}` : ''}`
  );
}

/** Le journal du matin. */
function matin(page) {
  if (!page || !page.lignes.length) return Promise.resolve(false);
  return envoyer(`📰 **Hier soir sur PartyZone**\n> ${page.lignes.join('\n> ')}`);
}

/** Le vainqueur du mois. */
function mois({ name, label, xp, prize }) {
  return envoyer(
    `🏆 **${name}** remporte le mois de ${label} avec ${Math.round(xp).toLocaleString('fr-FR')} XP `
    + `— ${prize}. Le lot se remet à la main, comme d’habitude.`
  );
}

/** Le prix Citron de la semaine. */
function citron(prix) {
  if (!prix) return Promise.resolve(false);
  return envoyer(`🍋 **Prix Citron — ${prix.titre}** : ${prix.name}. ${prix.texte}`);
}

module.exports = { envoyer, table, matin, mois, citron, actif };
