# 🎮 PartyZone

Une petite plateforme de mini-jeux à jouer entre potes, chacun chez soi. Un salon,
un code à 4 lettres, et que le meilleur gagne.

| | |
|---|---|
| 🎧 **Blind Test** | Ta playlist YouTube. **QCM à 4 propositions** ou saisie libre. Tout le monde entend le même extrait au même moment — et **la musique ne se coupe pas quand tu réponds**. |
| 🧠 **Culture G** | 150 questions, 12 catégories, à la PopSauce. **QCM à 4 propositions** ou réponse à taper. |
| 🕵️ **Undercover** | Un mot presque pareil, un imposteur, et beaucoup de mauvaise foi. 3 joueurs minimum. |
| 🎁 **MemeVault** | Le jeu solo : des caisses à ouvrir **à l'infini**, 60 memes à collectionner du Commun au Maudit, un combo qui grimpe tant que tu enchaînes. |

Avec en plus : connexion **Discord**, **classement général**, XP et niveaux jusqu'au rang
GOD MODE, trois **difficultés**, **podium avec confettis et fanfare** en fin de partie,
**sons** de bonne et de mauvaise réponse, et le **rail des joueurs en ligne** sur le côté.

---

## 🚀 Démarrage en local

```bash
npm install
cp .env.example .env      # puis remplis les variables
npm start
```

Ouvre http://localhost:3000. Pour tester à plusieurs sur la même machine, ouvre un
onglet de navigation privée : chaque onglet = un joueur.

> Node 18 minimum (Node 20+ recommandé).

---

## 🎁 MemeVault

Le deuxième onglet du site. Une seule boucle, mais qui ne s'arrête jamais :

**Ouvrir → collectionner → revendre les doublons → rouvrir.**

- **4 caisses**, de la Starter (60 🪙) à la Caisse Maudite (4 200 🪙). Plus elle est
  chère, plus le haut du tableau devient atteignable — les probabilités exactes sont
  affichées sur chaque caisse, aucune ne ment.
- **60 memes**, répartis en 6 raretés : Commun, Rare, Épique, Légendaire, Mythique,
  et **Maudit** (2 items, 0,1 % dans la caisse de base). Chaque item est un emoji et un
  nom : rien à héberger, rien à charger.
- **Le combo.** Chaque ouverture enchaînée dans les 90 secondes fait monter un
  multiplicateur de points, jusqu'à **×2,5**. C'est ça, « plus tu en ouvres, plus tu
  gagnes ». Arrête-toi trop longtemps et il retombe.
- **Les doublons** se revendent en pièces d'un clic. Un nouvel item rapporte 1,5× plus
  d'XP qu'un doublon.
- **Tu ne peux jamais être bloqué.** Une caisse est offerte toutes les 10 minutes, et si
  tu tombes à court de pièces, une **caisse de secours** gratuite arrive toutes les
  30 secondes. Jouer une partie rapporte aussi des pièces.
- Un tirage Mythique ou Maudit est **annoncé à tout le site** — et déclenche des confettis.

Tout est calculé côté serveur (`server/vault.js`). Modifier le JavaScript de la page ne
donne pas de pièces.

---

## 🎯 Modes de réponse et difficultés

**Mode de réponse** — au choix de l'hôte, pour le blind test comme pour le quiz :

- **QCM · 4 choix** — quatre propositions, **un seul essai**, réponse au clic ou aux
  touches `A` `B` `C` `D`. Aucune orthographe à deviner : la version qui marche le mieux
  au téléphone et avec des gens qui découvrent.
- **Saisie libre** — tu tapes la réponse, dans le jeu ou directement dans le chat. Fautes
  de frappe, accents et casse sont tolérés.

**Difficulté** — elle change le chrono, les indices et le nombre de points :

| Mode | Chrono (blind test / quiz) | Indices | Points |
|---|---|---|---|
| 🟢 **ROOKIE** | 40 s / 30 s | dès 30 % du temps | ×1 |
| 🟡 **VETERAN** | 26 s / 18 s | à partir de 60 % | ×1,6 |
| 🔴 **NIGHTMARE** | 16 s / 11 s | aucun | ×2,5 |

Le multiplicateur s'applique aux points, donc aussi à l'XP et aux pièces : jouer en
NIGHTMARE fait grimper beaucoup plus vite.

**D'où viennent les 4 propositions ?** Au blind test, les leurres sortent de ta propre
playlist — même univers musical, pas de réponse trouvable par élimination (il faut au
moins 4 titres, sinon le jeu bascule en saisie). Au quiz, une réponse chiffrée reçoit des
leurres du même ordre de grandeur (1989 → 1986 / 1991 / 1994, jamais « Sahara »), et une
réponse textuelle reçoit d'autres réponses de la même catégorie. Voir `server/choices.js`.

---

## 🔊 Le son

Tous les sons sont **synthétisés à la volée** avec la Web Audio API (`public/js/sfx.js`) :
aucun fichier audio à héberger, aucun CDN, et zéro temps de chargement.

- Une note montante quand tu trouves, un buzz descendant quand tu te trompes.
- Un « ping » discret quand quelqu'un d'autre trouve avant toi.
- Un décompte sonore sur les trois dernières secondes.
- À l'ouverture d'une caisse : un souffle, puis un arpège d'autant plus grandiose que
  l'item est rare — le Maudit a droit à sa propre fanfare.
- Une fanfare de victoire sur le podium, et une autre au passage de niveau.

Le bouton 🔊 en bas du rail coupe tout, et le choix est mémorisé. Les navigateurs
exigent un geste avant de laisser sortir du son : le premier clic sur la page suffit.

**La musique du blind test ne s'arrête jamais en cours de manche.** Répondre ne la coupe
pas, et elle continue de tourner pendant la révélation, jusqu'au décompte de la manche
suivante.

---

## 💾 Où sont stockés les profils

Le classement, l'XP et la collection ont besoin de survivre aux redémarrages. Deux
back-ends, choisis automatiquement :

| Situation | Ce qui se passe |
|---|---|
| Aucune variable `DATABASE_URL` | Fichier `data/profiles.json`. Parfait en local. |
| `DATABASE_URL` définie | PostgreSQL. C'est ce qu'il faut en ligne. |

⚠️ **En ligne sur une offre gratuite, le disque est effacé à chaque redéploiement.** Sans
base de données, le classement et les collections repartent de zéro dès que tu modifies le
site. Pour que ça tienne dans la durée :

1. Crée une base gratuite sur [neon.com](https://neon.com) (0,5 Go — un profil pèse moins
   d'un kilo-octet).
2. Copie la chaîne de connexion (`postgresql://…`).
3. Ajoute-la dans les variables d'environnement de ton hébergeur sous le nom `DATABASE_URL`.

Le serveur crée sa table tout seul au démarrage.

> Évite le PostgreSQL gratuit de Render pour ça : il **expire 30 jours après sa création**
> et la base est ensuite supprimée. Neon n'a pas cette limite.

**Note sur les invités** : un compte invité vit dans un cookie. Si le joueur vide son
navigateur, il repart à zéro. Avec Discord, la progression est rattachée au compte.

---

## 🔐 Connexion Discord

1. https://discord.com/developers/applications → **New Application**.
2. Onglet **OAuth2** : copie le **Client ID**, réinitialise et copie le **Client Secret**,
   puis dans **Redirects** ajoute exactement `<BASE_URL>/auth/discord/callback`.
3. Renseigne dans `.env` (ou dans les variables de ton hébergeur) :

```env
DISCORD_CLIENT_ID=ton_client_id
DISCORD_CLIENT_SECRET=ton_client_secret
BASE_URL=https://ton-site.exemple.com
SESSION_SECRET=une-longue-chaine-aleatoire
```

Seul le scope `identify` est demandé : pseudo et avatar, rien d'autre. Les avatars Discord
servent au chat, au rail des joueurs en ligne, au classement et au podium.

> ⚠️ Le `DISCORD_CLIENT_SECRET` ne doit jamais finir sur GitHub. `.env` est déjà ignoré.

---

## 🎵 YouTube

Deux chemins, aucun n'est obligatoire à configurer :

- **Sans clé API** (par défaut) : le navigateur de l'hôte extrait la liste des vidéos via
  le lecteur YouTube, et le serveur récupère les titres avec l'endpoint public *oEmbed*.
- **Avec une clé API** (`YOUTUBE_API_KEY`, plus rapide sur les grosses playlists) : créée
  sur console.cloud.google.com, API **YouTube Data API v3**.

La playlist doit être **publique** ou **non répertoriée**. Les vidéos qui interdisent la
lecture intégrée sont passées. L'audio démarre après un clic (le bouton « Lancer la
partie » suffit).

**Et Spotify ?** Leur SDK exige que *chaque joueur* ait un compte Premium pour entendre le
son. YouTube ne demande aucun compte. Le point d'accroche si tu veux essayer un jour est
`server/games/blindtest.js` : le jeu ne connaît que des pistes `{ videoId, title, artist }`.

---

## ☁️ Mise en ligne

Serveur Node classique avec WebSocket : n'importe quel hébergeur qui garde le processus
vivant convient (**Render**, **Railway**, **Fly.io**, un VPS). Évite le « serverless » :
les WebSockets n'y survivent pas.

Sur Render : **New → Web Service**, build `npm install`, start `npm start`, plan Free.
Puis dans **Environment** : `BASE_URL`, `SESSION_SECRET`, `DISCORD_CLIENT_ID`,
`DISCORD_CLIENT_SECRET`, et `DATABASE_URL`.

Ne définis pas `PORT` toi-même, l'hébergeur l'injecte.

> Sur les offres gratuites, le service s'endort après 15 minutes sans visite et met environ
> une minute à se réveiller. Ouvre le site deux minutes avant la soirée.

---

## 🔄 Mettre le site à jour

Le déploiement est branché sur GitHub : **tout commit sur `main` relance automatiquement
le déploiement**, en deux minutes environ.

Depuis le navigateur, sans rien installer : ouvre le fichier sur github.com → icône
**crayon** → modifie → **Commit changes**. Pour plusieurs fichiers :
**Add file → Upload files**.

**Ce que tu peux changer sans coder :**

| Envie | Fichier |
|---|---|
| Ajouter des questions | `server/data/questions.js` |
| Ajouter des paires de mots Undercover | `server/data/words.js` |
| Ajouter des memes ou des caisses | `server/data/memes.js` |
| Régler les chronos et multiplicateurs | `server/difficulty.js` |
| Équilibrer l'économie du vault | `server/vault.js` (en haut : combo, caisse gratuite, secours) |
| Changer les couleurs | `public/css/style.css` (le bloc `:root` tout en haut) |
| Changer les sons | `public/js/sfx.js` (les fréquences dans `sfx.correct`, `sfx.wrong`…) |

**Revenir en arrière** : sur Render, onglet **Deploys** → un déploiement précédent →
**Redeploy**.

---

## 🧩 Ajouter du contenu

**Questions du quiz** → `server/data/questions.js`

```js
{ c: 'Cinéma', q: 'Quel réalisateur a signé Inception ?', a: ['Nolan', 'Christopher Nolan'] }
```

La première réponse est celle qui s'affiche ; les suivantes sont acceptées aussi. Tu peux
forcer les propositions du QCM avec un champ `d` :

```js
{ c: 'Sciences', q: 'Combien de continents ?', a: ['7'], d: ['5', '6', '8'] }
```

**Memes** → `server/data/memes.js`

```js
['skibidi', '🚽', 'Skibidi', 'legendary']   // [id, emoji, nom, rareté]
```

Les raretés et leurs poids sont juste au-dessus dans le même fichier : baisser un `weight`
rend la rareté plus… rare.

**Mots d'Undercover** → `server/data/words.js`

```js
['Café', 'Thé']   // [mot des civils, mot de l'undercover]
```

---

## 🗂️ Structure

```
server/
  index.js          serveur HTTP + Socket.IO, aiguillage des événements
  auth.js           OAuth2 Discord + sessions par cookie signé
  store.js          profils, XP, niveaux, classement (fichier ou PostgreSQL)
  vault.js          économie et tirages de MemeVault
  presence.js       qui est en ligne et ce qu'il fait
  room.js           salons, joueurs, diffusion, XP et pièces de fin de partie
  difficulty.js     ROOKIE / VETERAN / NIGHTMARE
  choices.js        fabrication des 4 propositions du mode QCM
  youtube.js        import de playlist et nettoyage des titres
  util.js           normalisation, Levenshtein, masquage des réponses
  games/
    base.js         socle commun (phases, minuteurs sûrs, scores)
    blindtest.js  quiz.js  undercover.js
  data/
    questions.js  150 questions    words.js  80 paires    memes.js  60 memes
public/
  index.html  css/style.css
  js/app.js         écrans, socket, chat, salon, classement, présence
  js/vault.js       rendu de MemeVault
  js/sfx.js         sons synthétisés + confettis
  js/yt.js          pont avec le lecteur YouTube
  js/games/*.js     rendu de chaque jeu
test/
  harness.js        parties complètes simulées (clients Socket.IO)
  ui.js             test de bout en bout dans un vrai navigateur + captures
  stub-youtube.js   métadonnées YouTube simulées, pour tester hors ligne
```

Chaque jeu hérite de `BaseGame` et n'expose que quatre méthodes : `start()`, `handle()`,
`stateFor(joueur)` et `stop()`. Le serveur envoie à chaque joueur **sa propre vue** de la
partie : le mot d'un joueur d'Undercover, la bonne réponse d'un QCM ou la solution d'une
manche ne partent jamais vers ceux qui ne doivent pas les voir.

---

## ✅ Tests

```bash
npm start            # dans un terminal
npm test             # dans un autre : parties complètes simulées

npm run test:server  # serveur de test sur le port 3100, YouTube simulé
npm run test:ui      # navigateur réel, captures dans test/shots/
```

66 assertions côté serveur et 31 côté navigateur. Couvert : salons et droits de l'hôte,
QCM du quiz et du blind test (un seul essai, mauvaise réponse à 0 point), multiplicateurs
de difficulté, génération des leurres sur les 150 questions, rôles et votes d'Undercover,
économie complète de MemeVault (probabilités qui font 100 %, caisses trop chères refusées,
combo, revente des doublons), présence temps réel et changements de statut, podium et
confettis, continuité de la musique après une réponse, raccourcis clavier, et absence de
débordement horizontal sur mobile.
