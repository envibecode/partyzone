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

## Le but du site

Une seule chose compte : **finir le mois avec le plus d'XP.** Le reste n'est
que le chemin pour y arriver.

```
   Le casino          →   Les caisses        →   Le classement
   (blackjack,            (les pièces se         (le premier en XP
    roulette, Plinko,      dépensent ici,         au dernier jour
    machine à sous)        et ça donne l'XP)      remporte le lot)
        ↑
   La Mine, quand on n'a plus rien
   (une barre d'endurance ≈ 60 pièces)
```

Ce que ça change, et c'est volontaire : **amasser des pièces ne fait pas
gagner.** Le joueur prudent qui garde son magot sans jamais ouvrir une
caisse finit dernier — il n'est même pas classé. Il faut dépenser pour
marquer. Le classement a longtemps compté le bénéfice net ; il récompensait
exactement le contraire de ce qu'on veut voir se passer un vendredi soir.

**La section Party est complètement à part.** Son rang compte les soirées
passées à jouer ensemble, il ne se mélange à rien : gagner au Monopoly ne
rapporte **aucune** XP au classement du mois. C'est le classement entre
potes, et rien d'autre.

Et le lot : c'est un **concours gratuit**, pas une loterie. Personne ne peut
acheter de pièces, donc personne ne paie pour participer. Le site désigne le
vainqueur et le dit ; **la remise se fait à la main**, en dehors du site.
Rien n'est distribué automatiquement.

---

## Ce qu'il y a dedans

| | |
|---|---|
| ⛏️ **La Mine** | Le robinet de secours, volontairement chiche : une barre d'endurance pleine vaut **environ 60 pièces**, et elle met 85 secondes à se refaire. De quoi poser une mise quand on est fauché, pas de quoi s'enrichir. Autoclic inutile par construction. |
| 💸 **Rakeback** | **1 à 1,8 % de tout ce qui est misé** revient au joueur, gagné ou perdu. Comme les jeux détruisent 3 à 5 % du volume, l'ensemble reste déflationniste. C'est la vraie source de revenus d'un joueur régulier. |
| 🛒 **Marché** | Revente de doublons entre joueurs, au prix qu'on veut. Commission de 8 % **détruite** (pas redistribuée), prix plancher et plafond, et le dernier exemplaire d'un objet n'est jamais vendable. |
| 🃏 **Blackjack** | Vrai tapis vert à **cinq places, pas une de plus**, 6 jeux de cartes, blackjack payé 3:2. **Aucun bot**. On peut **regarder une partie sans jouer** (et s'asseoir quand une place se libère), la donne **part dès que tout le monde a misé** au lieu d'attendre les 22 secondes, et l'hôte peut **retirer quelqu'un qui squatte un siège** — jamais quelqu'un qui a une mise en jeu. Paris annexes (paires parfaites, 21+3), mode auto, remise en un clic, chat à la table. |
| 🎡 **Roulette** | Roue européenne à 37 cases, **partagée par tout le site**. On voit les mises des autres case par case, les pseudos des gagnants du dernier tour défilent, et le solde est gelé pendant la rotation pour ne pas dévoiler le résultat. Remise, mises automatiques, configurations enregistrées. |
| 🔻 **Plinko** | 8, 12 ou 16 rangées, trois niveaux de risque. Multiplicateurs calculés à partir des vraies probabilités binomiales. Historique bille par bille sur le côté. |
| 🎰 **Horse House** | Machine à sous 5 rouleaux × 3 rangées, **20 lignes fixes**, dans un ranch. La **porte d'écurie** (rouleaux 2, 3, 4) remplace tout et arrive avec un ×2 ou un ×3 — plusieurs portes sur la même ligne **additionnent** leurs multiplicateurs. Trois **fers à cheval** (rouleaux 1, 3, 5) ouvrent 10 tours offerts pendant lesquels **les portes restent collées** jusqu'à la fin, multiplicateur compris ; trois fers de plus rajoutent 10 tours. Redistribution **mesurée**, pas promise : 94,6 %, plafond de gain à 2 500× la mise. |
| 📦 **Caisses** | **518 objets de culture internet** à collectionner, six raretés, huit catégories. 5 caisses générales + 8 caisses à thème. Rouleau horizontal façon CS:GO qui montre ce que tu aurais pu avoir. Les doublons se revendent. |
| 🏅 **Médailles & parures** | Un palier tous les 50 objets. **Tout le monde peut décrocher les mêmes** : un palier se mérite, il ne se réserve pas. On y débloque des contours d'avatar, des pseudos en flammes et des icônes animées, visibles partout sur le site. |
| 🎁 **Cadeaux** | Offrir une caisse à un copain (le donneur paie, plafond quotidien) ou en distribuer depuis le panel admin. |
| 🏆 **Classements** | Général par XP, par pièces ou par rang Party, plus le **classement du mois — en XP**, celui qui décide du lot. |
| 🗺️ **À venir** | Une page qui dit franchement ce qui est en chantier, ce qui reste à décider (publicité, abonnements) et ce qui est déjà en ligne. |
| 💬 **Chat** | Une salle pour tout le site, présente aussi dans la roulette et au blackjack. |
| 🎯 **Défis du jour** | Trois objectifs tirés au sort chaque jour à minuit, **les mêmes pour tout le monde** — « t'as réussi celui des trois caisses ? » est une phrase qu'on peut dire à ses potes. Payés en pièces, automatiquement : pas de bouton « récupérer », qui n'est qu'une récompense qu'on oublie de prendre. Moins de mille pièces par jour au total : un rendez-vous, pas un robinet. |
| 👁 **Regarder** | Toutes les parties Party se regardent sans y jouer, comme une table de blackjack. C'est là que ça compte : un Monopoly dure trois quarts d'heure et ne se rejoint pas en cours de route. Le spectateur reçoit l'état construit pour un identifiant qui n'est à aucune place — les mains, les mots et les rôles ne l'atteignent jamais, et c'est le serveur qui le garantit. |
| 💾 **Rien ne se perd** | Les salons Party sont écrits dans la base toutes les quinze secondes et à l'arrêt, puis relus au démarrage. Un `git push` ne tue plus la partie de tout le monde. |
| 🎈 **Party** | Une section à part, **sans aucune pièce** : salons à code, chat, et un **rang Party** séparé qui compte les soirées jouées plutôt que la chance. Sept jeux dedans — **Undercover** (3 à 12, avec Monsieur Blanc), **Poker** Texas Hold'em en tournoi (2 à 8), **Uno** (2 à 10), **Belote** (4), **Monopoly** (2 à 6), **Loup-garou** (4 à 16) et **Blindtest** (1 à 12). |
| 🂡 **Belote** | À quatre, en deux équipes face à face. L'**ordre des cartes change à l'atout** (Valet, 9, As, 10, Roi, Dame, 8, 7 — contre As, 10, Roi, Dame, Valet ailleurs), les deux tours d'enchère avec la retourne, et toutes les obligations : **fournir**, **couper**, **surcouper**, **monter à l'atout** — avec la seule exception qui compte, on ne coupe pas le pli de son partenaire. **Belote-rebelote** annoncée automatiquement par le serveur (l'oublier coûte 20 points et personne n'a envie de perdre là-dessus), **dix de der**, **capot** à 252, et le contrat : le preneur doit faire **82 sur 162**, sinon il est dedans et l'adversaire ramasse tout. Le serveur calcule les coups légaux et **explique** chaque refus — « il faut fournir à cœur », « à l'atout il faut monter ». |
| 🎲 **Monopoly** | Le plateau français : boulevard de Belleville d'un bout, rue de la Paix de l'autre. **Toutes** les règles — loyer doublé sur un groupe complet, maisons et hôtels bâtis **uniformément**, stock fini de la banque (32 maisons, 12 hôtels), gares à 25/50/100/200, services à 4× ou 10× les dés, prison avec ses trois sorties, Chance et Caisse commune, hypothèques à 50 % et rachat à 110 %, **échanges entre joueurs**, faillites au profit du créancier. Une **partie courte** réglable en 30 ou 60 tours de table : au bout du compte, le plus riche gagne — sinon un Monopoly dure trois heures et finit par des abandons. Chaque refus est **expliqué** : « il te manque une case du groupe », « la banque n'a plus d'hôtel ». |
| 🎴 **Uno** | Les 108 cartes, avec les règles qu'on oublie toujours : **un seul 0 par couleur** (donc deux fois plus rare qu'un 7), les **+2 qui se cumulent** (réglable par l'hôte), le **+4 contestable** — le serveur sait si tu bluffais, et c'est le menteur qui ramasse — et les **2 cartes de pénalité** pour qui oublie d'annoncer, à condition qu'un adversaire le remarque dans les quatre secondes. Un tour trop long ou un joueur déconnecté ne bloque jamais la table : le serveur pioche et passe. |
| 🐺 **Loup-garou** | Les rôles, les nuits, les votes : loup, villageois, **voyante**, **sorcière** (une potion de vie, une de mort, une seule fois chacune) et **chasseur**, qui emporte quelqu'un avec lui en mourant. La composition s'adapte au nombre de joueurs — environ un loup pour quatre, jamais plus d'un tiers, et toujours deux villageois simples. Le débat se fait de vive voix sur Discord : le site ne fait que compter, garder les rôles secrets et rythmer les phases. |
| 🎵 **Blindtest** | L'idée d'origine du site. Tu colles l'adresse d'une **playlist YouTube à toi**, le site en lit les morceaux — sans clé d'API — et lance des extraits. **Quatre propositions** (six en difficile), toutes tirées de ta propre playlist, ce qui interdit de deviner sans écouter. Trois niveaux : facile (30 s, l'artiste soufflé au bout de dix secondes), moyen (20 s), difficile (12 s, six choix et **des leurres du même artiste**). **La musique ne s'arrête pas** quand quelqu'un trouve : les autres cherchent encore. Plus tu réponds vite, plus tu marques ; le premier touche un bonus. Podium avec les têtes Discord à la fin. |
| 🌙 **Soirée** | Deux à six jeux **à la suite**, avec un seul classement. À la fin de chaque partie, tout le monde bascule automatiquement dans le salon du jeu suivant — personne ne cherche un code. Barème resserré (10 / 6 / 4 / 3 / 2, et **un point pour tous les autres**) : gagner une manche aide, être dernier partout ne met pas hors course, et on reste jusqu'au bout. Chaque jeu ne fournit qu'une chose à la soirée — l'ordre d'arrivée —, donc un nouveau jeu s'y branche sans rien changer. |
| 🏅 **Palmarès** | Le tableau d'honneur entre potes : qui gagne le plus souvent, à quoi, et depuis quand. À partir de trois parties jouées, pour qu'une victoire unique ne fasse pas un champion. |
| 👤 **Mon profil** | Une page par joueur : niveau, rang Party, collection, médailles, parures, et l'historique de ce qui a été joué. |
| 😂 **Réactions** | Six emojis, un clic, et ça s'affiche deux secondes au-dessus de ton siège. Parce que personne ne tape « ahah » au moment où il se prend un +4. Cadence limitée côté serveur. |
| 📣 **Bandeau d'invitation** | « Léa vient d'ouvrir une table de belote » s'affiche partout sur le site, pas seulement dans le hall Party. À quatre connectés, c'est ce détail qui fait la soirée. |
| 📊 **Économie** | Un tableau dans le panel admin : ce qui est créé, ce qui est détruit, par source et par jour, sur trente jours glissants. On voit d'un coup d'œil si le site inflate. |
| 📤 **Export** | Un bouton qui télécharge **toute la base en JSON** — profils, marché, saison, journal. Réservé aux administrateurs, avec l'état vidé sur disque avant l'export. |
| 🚧 **Porte d'ouverture** | Tant que le site n'a pas ouvert, **toute** adresse renvoie un compte à rebours — pas de page qui fuit parce qu'on connaît son URL, et les websockets sont fermés aussi. L'ouverture se fait **toute seule à la date prévue** (2 septembre 2026, midi, heure de Paris) ; le panel admin permet d'ouvrir plus tôt, de refermer, ou de changer la date. Un « accès équipe » discret sur la page d'attente et sur l'écran de connexion accepte la clé `ADMIN_KEY` et donne un laissez-passer de douze heures. |
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

### « J'ai poussé, mais je vois encore l'ancienne version »

Ça n'arrivera pas, et voici pourquoi — c'est le genre de panne qui fait
perdre une soirée entière à chercher un bug qui n'existe pas.

Le navigateur garde les feuilles de style et les scripts en mémoire pour ne
pas les retélécharger à chaque page. Le problème, c'est que l'adresse ne
change jamais&nbsp;: c'est toujours `/css/style.css`. Après une mise à jour,
le navigateur sert donc le **nouveau HTML avec l'ancien CSS** — la page
s'affiche à moitié, avec les mauvaises couleurs, et on croit avoir raté son
déploiement.

`server/assets.js` calcule au démarrage une empreinte du contenu de tous les
CSS et JS, et la colle dans les adresses&nbsp;:

```html
<link rel="stylesheet" href="/css/style.css?v=8df1601986">
```

Le contenu change → l'empreinte change → l'adresse change → le navigateur
retélécharge, tout seul. Tant que rien ne bouge, il garde sa copie trente
jours. Le HTML, lui, n'est jamais mis en cache, puisque c'est lui qui porte
les empreintes.

Si tu vois quand même une page à moitié à jour, c'est le cache de Render ou
de Cloudflare&nbsp;: un **Ctrl + Maj + R** tranche la question en deux
secondes.

> ⚠️ **Sans base de données, chaque mise à jour efface la progression.**
> Le fichier `data/profiles.json` vit sur le disque temporaire de Render, qui
> est jeté à chaque redéploiement. Branche PostgreSQL (section
> *Garder la progression pour de bon*) **avant** de commencer à jouer
> sérieusement — c'est l'étape à ne pas sauter.

---

## La direction artistique

Quatre règles, et elles expliquent la plupart des choix du CSS.

**1. Une seule couleur d'accent.** Un champagne discret (`--gold`). Le vert ne
sert plus qu'aux gains, le rouge qu'aux pertes. Avant, six couleurs vives se
disputaient l'attention et aucune n'en obtenait.

**2. La hiérarchie vient de la typo et du vide.** Une échelle de tailles
(`--t-xs` à `--t-4xl`), un rythme d'espacement en multiples de 4 (`--s-1` à
`--s-8`), et des graisses contrastées. Plus rien n'est en majuscules par
défaut : quand tout est important, rien ne l'est.

**3. Des traits fins, pas des lueurs.** Bordures à 6 % de blanc, ombres
presque invisibles. Les halos néon font « template gratuit ».

**4. Des icônes dessinées, pas des emojis.** Un jeu de symboles SVG sur une
grille de 24 px, défini une fois en haut de `index.html` et réutilisé par
`<use href="#i-...">`. Les emojis restent uniquement sur les **objets du jeu**
— les 518 memes, les caisses — là où ils sont le sujet. Le signe monétaire de
l'interface est `¤`, qui a la même graisse et la même hauteur que les
chiffres, contrairement à 🪙 qui changeait de dessin d'un appareil à l'autre.

L'accueil suit cette logique en trois blocs : **où j'en suis** (solde,
rakeback, caisse offerte), **à quoi je joue** (tous les jeux visibles d'un
coup, plus de carrousel qui n'en montrait qu'un), **avec qui** (tables et
chat). Les onze entrées de menu sont retombées à quatre ; le reste vit dans
le menu du compte.

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
npm run test:bj        # les cinq places, les spectateurs, l'exclusion, le départ immédiat
npm run test:uno       # 60 parties d'Uno simulées : aucune carte créée ni perdue
npm run test:belote    # 40 parties de belote : 32 cartes et 162 points, à chaque donne
npm run test:monopoly  # 40 parties de Monopoly : le stock de la banque, les constructions
npm run test:persist   # tue le serveur en pleine partie et vérifie qu'elle repart
npm run test:loup      # 60 parties de Loup-garou : aucun rôle ne fuite jamais
npm run test:blindtest # 30 blindtests : la réponse ne quitte jamais le serveur
npm run test:soiree    # le barème, le cumul, et la survie au redéploiement
npm run test:soiree-live # trois clients enchaînent trois jeux pour de vrai
npm run test:slots     # les règles de la machine à sous, puis sa redistribution
npm run test:objectif  # le classement du mois compte bien l'XP, et rien d'autre
npm run test:ui-chat   # le chat colle en bas, et les paliers n'ont plus de nom
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

`npm run test:bj` ouvre une table avec trois clients : il vérifie qu'il y a
bien cinq places et pas six, qu'un spectateur reçoit l'état de la table sans
en occuper une et sans pouvoir miser, que la donne part en moins de deux
secondes quand tout le monde a misé au lieu d'attendre le chrono, et qu'on ne
peut pas retirer de la table quelqu'un dont les jetons sont sur le tapis.

`npm run test:uno` ne demande pas de serveur non plus. Il fait jouer des
joueurs au hasard et vérifie **après chaque coup** qu'il y a toujours
exactement 108 cartes, chacune une seule fois — dans les mains, la pioche et
la défausse réunies. C'est l'invariant qui compte : dans un jeu de cartes,
les bugs qui font mal ne sont pas « le +2 ne fait pas piocher », ce sont les
fuites — une carte défaussée deux fois, une main qui garde une carte déjà
posée. Elles ne se voient pas en jouant, la partie continue simplement un
peu faussée.

`npm run test:belote` fait la même chose pour la belote, avec **deux**
invariants. Les 32 cartes d'abord — mains, pli en cours, plis ramassés, la
retourne. Et surtout : **chaque donne distribue exactement 162 points**, pas
161, pas 163 (sauf capot, 252 d'un seul côté). Le banc d'essai recalcule le
décompte par un autre chemin que le moteur et compare : si les deux tombent
d'accord sur cent trente donnes, le comptage est juste. Il tente aussi
volontairement des coups interdits — plus de cinq cents par exécution — et
exige qu'ils soient refusés **avec une explication**, parce qu'un moteur de
belote qui accepte tout est un jeu de bataille.

`npm run test:monopoly` joue quarante parties entières au hasard — plus de
vingt mille actions — et vérifie **après chacune** quatre choses. Que le stock
de la banque est intact : 32 maisons et 12 hôtels, posés plus en réserve,
toujours (un hôtel qui « oublie » de rendre ses quatre maisons casse la
pénurie, qui est une des mécaniques les plus fines du jeu). Qu'aucun compte
n'est négatif — c'est la traduction de « on ne peut pas devoir de l'argent et
continuer à jouer ». Qu'aucune case n'appartient à un joueur en faillite.
Et que rien n'est bâti illégalement : hors d'un monopole, sur un groupe
hypothéqué, ou avec plus d'une maison d'écart dans un groupe. Il vérifie en
plus, à part, que les **barèmes recopiés à la main** sont cohérents :
l'hypothèque vaut la moitié du prix sur les 28 cases, et les 22 barèmes de
loyer montent bien à chaque construction. Une faute de frappe là-dedans ne se
verrait jamais en jouant.

`npm run test:persist` est le seul test du dépôt qui **redémarre un serveur
en cours de route**. Il ouvre une partie de Monopoly à trois, joue une
dizaine de tours, envoie un `SIGTERM` au serveur — exactement ce que fait
l'hébergeur à chaque déploiement —, le relance, et vérifie que le code du
salon, les positions des pions, l'argent, les propriétés et le tour en cours
sont intacts, puis que la partie repart. Il vérifie aussi que le serveur
**meurt vraiment** : sans ça le test croirait avoir redémarré alors que la
partie n'a jamais quitté la mémoire, ce qui serait le plus trompeur des
tests verts.

`npm run test:loup` et `npm run test:blindtest` vérifient tous les deux la
même chose, la seule qui compte dans ces deux jeux : **le secret**. Un
Loup-garou où l'on peut lire le rôle de son voisin en ouvrant la console du
navigateur n'est pas un Loup-garou, et un blindtest où la réponse arrive avec
la question n'est pas un blindtest. Les deux bancs d'essai construisent donc
l'état de **chaque** joueur à **chaque** action et relisent tout ce qui part —
sauf, évidemment, les endroits où l'information a le droit d'être : les
propositions du blindtest contiennent forcément le bon titre, un loup connaît
forcément les autres loups. Le blindtest y ajoute une vérification bête et
utile : la bonne réponse est **toujours** dans les propositions.

`npm run test:soiree` ne joue à rien — la soirée ne joue à rien, elle compte.
Il vérifie le barème (les ex æquo, la queue de classement, personne
d'oublié), le cumul manche après manche, le fait qu'une manche ne puisse
**jamais** être comptée deux fois même après un redémarrage, et la traduction
de chaque jeu vers un classement : les points à l'Uno, les jetons au poker, la
fortune au Monopoly, les deux coéquipiers au même rang à la belote, le camp
gagnant au Loup-garou. `npm run test:soiree-live` fait le reste, avec trois
vrais navigateurs branchés sur le vrai serveur : est-ce que tout le monde
bascule bien d'un jeu à l'autre tout seul ? C'est le cœur de la soirée — si
l'enchaînement rate, trois personnes restent plantées sur un écran de fin
pendant que la quatrième cherche le code du salon suivant.

`npm run test:slots` vérifie d'abord les RÈGLES de la machine — là où une
erreur se voit à l'écran : la porte d'écurie ne tombe que sur les rouleaux 2,
3 et 4, le fer à cheval que sur les 1, 3 et 5, deux multiplicateurs sur la
même ligne s'**additionnent** (×2 et ×3 font ×5, pas ×6), une porte hors de
la combinaison ne multiplie rien, trois fers empilés sur deux rouleaux ne
déclenchent **pas** le bonus, et une porte collée ne bouge plus d'un tour à
l'autre.

Puis les CHIFFRES, et c'est là que la méthode compte. Cette machine tire
78 % de sa redistribution du bonus, qui tombe une fois sur quatre-vingt-douze.
Mesurée « en jouant », sur deux cent mille tours ordinaires, elle a donné
88 %, 95 % et 103 % selon la graine — trois chiffres également faux. On mesure
donc les deux moitiés séparément : le jeu de base sur beaucoup de tours
ordinaires (où la moyenne converge vite), et le bonus **en jouant des bonus**,
des dizaines de milliers, plutôt qu'en attendant qu'ils tombent. La
redistribution est la somme des deux, et c'est cette méthode-là que le
serveur utilise pour afficher son chiffre au démarrage.

`npm run test:objectif` garde le but du site. Le classement du mois décide
d'un vrai lot, donc il vaut mieux qu'il compte ce qu'on croit qu'il compte —
et rien d'autre. Il vérifie les quatre façons de gagner sans jouer le jeu :
que l'XP classe et pas les pièces (le test met face à face un joueur qui a
900 000 pièces et zéro caisse ouverte, et un joueur en perte qui a tout remis
dans les caisses — c'est le second qui gagne, le premier n'est même pas
classé), que vingt parties Party gagnées ne déplacent pas d'un point le
compteur du mois, qu'une correction d'administrateur ne fait pas gagner, et
qu'au changement de mois le vainqueur désigné est bien celui qui avait le
plus d'XP.

`npm run test:ui-chat` s'occupe d'une chose qu'aucun test serveur ne peut
voir : est-ce que le chat s'ouvre sur le dernier message ? Il en envoie une
vingtaine, change de page, revient, et mesure à chaque étape la distance
entre le bas de la liste et le bas de la boîte. Il vérifie aussi l'inverse,
qui compte tout autant : quand on est en train de relire l'historique, un
message qui arrive ne doit **pas** nous renvoyer en bas de force.

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
  slots.js       Horse House : portes à multiplicateur, tours offerts collants
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
  party/uno.js        les 108 cartes, les +2 cumulés, le +4 contestable
  party/belote.js     l'atout, les obligations, les annonces, le décompte
  party/monopoly.js   le plateau, les loyers, les enchères, les faillites
  party/board.js      les 40 cases françaises et les cartes Chance
  party/loup.js       les rôles, les nuits, les votes
  party/blindtest.js  la playlist, les extraits, les propositions
  party/soiree.js     plusieurs jeux à la suite, un seul classement
  ledger.js      le grand livre de l'économie (créé, détruit, par jour)
  quests.js      les trois défis du jour, tirés de la date
public/
  index.html     la coquille
  css/style.css  toute la direction artistique
  js/            app, lobby, chat, mine, plinko, roulette, blackjack,
                 slots, medals, vault, market, party, undercover, poker,
                 uno, belote, monopoly, loup, blindtest, profile,
                 admin, sfx
test/
  harness.js     banc d'essai Socket.IO du casino
  party.js       banc d'essai de la section Party
  poker-sim.js   60 tournois simulés, sans réseau
  ui.js          parcours navigateur du casino
  ui-party.js    parcours navigateur de la Party
  economy.js     marché, rakeback, récompenses, gros cadeaux
  uno-sim.js     60 parties : les 108 cartes, toujours
  belote-sim.js  40 parties : 32 cartes et 162 points par donne
  monopoly-sim.js 40 parties : le stock de la banque, les constructions
  loup-sim.js    60 parties : aucun rôle ne fuite, et la reprise après arrêt
  blindtest-sim.js 30 parties : la réponse ne quitte jamais le serveur
  soiree-sim.js  le barème, le cumul, la survie au redéploiement
  soiree-live.js trois clients enchaînent trois jeux pour de vrai
  party-persist.js tue le serveur en pleine partie et vérifie qu'elle repart
  shots-soiree.js  les captures de la soirée
```

Aucune étape de compilation : ce que tu lis dans `public/` est exactement
ce que le navigateur exécute. Tu peux modifier, recharger, voir le résultat.


---

## La direction artistique

Le CSS est en trois couches, et l'ordre compte :

| Fichier | Rôle |
|---|---|
| `public/css/tokens.css` | **Le socle.** Il ne dessine rien : il énonce les règles. Palette, fontes, élévations, rayons, échelle typographique, durées. Rien d'autre n'a le droit d'écrire une couleur en dur. |
| `public/css/style.css` | Les composants. Il commence par une **passerelle** qui rebranche les anciens noms de jetons (`--gold`, `--panel`, `--muted`…) sur le socle. |
| `public/fonts/` | Les trois fontes, auto-hébergées (156 Ko). Aucun appel à Google. |

### Les cinq règles

1. **Le chrome est gris.** Barre du haut, panneaux, tableaux, formulaires : encre désaturée. Neuf dixièmes de l'écran ne contiennent aucune couleur.
2. **La couleur appartient aux jeux.** Le blackjack est jade, la roulette vermillon, le plinko cyan, la machine à sous magenta, les caisses améthyste, la mine ambre, le marché bleu, Party lime. On pose `data-game="plinko"` sur un élément et lui **et toute sa descendance** — boutons compris — passent au cyan. Conséquence : l'accueil n'est pas violet, il est noir avec des objets colorés dessus.
3. **Le rayon dit la nature.** Objet à regarder 18 px, panneau d'information 12 px, bouton 9 px, ligne de tableau 0. Le cercle est réservé aux avatars. Il n'y a pas de bouton en gélule.
4. **La profondeur se mérite.** Trois niveaux : à plat (les données), creusé (les panneaux : un filet clair en haut, aucune ombre portée), soulevé (ce qui recouvre vraiment). Une ombre colorée n'existe que pour le jeu en cours et emprunte *sa* couleur.
5. **Les boutons principaux sont des touches.** Aplat plein, filet clair en haut, tranche de 3 px en bas qui s'écrase à l'appui. Pas de dégradé, pas de lueur. Un seul bouton primaire par écran.

### Les trois fontes

**Unbounded** parle pour la marque (nom du site, titres, noms de jeux — jamais une phrase entière).
**Instrument Sans** écrit l'interface et se tait.
**Azeret Mono** porte l'argent et les codes : une somme qui change ne doit pas faire bouger ses voisines.

### Le piège à connaître

Une propriété personnalisée qui en cite une autre est résolue **là où elle est déclarée**. Écrire `--gold: var(--accent)` dans `:root` fige `--gold` sur la valeur racine, et les couleurs de jeux ne descendent jamais jusqu'aux boutons. C'est pour ça que `tokens.css` redéclare les alias dans un bloc `[data-game]` placé **après** les règles par jeu.
