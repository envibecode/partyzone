# PartyZone

Un petit casino à jouer entre amis, dans le navigateur, **avec des pièces
virtuelles uniquement**.

> **Il n'y a aucun moyen d'acheter des pièces.** Aucun paiement, aucune
> conversion, aucun gain réel. Les pièces se gagnent en cliquant à la mine
> et en jouant. C'est un choix volontaire : dès qu'on peut payer pour jouer,
> on tombe dans le jeu d'argent, avec licence, vérification d'âge et
> réglementation différente dans chaque pays. Ce projet reste du côté du
> jouet.

---

## Ce qu'il y a dedans

| | |
|---|---|
| ⛏️ **La Mine** | Le robinet de secours, volontairement chiche : une barre d'endurance pleine vaut **environ 60 pièces**, et elle met 85 secondes à se refaire. De quoi poser une mise quand on est fauché, pas de quoi s'enrichir. Autoclic inutile par construction. |
| 💸 **Rakeback** | **1 à 1,8 % de tout ce qui est misé** revient au joueur, gagné ou perdu. Comme les jeux détruisent 3 à 5 % du volume, l'ensemble reste déflationniste. C'est la vraie source de revenus d'un joueur régulier. |
| 🛒 **Marché** | Revente de doublons entre joueurs, au prix qu'on veut. Commission de 8 % **détruite** (pas redistribuée), prix plancher et plafond, et le dernier exemplaire d'un objet n'est jamais vendable. |
| 🃏 **Blackjack** | Table à 5 sièges, 6 jeux de cartes, blackjack payé 3:2. **Aucun bot** : on voit les salons ouverts et on rejoint ses potes. Paris annexes (paires parfaites, 21+3), mode auto, remise en un clic, chat à la table. |
| 🎡 **Roulette** | Roue européenne à 37 cases, **partagée par tout le site**. On voit les mises des autres case par case, les pseudos des gagnants du dernier tour défilent, et le solde est gelé pendant la rotation pour ne pas dévoiler le résultat. Remise, mises automatiques, configurations enregistrées. |
| 🔻 **Plinko** | 8, 12 ou 16 rangées, trois niveaux de risque. Multiplicateurs calculés à partir des vraies probabilités binomiales. Historique bille par bille sur le côté. |
| 🎰 **Les Copains** | Machine à sous 5 rouleaux × 3 rangées, 10 lignes, thème serveur Discord. Joker, symbole bonus, 8 tours offerts à ×3. Redistribution **mesurée** sur 400 000 tours simulés : 95,39 %. |
| 📦 **Caisses** | **518 objets de culture internet** à collectionner, six raretés, huit catégories. 5 caisses générales + 8 caisses à thème. Rouleau horizontal façon CS:GO qui montre ce que tu aurais pu avoir. Les doublons se revendent. |
| 🏅 **Médailles & parures** | Un palier tous les 50 objets. Le **premier joueur du site** à l'atteindre garde la version dorée, pour toujours. On y débloque des contours d'avatar, des pseudos en flammes et des icônes animées, visibles partout sur le site. |
| 🎁 **Cadeaux** | Offrir une caisse à un copain (le donneur paie, plafond quotidien) ou en distribuer depuis le panel admin. |
| 🏆 **Classements** | Général par pièces, par niveau ou par rang Party, plus un **classement du mois** sur le bénéfice net. |
| 🗺️ **À venir** | Une page qui dit franchement ce qui est en chantier, ce qui reste à décider (publicité, abonnements) et ce qui est déjà en ligne. |
| 💬 **Chat** | Une salle pour tout le site, présente aussi dans la roulette et au blackjack. |
| 🎈 **Party** | Une section à part, **sans aucune pièce** : salons à code, chat, et un **rang Party** séparé qui compte les soirées jouées plutôt que la chance. Deux jeux dedans pour l'instant — **Undercover** (3 à 12 joueurs, avec Monsieur Blanc) et **Poker** Texas Hold'em en tournoi (2 à 8, jetons de tournoi, blindes qui montent, pots secondaires). Loup-garou, Uno, Belote et Monopoly sont annoncés dans le hall mais pas encore jouables. |
| 🛡️ **Équité vérifiable** | Chaque tirage vient d'une graine dont l'empreinte est publiée **avant** que tu mises. |
| 🛠️ **Panel admin** | Joueurs, pièces, XP, caisses offertes, bannissements, tables ouvertes, annonces animées, journal des actions. La page se rafraîchit toute seule. |

Connexion **Discord** (facultative) ou en invité. Avec Discord, ta
progression est gardée pour toujours et ton avatar s'affiche partout.

---

## Démarrer en local

```bash
npm install
npm start
```

Puis ouvre <http://localhost:3000>. Sans aucune configuration ça marche
déjà : mode invité, progression dans `data/profiles.json`.

---

## Mettre le site en ligne (Render, gratuit)

1. Mets le dossier sur **GitHub** (dépôt privé si tu veux).
2. Sur <https://render.com>, *New → Web Service*, choisis ton dépôt.
   Render lit `render.yaml` et remplit tout seul.
3. Plan **Free**. Pas de carte bancaire demandée.
4. Dans l'onglet **Environment**, ajoute :

   | Variable | À quoi ça sert |
   |---|---|
   | `BASE_URL` | `https://ton-service.onrender.com` — obligatoire pour Discord |
   | `ADMIN_KEY` | Une longue phrase secrète, pour t'attribuer les droits admin |
   | `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Seulement si tu veux la connexion Discord |
   | `DATABASE_URL` | Seulement si tu veux une vraie base (voir plus bas) |

5. Déploie. Environ deux minutes.

**Le plan gratuit s'endort** après 15 minutes sans visite, et met à peu
près une minute à se réveiller à la visite suivante. C'est normal.

### Discord (facultatif)

Sur <https://discord.com/developers/applications> : *New Application* →
onglet **OAuth2** → copie l'ID client et le secret → dans **Redirects**,
ajoute exactement `https://ton-service.onrender.com/auth/discord/callback`.
Le site ne demande que la portée `identify` : ton pseudo et ton avatar,
rien d'autre.

### Garder la progression pour de bon

Par défaut tout est écrit dans `data/profiles.json`, **et le disque de
Render est effacé à chaque déploiement**. Pour que rien ne se perde :

1. Crée une base PostgreSQL gratuite sur <https://neon.tech>.
   (La base gratuite de Render, elle, **expire au bout de 30 jours**.)
2. Copie la chaîne de connexion.
3. Ajoute-la comme variable `DATABASE_URL` sur Render.

Les tables sont créées toutes seules au premier démarrage.

### Devenir administrateur

Le bouton « Admin » n'apparaît dans le menu qu'une fois les droits obtenus.
Pour les réclamer la première fois :

1. Ajoute `ADMIN_KEY` dans les variables d'environnement, redéploie.
2. Va sur **`https://ton-service.onrender.com/#admin`** (avec le `#admin`).
3. Tape la clé. C'est enregistré dans ton profil, définitivement.

Tu peux aussi mettre `ADMIN_IDS` (identifiants séparés par des virgules)
si tu connais déjà les identifiants concernés.

---

## Mettre le site à jour

Render surveille ta branche : **tu pousses, il redéploie.**

```bash
git add .
git commit -m "ce que j'ai changé"
git push
```

Une minute ou deux plus tard, le site est à jour. L'onglet *Events* de
Render montre l'avancement, *Logs* montre les erreurs éventuelles. Si un
déploiement casse quelque chose, *Rollback* remet la version d'avant.

> ⚠️ **Sans base de données, chaque mise à jour efface la progression.**
> Le fichier `data/profiles.json` vit sur le disque temporaire de Render, qui
> est jeté à chaque redéploiement. Branche PostgreSQL (section
> *Garder la progression pour de bon*) **avant** de commencer à jouer
> sérieusement — c'est l'étape à ne pas sauter.

---

## L'honnêteté du casino

Tout est décidé côté serveur, avant que tu ne voies quoi que ce soit.

- Avant chaque partie, le serveur publie l'**empreinte SHA-256** de sa
  graine secrète. Elle est figée.
- Tu peux mettre **ta propre graine** : le serveur ne peut donc pas viser
  un résultat précis.
- Chaque coup consomme un **nonce** qui s'incrémente. Rien ne se rejoue.
- Quand tu changes de graine, l'ancienne est **révélée**. Tu vérifies que
  son SHA-256 correspond bien à l'empreinte affichée avant.
- Le résultat sort de `HMAC_SHA256(graine_serveur, graine_client:nonce:curseur)`.

La page **Équité** du site explique tout ça et affiche tes graines.

Les taux de redistribution annoncés sont **calculés**, pas décoratifs :

| Jeu | Redistribution |
|---|---|
| Roulette | 97,30 % (règle européenne, 36/37) |
| Plinko | 96,6 % à 97,5 % selon la table — calculé après arrondi des multiplicateurs |
| Blackjack | dépend de ton jeu ; la stratégie de base tourne autour de 99,5 % |
| Paris annexes | paires parfaites 93,89 %, 21+3 95,38 % — calculés par énumération exacte |
| Machine à sous | 95,39 %, mesurée au démarrage sur 400 000 tours simulés (tour bonus compris) |

Le panel admin affiche en plus la **redistribution réellement observée**
sur l'ensemble du site depuis le premier jour.

---

## Anti-triche

Le navigateur ne fait qu'afficher. Il ne calcule aucun résultat.

- Le solde, les mises, les tirages, la distribution des cartes : tout est
  côté serveur, et revérifié à chaque message.
- La mine plafonne à 12 clics par seconde, comptés par le serveur avec un
  seau à jetons, et l'endurance descend plus vite qu'elle ne remonte. Un
  autoclic tape dans le vide au bout de quelques secondes — c'est réglé par
  la mécanique du jeu, pas par une détection qu'on peut contourner.
- Les cadeaux entre joueurs ont un plafond quotidien : on ne peut pas vider
  un compte dans un autre pour fausser le classement du mois.
- Le marché prélève 8 % qui sont **détruits**. Faire tourner un objet entre
  deux comptes complices coûte donc de l'argent à chaque aller-retour, au
  lieu d'en fabriquer.
- Un cadeau de cinquante caisses s'ouvre par fournées de dix, et le reste
  est conservé — rien ne se perd en route.
- Le rouleau des caisses est envoyé **déjà tiré** : l'animation ne fait que
  rejouer un résultat décidé avant.
- Le panel admin revérifie les droits à chaque action. Masquer un bouton
  n'a jamais protégé personne.

---

## Tests

Le serveur doit tourner (`npm start`) dans un autre terminal.

```bash
npm test               # joue vraiment à tout, en Socket.IO, et vérifie l'économie
npm run test:economy   # marché, rakeback, récompenses Party, gros cadeaux
npm run test:party     # une partie d'Undercover et une main de poker, à 4 clients
npm run test:poker     # 60 tournois simulés : aucun jeton créé ni perdu
npm run test:ui        # parcours navigateur du casino + captures d'écran
npm run test:ui-party  # parcours navigateur de la section Party
```

`npm test` vérifie entre autres que le RTP observé du Plinko sur 600 billes
colle à celui annoncé, que la graine révélée correspond bien à l'empreinte
publiée avant, et qu'aucune mise négative ou supérieure au solde ne passe.

`npm run test:ui` vérifie notamment que l'aiguille du rouleau s'arrête bien
sur l'objet gagné, que la collection affiche les 518 objets avec les
manquants grisés, qu'aucun nom n'est tronqué, que les rouleaux de la machine
à sous se posent sur leurs quinze symboles, et que le panel admin se met à
jour sans qu'on recharge la page.

`npm run test:poker` ne demande pas de serveur : il joue soixante tournois
entiers au hasard, avec beaucoup de tapis pour fabriquer des pots secondaires,
et vérifie **après chaque action** que la somme des jetons de la table n'a pas
bougé d'un iota. C'est ce test qui a trouvé les trois vrais bugs du moteur.

Les captures atterrissent dans `shots/`.

---

## Structure

```
server/
  index.js       aiguillage Socket.IO et API
  fair.js        graines, empreintes, HMAC → nombres
  clicker.js     La Mine
  plinko.js      tables de multiplicateurs et tirages
  roulette.js    la roue partagée
  blackjack.js   tables, sabot, manches
  sidebets.js    paris annexes et leurs taux exacts
  slots.js       la machine à sous et sa redistribution mesurée
  vault.js       caisses, rouleau, collection
  medals.js      paliers, premiers du site, parures
  season.js      classement du mois et palmarès
  gifts.js       cadeaux entre joueurs et distribution admin
  market.js      le marché de revente et sa commission détruite
  rakeback.js    la part des mises rendue au joueur
  chat.js        la salle de discussion
  store.js       profils et état du site (fichier JSON ou PostgreSQL)
  auth.js        Discord OAuth2 + invités
  presence.js    qui est en ligne
  admin.js       panel d'administration
  data/collection.js  les 518 objets
  data/cases.js       les 13 caisses et leurs probabilités
  party/rooms.js      les salons à code, communs à tous les jeux Party
  party/rank.js       le rang Party, séparé du casino
  party/undercover.js les rôles, les manches, les votes
  party/words.js      les paires de mots, par difficulté
  party/poker.js      la table de Hold'em : blindes, tapis, pots secondaires
  party/holdem.js     l'évaluation d'une main de sept cartes
public/
  index.html     la coquille
  css/style.css  toute la direction artistique
  js/            app, lobby, chat, mine, plinko, roulette, blackjack,
                 slots, medals, vault, market, party, undercover, poker,
                 admin, sfx
test/
  harness.js     banc d'essai Socket.IO du casino
  party.js       banc d'essai de la section Party
  poker-sim.js   60 tournois simulés, sans réseau
  ui.js          parcours navigateur du casino
  ui-party.js    parcours navigateur de la Party
  economy.js     marché, rakeback, récompenses, gros cadeaux
```

Aucune étape de compilation : ce que tu lis dans `public/` est exactement
ce que le navigateur exécute. Tu peux modifier, recharger, voir le résultat.
