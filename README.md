# 🎉 PartyZone

Un site de mini-jeux multijoueur à jouer entre potes, chacun chez soi. Un salon, un code à
4 lettres, et c'est parti.

| Jeu | Ce que c'est |
|---|---|
| 🎧 **Blind Test** | Colle une playlist YouTube, tout le monde entend le même extrait au même moment, et on tape le titre et l'artiste le plus vite possible. |
| 🧠 **Quiz culture G** | À la PopSauce : une question, tout le monde tape en même temps, les lettres de la réponse se dévoilent au fil du chrono. |
| 🕵️ **Undercover** | Les civils partagent un mot, l'undercover en a un presque identique, Mr White n'a rien. Un mot chacun par tour, puis on vote. |

Connexion **Discord** (ou mode invité), chat en direct, scores cumulés sur la session,
et une interface pensée pour le téléphone autant que pour l'ordi.

---

## 🚀 Démarrage en local (5 minutes)

```bash
npm install
cp .env.example .env      # puis remplis les variables (voir plus bas)
npm start
```

Ouvre http://localhost:3000. Pour tester à plusieurs sur la même machine, ouvre un
onglet de navigation privée : chaque onglet = un joueur.

> Node 18 minimum (Node 20+ recommandé).

---

## 🔐 Connexion Discord

1. Va sur https://discord.com/developers/applications → **New Application**.
2. Onglet **OAuth2** :
   - copie le **Client ID** et le **Client Secret** ;
   - dans **Redirects**, ajoute exactement : `http://localhost:3000/auth/discord/callback`
     (et, une fois en ligne, `https://ton-domaine.com/auth/discord/callback`).
3. Renseigne dans `.env` :

```env
DISCORD_CLIENT_ID=ton_client_id
DISCORD_CLIENT_SECRET=ton_client_secret
BASE_URL=http://localhost:3000
SESSION_SECRET=une-longue-chaine-aleatoire
```

Le seul scope demandé est `identify` : PartyZone récupère le pseudo et l'avatar, rien d'autre.
Aucune base de données — la session tient dans un cookie signé (HMAC-SHA256).

Tant que Discord n'est pas configuré, le bouton est désactivé et le mode invité prend le relais.

> ⚠️ Le `DISCORD_CLIENT_SECRET` ne doit jamais finir dans Git : `.env` est déjà dans `.gitignore`.

---

## 🎵 YouTube

Deux chemins, et **aucun des deux n'est obligatoire à configurer** :

- **Sans clé API** (par défaut) : quand tu importes une playlist, c'est le navigateur de
  l'hôte qui en extrait la liste des vidéos via le lecteur YouTube, puis le serveur récupère
  les titres avec l'endpoint public *oEmbed*. Ça marche tout de suite.
- **Avec une clé API** (plus rapide, plus fiable sur les grosses playlists) : crée un projet
  sur https://console.cloud.google.com, active **YouTube Data API v3**, génère une clé et
  mets-la dans `YOUTUBE_API_KEY`.

Contraintes à connaître :

- la playlist doit être **publique** ou **non répertoriée** (une playlist privée est illisible) ;
- certaines vidéos interdisent la lecture intégrée : elles sont simplement passées ;
- l'audio démarre après un clic (règle des navigateurs) — le bouton « Lancer la partie »
  suffit à débloquer la lecture pour l'hôte, les autres joueurs cliquent sur la page.

**Et Spotify ?** L'API Spotify ne permet plus de lire de la musique dans un site web
sans que *chaque* joueur ait un compte Premium et passe par le Web Playback SDK. C'est
faisable mais ça change la donne : tous tes potes devraient être Premium. YouTube reste
la voie la plus simple pour jouer à plusieurs sans friction. Si tu veux quand même Spotify
un jour, le point d'accroche est `server/games/blindtest.js` : le jeu ne connaît que des
pistes `{ videoId, title, artist }`, la source est interchangeable.

---

## ☁️ Mise en ligne

Le projet est un serveur Node classique avec WebSocket : n'importe quel hébergeur qui
garde le processus vivant fait l'affaire (**Render**, **Railway**, **Fly.io**, un VPS…).
Évite les plateformes 100 % « serverless » : les WebSockets n'y survivent pas.

### Render (gratuit, le plus simple)

1. Pousse le projet sur GitHub.
2. Sur https://render.com → **New → Web Service** → connecte le dépôt.
3. Réglages :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
4. Onglet **Environment**, ajoute : `BASE_URL` (l'URL `https://…onrender.com` que Render
   te donne), `SESSION_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`,
   et `YOUTUBE_API_KEY` si tu en as une.
5. Retourne sur le portail Discord ajouter le redirect `https://ton-app.onrender.com/auth/discord/callback`.

Ne définis pas `PORT` toi-même : l'hébergeur l'injecte.

> Sur les offres gratuites, le service s'endort après quelques minutes d'inactivité et les
> salons en cours sont perdus. Pour des soirées régulières, une petite offre payante ou un
> VPS évite la coupure.

---

## 🎮 Comment on joue

1. L'hôte clique sur **Créer un salon** et partage le code (un clic sur le code copie le
   lien d'invitation).
2. Chacun rejoint avec le code, ou via le lien.
3. L'hôte choisit un jeu, règle les paramètres, et lance.
4. Pendant le blind test et le quiz, **le chat sert aussi de zone de réponse** : tape ta
   proposition n'importe où, ça compte.

Détails utiles :

- **Blind Test** : titre et artiste rapportent des points séparément, plus tu es rapide plus
  ça paye, et le premier à trouver touche un bonus. Après 40 % du temps, des lettres
  apparaissent. Une majorité de joueurs peut voter pour passer un titre.
- **Quiz** : les fautes de frappe, la casse et les accents sont tolérés. Les catégories
  sont filtrables ; aucune sélection = toutes.
- **Undercover** : 3 joueurs minimum, Mr White à partir de 4. Les civils gagnent quand tous
  les imposteurs sont éliminés ; les imposteurs gagnent dès qu'ils sont aussi nombreux que
  les civils. Éliminé, Mr White a une dernière chance de deviner le mot pour tout rafler.

---

## 🧩 Ajouter du contenu

Aucun code à écrire, juste des listes à rallonger :

- **Questions du quiz** → `server/data/questions.js`
  ```js
  { c: 'Cinéma', q: 'Quel réalisateur a signé Inception ?', a: ['Nolan', 'Christopher Nolan'] }
  ```
  La première réponse est celle qui s'affiche ; les suivantes sont acceptées aussi.

- **Mots d'Undercover** → `server/data/words.js`
  ```js
  ['Café', 'Thé']   // [mot des civils, mot de l'undercover]
  ```
  Les meilleures paires sont proches mais pas synonymes : la nuance doit pouvoir se
  trahir en un mot.

---

## 🗂️ Structure

```
server/
  index.js            serveur HTTP + Socket.IO, aiguillage des événements
  auth.js             OAuth2 Discord + sessions par cookie signé
  room.js             salons, joueurs, diffusion de l'état
  youtube.js          import de playlist et nettoyage des titres
  util.js             normalisation, distance de Levenshtein, masquage des réponses
  games/
    base.js           socle commun (phases, minuteurs sûrs, scores)
    blindtest.js  quiz.js  undercover.js
  data/
    questions.js      banque de questions culture G
    words.js          paires de mots Undercover
public/
  index.html  css/style.css
  js/app.js           écrans, socket, chat, salon
  js/yt.js            pont avec le lecteur YouTube
  js/games/*.js       rendu de chaque jeu
test/
  harness.js          parties complètes simulées (plusieurs clients Socket.IO)
  ui.js               test de bout en bout dans un vrai navigateur + captures
```

Chaque jeu hérite de `BaseGame` et n'expose que quatre méthodes : `start()`, `handle()`,
`stateFor(joueur)` et `stop()`. Pour ajouter un quatrième mini-jeu, crée un fichier dans
`server/games/`, un module de rendu dans `public/js/games/`, et déclare-le dans la table
`GAMES` de `server/index.js` et dans le sélecteur de `public/index.html`.

Le serveur envoie à chaque joueur **sa propre vue** de la partie (`stateFor`) : le mot
d'un joueur d'Undercover ou la réponse d'une manche ne transitent jamais vers ceux qui ne
doivent pas les voir.

---

## ✅ Tests

```bash
npm start            # dans un terminal
npm test             # dans un autre : parties complètes simulées

# test d'interface dans un vrai navigateur (Chromium via Playwright)
npm run test:server  # serveur de test sur le port 3100, métadonnées YouTube simulées
npm run test:ui      # captures écrites dans test/shots/
```

Les tests couvrent la création de salon, les droits de l'hôte, une partie de quiz de bout
en bout, la distribution des rôles d'Undercover, le vote et les conditions de victoire, la
tolérance orthographique, le nettoyage des titres YouTube, le chat, et l'absence de
débordement horizontal sur mobile.
