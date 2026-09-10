'use strict';
/**
 * LA LECTURE D'UNE PLAYLIST, VÉRIFIÉE SANS YOUTUBE.
 *
 * On ne peut pas appeler YouTube depuis un banc d'essai : ça demanderait un
 * réseau, une playlist qui existe encore, et ça casserait le jour où
 * quelqu'un la supprime. Ce qui se teste, en revanche, c'est TOUT le reste —
 * et c'est là que sont les vraies erreurs :
 *
 *  · reconnaître une adresse de playlist sous ses quatre formes ;
 *  · retrouver l'objet JSON planqué dans deux mégaoctets de HTML, sans se
 *    faire piéger par une accolade au milieu d'un titre ;
 *  · ramasser les pistes sans connaître le nom que YouTube donne à ses
 *    objets cette année ;
 *  · ne pas ramasser deux fois la même, ni les vidéos supprimées.
 *
 * Les échantillons ci-dessous reproduisent la forme réelle des réponses de
 * YouTube, avec les pièges dedans.
 */

const yt = require('../server/youtube');

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log('\n▶ ' + t);

/** Une piste, dans la forme qu'utilise vraiment YouTube. */
const piste = (id, title, author) => ({
  playlistVideoRenderer: {
    videoId: id,
    title: { runs: [{ text: title }] },
    shortBylineText: { runs: [{ text: author }] },
    index: { simpleText: '1' },
  },
});

(function main() {
  console.log('Lecture d’une playlist YouTube — tout sauf le réseau\n');

  /* ── L'ADRESSE ── */
  section('Reconnaître une adresse');
  {
    const bonnes = [
      ['https://www.youtube.com/playlist?list=PLabc123DEF456', 'PLabc123DEF456'],
      ['https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLxyz789', 'PLxyz789'],
      ['https://m.youtube.com/playlist?list=PL_tirets-et_soulignes', 'PL_tirets-et_soulignes'],
      ['PLcollee-toute-seule', 'PLcollee-toute-seule'],
      ['UUunechaineentiere', 'UUunechaineentiere'],
    ];
    bonnes.forEach(([url, attendu]) => {
      const got = yt.playlistId(url);
      check(`« ${url.slice(0, 46)}${url.length > 46 ? '…' : ''} »`, got === attendu, got || 'rien');
    });

    const mauvaises = [
      '', 'bonjour', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', null, undefined,
      // Une phrase quelconque d'une douzaine de lettres passait pour un
      // identifiant : on répondait « playlist illisible » à quelqu'un qui
      // avait juste tapé à côté.
      'pas-une-adresse', 'coucou-les-amis',
    ];
    check('une adresse sans playlist est refusée',
      mauvaises.every((x) => yt.playlistId(x) === null),
      mauvaises.filter((x) => yt.playlistId(x)).join(', ') || 'aucune ne passe');
  }

  /* ── LE JSON DANS LE HTML ── */
  section('Retrouver le JSON dans la page');
  {
    const objet = { contents: { items: [piste('aaa', 'Un titre', 'Un artiste')] } };
    const html = `<!doctype html><html><head><script>var ytInitialData = ${JSON.stringify(objet)};</script>`
      + '</head><body>du bruit</body></html>';
    const lu = yt.initialData(html);
    check('l’objet est retrouvé', Boolean(lu) && Boolean(lu.contents));

    // Le piège : une accolade DANS un titre. Une expression régulière
    // naïve s'arrête là et rend un JSON tronqué.
    const piege = { contents: { items: [piste('bbb', 'Le titre } avec une accolade', 'Quelqu’un')] } };
    const html2 = `<script>window["ytInitialData"] = ${JSON.stringify(piege)};</script>`;
    const lu2 = yt.initialData(html2);
    check('une accolade dans un titre ne coupe pas la lecture',
      Boolean(lu2) && yt.harvest(lu2).length === 1,
      lu2 ? `${yt.harvest(lu2).length} piste(s)` : 'objet illisible');

    // Et un guillemet échappé.
    const piege2 = { contents: { items: [piste('ccc', 'Il a dit \\"non\\" }', 'X')] } };
    const html3 = `<script>ytInitialData = ${JSON.stringify(piege2)}; var autre = {};</script>`;
    check('un guillemet échappé non plus', Boolean(yt.initialData(html3)));

    check('une page sans le moindre JSON renvoie rien',
      yt.initialData('<html><body>rien du tout</body></html>') === null);
  }

  /* ── LE RAMASSAGE ── */
  section('Ramasser les pistes');
  {
    const data = {
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [
            { itemSectionRenderer: { contents: [{ playlistVideoListRenderer: { contents: [
              piste('vid00000001', 'Daft Punk - Around the World', 'Daft Punk'),
              piste('vid00000002', 'Stromae - Alors on danse', 'Stromae'),
              piste('vid00000003', 'Angèle - Balance ton quoi', 'Angèle'),
            ] } }] } },
          ] } } } }],
        },
      },
    };
    const tracks = yt.harvest(data);
    check('les trois pistes sont trouvées', tracks.length === 3, `${tracks.length}`);
    check('avec leur titre', tracks[0].title === 'Daft Punk - Around the World', tracks[0].title);
    check('et leur artiste', tracks[0].author === 'Daft Punk', tracks[0].author);
    check('dans l’ordre de la playlist',
      tracks.map((t) => t.id).join(',') === 'vid00000001,vid00000002,vid00000003');

    // Le même identifiant deux fois : une playlist peut contenir un doublon,
    // et YouTube répète parfois la piste en cours ailleurs dans la page.
    const doublons = { a: [piste('meme', 'Un titre', 'X')], b: [piste('meme', 'Un titre', 'X')] };
    check('un doublon n’est ramassé qu’une fois', yt.harvest(doublons).length === 1);

    // Un objet qui a un videoId mais pas de titre lisible : ce n'est pas
    // une piste, c'est une miniature ou un lien de navigation.
    const sansTitre = { thumbnailOverlay: { videoId: 'xxx' }, autre: { videoId: 'yyy', title: {} } };
    check('un videoId sans titre n’est pas une piste', yt.harvest(sansTitre).length === 0);

    // On ne dépasse jamais le plafond, même sur une playlist énorme.
    const enorme = { list: Array.from({ length: 500 }, (_, i) => piste(`v${i}`, `Titre ${i}`, 'A')) };
    check('le plafond est respecté',
      yt.harvest(enorme).length === yt.MAX_TRACKS, `${yt.harvest(enorme).length} sur 500`);

    // Un arbre profond ne fait pas exploser la pile.
    let profond = piste('fond', 'Tout au fond', 'A');
    for (let i = 0; i < 200; i++) profond = { niveau: profond };
    check('un arbre très profond ne casse rien', Array.isArray(yt.harvest(profond)));
  }

  /* ── LES TROIS FORMES DE TEXTE ── */
  section('Les trois façons dont YouTube écrit un texte');
  {
    check('« simpleText »', yt.textOf({ simpleText: 'Bonjour' }) === 'Bonjour');
    check('« runs »', yt.textOf({ runs: [{ text: 'Bon' }, { text: 'jour' }] }) === 'Bonjour');
    check('une chaîne toute nue', yt.textOf('Bonjour') === 'Bonjour');
    check('et rien du tout', yt.textOf(null) === '' && yt.textOf({}) === '');
  }

  /* ── LES TRANCHES ── */
  section('Les playlists longues, qui arrivent en tranches');
  {
    const avecSuite = {
      contents: [piste('a', 'Un', 'X')],
      continuations: [{ continuationEndpoint: { continuationCommand: { token: 'JETON-DE-SUITE' } } }],
    };
    check('le jeton de continuation est trouvé',
      yt.continuationOf(avecSuite) === 'JETON-DE-SUITE', yt.continuationOf(avecSuite) || 'rien');
    check('une playlist courte n’en a pas',
      yt.continuationOf({ contents: [piste('a', 'Un', 'X')] }) === null);
  }

  /* ── CE QUI SE PASSE QUAND ÇA RATE ── */
  section('Quand ça ne marche pas, on le dit');
  {
    // Pas de réseau ici : l'appel échouera, et c'est exactement ce qu'on veut
    // vérifier — qu'il échoue PROPREMENT, avec une raison utilisable par
    // l'écran pour proposer le repli navigateur.
    yt.playlist('pas-une-adresse').then((r) => {
      check('une adresse invalide est refusée tout de suite',
        r.ok === false && r.reason === 'adresse', r.message);

      console.log('\n──────────────────────────────');
      console.log(failures === 0 ? 'TOUT PASSE' : `${failures} vérification(s) en échec.`);
      process.exit(failures ? 1 : 0);
    });
  }
})();
