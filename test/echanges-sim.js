'use strict';
/**
 * LES ÉCHANGES — LA CAGNOTTE, LE TROC, LES ENCHÈRES, L'OBJET DU JOUR.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ON SURVEILLE ICI
 * ─────────────────────────────────────────────────────────────────────────
 * Ces quatre mécaniques touchent aux deux seules choses qui ont de la
 * valeur sur le site : les pièces et la collection. Quatre façons de tout
 * casser, une par fonctionnalité :
 *
 *  · LA CAGNOTTE pourrait avaler des pièces sans jamais rien rendre — c'est
 *    la pire, parce qu'elle repose entièrement sur la confiance : personne
 *    ne remet au pot deux fois s'il a été échaudé une.
 *  · LE TROC pourrait faire APPARAÎTRE des objets, ou en faire disparaître,
 *    si les deux moitiés de l'échange ne tombaient pas juste.
 *  · L'ENCHÈRE pourrait laisser deux mises immobilisées en même temps, ou
 *    se gagner au chronomètre.
 *  · L'OBJET DU JOUR pourrait être différent d'un joueur à l'autre, ou se
 *    farmer sans limite.
 */

const cagnotte = require('../server/cagnotte');
const troc = require('../server/troc');
const encheres = require('../server/encheres');
const objet = require('../server/objet');
const { ITEMS } = require('../server/data/collection');

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

const profil = (id, name, items = {}, coins = 100000) => ({
  id, name, vault: { coins, items: { ...items } },
});

(function main() {
  console.log('Les échanges — la cagnotte, le troc, les enchères, l’objet du jour\n');

  /* ══════════ LA CAGNOTTE ══════════ */
  section('La cagnotte ne dépasse jamais son objectif');
  {
    const state = {};
    const { cagnotte: c } = cagnotte.ouvrir(state, { id: 'a', name: 'Ana' },
      { titre: 'On renfloue Momo', but: 10000, pour: { type: 'joueur', id: 'm', name: 'Momo' } });

    cagnotte.mettre(c, { id: 'a', name: 'Ana' }, 6000);
    const trop = cagnotte.mettre(c, { id: 'b', name: 'Bruno' }, 9000);

    check('la dernière part est rabotée à ce qui manquait',
      trop.amount === 4000 && trop.rabote, `${trop.amount} pris sur 9 000 demandés`);
    check('le pot fait exactement l’objectif', cagnotte.total(c) === 10000, `${cagnotte.total(c)}`);
    check('et il est plein', cagnotte.pleine(c));

    const encore = cagnotte.mettre(c, { id: 'c', name: 'Chloé' }, 1000);
    check('on ne peut plus rien y mettre', !encore.ok, encore.message);
  }

  section('Le versement');
  {
    const state = {};
    const pour = cagnotte.ouvrir(state, { id: 'a', name: 'Ana' },
      { titre: 'Pour Momo', but: 5000, pour: { type: 'joueur', id: 'm', name: 'Momo' } }).cagnotte;
    cagnotte.mettre(pour, { id: 'a', name: 'Ana' }, 5000);
    const paye = cagnotte.verser(pour);
    check('elle part chez son bénéficiaire', paye && paye.to === 'm' && paye.amount === 5000,
      paye ? `${paye.amount} pour ${paye.name}` : '—');
    check('et elle ne se verse pas deux fois', cagnotte.verser(pour) === null);

    const mois = cagnotte.ouvrir(state, { id: 'a', name: 'Ana' },
      { titre: 'Pour le champion', but: 3000, pour: { type: 'mois' } }).cagnotte;
    cagnotte.mettre(mois, { id: 'b', name: 'Bruno' }, 3000);
    check('une cagnotte du mois attend la bascule', cagnotte.verser(mois) === null);
    check('elle est bien en attente', cagnotte.aVerserAuMois(state).length === 1);

    const versements = cagnotte.verserAuMois(state, { id: 'z', name: 'Léa' });
    check('à la bascule, elle part chez le vainqueur',
      versements.length === 1 && versements[0].to === 'z' && versements[0].amount === 3000,
      `${versements[0].amount} pour ${versements[0].name}`);
  }

  section('Une cagnotte qui n’aboutit pas est RENDUE');
  {
    const state = {};
    const c = cagnotte.ouvrir(state, { id: 'a', name: 'Ana' },
      { titre: 'Trop ambitieux', but: 500000, pour: { type: 'mois' } }).cagnotte;
    cagnotte.mettre(c, { id: 'a', name: 'Ana' }, 3000);
    cagnotte.mettre(c, { id: 'b', name: 'Bruno' }, 7000);
    cagnotte.mettre(c, { id: 'a', name: 'Ana' }, 2000);

    const plusTard = Date.now() + cagnotte.EXPIRE_MS + 1000;
    const rendus = cagnotte.sweep(state, plusTard);
    const somme = rendus.reduce((n, r) => n + r.amount, 0);

    check('tout est rendu, à la pièce', somme === 12000, `${somme} rendu sur 12 000 mis`);
    check('et à chacun ce qu’il avait mis',
      rendus.filter((r) => r.id === 'a').reduce((n, r) => n + r.amount, 0) === 5000
      && rendus.filter((r) => r.id === 'b').reduce((n, r) => n + r.amount, 0) === 7000);
    check('elle ne peut pas être rendue deux fois',
      cagnotte.sweep(state, plusTard + 1000).length === 0);
  }

  section('Les garde-fous de la cagnotte');
  {
    const state = {};
    const petit = cagnotte.ouvrir(state, { id: 'a', name: 'Ana' },
      { titre: 'Trois francs', but: 10, pour: { type: 'mois' } });
    check('un objectif ridicule est refusé', !petit.ok, petit.message);

    const sansTitre = cagnotte.ouvrir(state, { id: 'a', name: 'Ana' },
      { titre: 'x', but: 5000, pour: { type: 'mois' } });
    check('sans titre non plus', !sansTitre.ok, sansTitre.message);

    for (let i = 0; i < cagnotte.MAX_OUVERTES; i++) {
      cagnotte.ouvrir(state, { id: 'a', name: 'Ana' },
        { titre: `Cagnotte ${i}`, but: 5000, pour: { type: 'mois' } });
    }
    const trop = cagnotte.ouvrir(state, { id: 'a', name: 'Ana' },
      { titre: 'Une de trop', but: 5000, pour: { type: 'mois' } });
    check('on n’en ouvre pas dix à la fois', !trop.ok, trop.message);
  }

  /* ══════════ LE TROC ══════════ */
  section('Le troc n’échange que des doublons');
  {
    const A = profil('a', 'Ana', { doge: 2, 'pepe-triste': 1 });
    const B = profil('b', 'Bruno', { 'nyan-cat': 3 });

    const unique = troc.proposer(A, { id: 'b', name: 'Bruno' }, { donne: ['pepe-triste'], veut: ['nyan-cat'] });
    check('on ne donne pas son dernier exemplaire', !unique.ok, unique.message);

    const ok = troc.proposer(A, { id: 'b', name: 'Bruno' }, { donne: ['doge'], veut: ['nyan-cat'] });
    check('un doublon, oui', ok.ok);

    const rien = troc.proposer(A, { id: 'b', name: 'Bruno' }, { donne: [], veut: ['nyan-cat'] });
    check('donner zéro objet et zéro pièce, c’est une demande, pas un troc', !rien.ok, rien.message);

    const soi = troc.proposer(A, { id: 'a', name: 'Ana' }, { donne: ['doge'], veut: ['doge'] });
    check('on ne troque pas avec soi-même', !soi.ok, soi.message);

    // La vérification finale, celle qui compte.
    check('le troc est réalisable', troc.verifier(ok.troc, A, B).ok);

    const BSansRien = profil('b', 'Bruno', { 'nyan-cat': 1 });
    const refus = troc.verifier(ok.troc, A, BSansRien);
    check('mais pas si l’autre n’a plus de doublon', !refus.ok, refus.message);

    const APauvre = profil('a', 'Ana', { doge: 2 }, 0);
    const avecPieces = troc.proposer(profil('a', 'Ana', { doge: 2 }, 50000),
      { id: 'b', name: 'Bruno' }, { donne: ['doge'], veut: ['nyan-cat'], pieces: 30000 });
    const sansSous = troc.verifier(avecPieces.troc, APauvre, B);
    check('ni si le proposeur n’a plus les pièces promises', !sansSous.ok, sansSous.message);
  }

  section('Un troc ne crée ni ne détruit un objet');
  {
    troc.trocs.clear();   // on repart d'un registre propre
    /*
     * On simule l'échange exactement comme `index.js` le fait, et on compte
     * les objets AVANT et APRÈS, tous joueurs confondus. C'est l'invariant
     * du jeu de cartes appliqué à la collection : rien ne se crée.
     */
    const A = profil('a', 'Ana', { doge: 3, 'pepe-triste': 2 });
    const B = profil('b', 'Bruno', { 'nyan-cat': 2, stonks: 4 });

    const compte = () => {
      const tout = {};
      for (const p of [A, B]) {
        for (const [id, n] of Object.entries(p.vault.items)) tout[id] = (tout[id] || 0) + n;
      }
      return tout;
    };
    const avant = compte();
    const piecesAvant = A.vault.coins + B.vault.coins;

    const t = troc.proposer(A, { id: 'b', name: 'Bruno' },
      { donne: ['doge', 'pepe-triste'], veut: ['nyan-cat', 'stonks'], pieces: 5000 }).troc;
    check('le troc est valide', troc.verifier(t, A, B).ok);

    for (const o of t.donne) { A.vault.items[o.id] -= 1; B.vault.items[o.id] = (B.vault.items[o.id] || 0) + 1; }
    for (const o of t.veut) { B.vault.items[o.id] -= 1; A.vault.items[o.id] = (A.vault.items[o.id] || 0) + 1; }
    A.vault.coins -= t.pieces;
    B.vault.coins += t.pieces;

    const apres = compte();
    check('le total d’objets est identique',
      JSON.stringify(avant) === JSON.stringify(apres),
      `${JSON.stringify(avant)} → ${JSON.stringify(apres)}`);
    check('les pièces non plus ne se créent pas',
      A.vault.coins + B.vault.coins === piecesAvant);
    check('mais elles ont changé de poche', A.vault.coins !== 100000);
    check('et chacun a bien reçu ce qu’il voulait',
      A.vault.items['nyan-cat'] === 1 && B.vault.items.doge === 1);
    check('le dernier exemplaire est toujours là',
      A.vault.items.doge >= 1 && B.vault.items['nyan-cat'] >= 1,
      'personne n’a vidé sa collection');
  }

  /* ══════════ LES ENCHÈRES ══════════ */
  section('L’enchère du dimanche');
  {
    const state = {};
    const e = encheres.ensure(state);
    // On la force ouverte : le banc d'essai ne tourne pas forcément un
    // dimanche à midi.
    e.debut = Date.now() - 3600000;
    e.fin = Date.now() + 3600000;
    e.finMax = Date.now() + 7200000;

    check('un lot est désigné pour la semaine', Boolean(e.itemId));
    check('c’est un objet qui vaut le détour',
      ['epic', 'legendary', 'mythic'].includes(ITEMS.find((i) => i.id === e.itemId).r));
    check('le même pour tout le monde, tiré de la semaine',
      encheres.lot(e.semaine).id === e.itemId);

    const bas = encheres.miser(e, { id: 'a', name: 'Ana' }, 1);
    check('on ne mise pas une pièce', !bas.ok, bas.message);

    const un = encheres.miser(e, { id: 'a', name: 'Ana' }, e.depart);
    check('la première mise est le prix de départ', un.ok, `${e.depart}`);

    const moiMeme = encheres.miser(e, { id: 'a', name: 'Ana' }, e.depart * 3);
    check('on ne surenchérit pas contre soi-même', !moiMeme.ok, moiMeme.message);

    const petit = encheres.miser(e, { id: 'b', name: 'Bruno' }, e.depart + 1);
    check('il faut monter d’au moins 5 %', !petit.ok, petit.message);

    const deux = encheres.miser(e, { id: 'b', name: 'Bruno' }, encheres.minimum(e));
    check('la surenchère passe', deux.ok);
    check('et elle dit qui doit être remboursé',
      deux.depasse && deux.depasse.id === 'a' && deux.depasse.amount === e.depart,
      deux.depasse ? `${deux.depasse.name} : ${deux.depasse.amount}` : '—');

    // À tout instant, une seule mise est immobilisée : celle du meneur.
    const immobilise = encheres.meilleur(e).amount;
    check('une seule mise est immobilisée à la fois',
      immobilise === deux.amount, `${immobilise}`);
  }

  section('On ne gagne pas au chronomètre');
  {
    const state = {};
    const e = encheres.ensure(state);
    const maintenant = Date.now();
    e.debut = maintenant - 3600000;
    e.fin = maintenant + 30000;          // trente secondes avant la fin
    e.finMax = maintenant + 7200000;
    e.bids = [];

    const avant = e.fin;
    const tir = encheres.miser(e, { id: 'a', name: 'Ana' }, e.depart, maintenant);
    check('une mise à la dernière minute repousse la fin', tir.prolonge && e.fin > avant,
      `+${Math.round((e.fin - avant) / 1000)} s`);
    check('la clôture n’a donc pas lieu', encheres.clore(e, maintenant) === null);

    const fini = encheres.clore(e, e.fin + 1000);
    check('quand plus personne ne suit, c’est adjugé',
      fini && fini.winner === 'a', fini ? fini.name : '—');
    check('et on ne clôt pas deux fois', encheres.clore(e, e.fin + 2000) === null);

    const vide = encheres.ensure({}, Date.now());
    vide.fin = Date.now() - 1000;
    const personne = encheres.clore(vide);
    check('une enchère sans mise ne fait pas de gagnant', personne && personne.winner === null);
  }

  /* ══════════ L'OBJET DU JOUR ══════════ */
  section('L’objet du jour');
  {
    const aujourdhui = objet.du();
    check('il y en a un', Boolean(aujourdhui.id));
    check('le même pour tout le monde, tiré de la date',
      objet.du().id === aujourdhui.id);
    check('il change d’un jour à l’autre',
      objet.du(Date.now() + 86400000).id !== aujourdhui.id
      || objet.du(Date.now() + 2 * 86400000).id !== aujourdhui.id);
    check('jamais un maudit — huit chances sur dix mille, ce serait cruel',
      aujourdhui.r !== 'cursed', aujourdhui.rarity);
    check('et il vaut quelque chose', aujourdhui.prime >= 400, `${aujourdhui.prime} pièces`);

    // Sur trente jours, on ne doit pas retomber toujours sur le même.
    const vus = new Set();
    for (let i = 0; i < 30; i++) vus.add(objet.du(Date.now() + i * 86400000).id);
    check('trente jours, trente objets différents', vus.size >= 25, `${vus.size} objets sur 30 jours`);

    const p = profil('a', 'Ana');
    const rien = objet.verifier(p, [{ id: 'un-autre-objet' }]);
    check('un objet quelconque ne paie rien', rien.prime === 0);

    const une = objet.verifier(p, [{ id: aujourdhui.id }]);
    check('l’objet du jour paie', une.prime === aujourdhui.prime, `${une.prime}`);

    const trois = objet.verifier(p, [{ id: aujourdhui.id }, { id: aujourdhui.id }, { id: aujourdhui.id }]);
    check('mais pas plus de trois fois par jour',
      trois.fois === 2 && une.fois + trois.fois === objet.MAX_PAR_JOUR,
      `${une.fois} puis ${trois.fois}`);

    const encore = objet.verifier(p, [{ id: aujourdhui.id }]);
    check('la quatrième ne rapporte rien', encore.prime === 0);

    const demain = objet.verifier(p, [{ id: objet.du(Date.now() + 86400000).id }], Date.now() + 86400000);
    check('le lendemain, le compteur repart', demain.prime > 0, `${demain.prime}`);
  }

  console.log('\n──────────────────────────────');
  console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
  process.exit(failures ? 1 : 0);
})();
