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
| ⛏️ **La Mine** | Le robinet à pièces. Un clicker avec cinq améliorations, des coups critiques, et un revenu passif qui tourne même quand tu n'es pas là (jusqu'à 8 h rattrapées). |
| 🃏 **Blackjack** | Table à 5 sièges, 6 jeux de cartes, blackjack payé 3:2. Tu joues seul contre des bots qui appliquent la stratégie de base, ou tu envoies un code à 4 lettres à tes potes. Tirer, rester, doubler, séparer. |
| 🎡 **Roulette** | Roue européenne à 37 cases, **partagée par tout le site** : tout le monde mise sur le même tour. Cycle de 33 s. Redistribution 97,30 % sur toutes les mises. |
| 🔻 **Plinko** | 8, 12 ou 16 rangées, trois niveaux de risque. Les multiplicateurs sont calculés à partir des vraies probabilités binomiales, pas inventés à la main. |
| 📦 **Caisses à memes** | 60 memes à collectionner, six raretés du commun au maudit. Animation de rouleau horizontal façon CS:GO qui montre ce que tu aurais pu avoir. Les doublons se revendent. |
| 🏆 **Classement** | Par pièces ou par niveau, sur la page d'accueil. |
| 🛡️ **Équité vérifiable** | Chaque tirage vient d'une graine dont l'empreinte est publiée **avant** que tu mises. |
| 🛠️ **Panel admin** | Joueurs, pièces, XP, bannissements, tables ouvertes, annonces, journal des actions. |

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

Le panel admin affiche en plus la **redistribution réellement observée**
sur l'ensemble du site depuis le premier jour.

---

## Anti-triche

Le navigateur ne fait qu'afficher. Il ne calcule aucun résultat.

- Le solde, les mises, les tirages, la distribution des cartes : tout est
  côté serveur, et revérifié à chaque message.
- La mine plafonne à 20 clics par seconde, comptés par le serveur avec un
  seau à jetons. Un autoclic ne rapporte rien de plus qu'une main rapide.
- Le rouleau des caisses est envoyé **déjà tiré** : l'animation ne fait que
  rejouer un résultat décidé avant.
- Le panel admin revérifie les droits à chaque action. Masquer un bouton
  n'a jamais protégé personne.

---

## Tests

Le serveur doit tourner (`npm start`) dans un autre terminal.

```bash
npm test         # joue vraiment à tout, en Socket.IO, et vérifie l'économie
npm run test:ui  # parcours complet dans un vrai navigateur + captures d'écran
```

`npm test` vérifie entre autres que le RTP observé du Plinko sur 600 billes
colle à celui annoncé, que la graine révélée correspond bien à l'empreinte
publiée avant, et qu'aucune mise négative ou supérieure au solde ne passe.

`npm run test:ui` vérifie notamment que l'aiguille du rouleau s'arrête bien
sur l'objet gagné, que la collection affiche les 60 memes avec les manquants
grisés, et qu'aucun nom n'est tronqué.

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
  blackjack.js   tables, sabot, bots
  vault.js       caisses, rouleau, collection
  store.js       profils (fichier JSON ou PostgreSQL)
  auth.js        Discord OAuth2 + invités
  presence.js    qui est en ligne
  admin.js       panel d'administration
  data/memes.js  les 60 memes et les 4 caisses
public/
  index.html     la coquille
  css/style.css  toute la direction artistique
  js/            app, mine, plinko, roulette, blackjack, vault, admin, sfx
test/
  harness.js     banc d'essai Socket.IO
  ui.js          parcours navigateur
```

Aucune étape de compilation : ce que tu lis dans `public/` est exactement
ce que le navigateur exécute. Tu peux modifier, recharger, voir le résultat.
