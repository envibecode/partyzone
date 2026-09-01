'use strict';
/**
 * LA COLLECTION — 500 morceaux de culture internet.
 *
 * Les entrées sont rangées par rareté plutôt que d'écrire la rareté sur
 * chaque ligne : ça rend les comptes vérifiables d'un coup d'œil, et le
 * fichier reste lisible.
 *
 * Format d'une entrée : [emoji, nom, catégorie]
 * L'identifiant est dérivé du nom au chargement, et le module refuse de
 * démarrer si deux entrées se retrouvent avec le même.
 *
 * Les catégories servent aux filtres et aux caisses thématiques :
 *   meme · gaming · écran (ciné/séries) · son · web · france · bestiaire · bouffe
 */

/* ─── COMMUN (150) ─────────────────────────────────────── */

const COMMON = [
  ['🐕', 'Doge', 'meme'], ['😈', 'Troll Face', 'meme'], ['🐱', 'LOLcat', 'meme'],
  ['🎵', 'Rickroll', 'meme'], ['🐸', 'Pepe Triste', 'meme'], ['🤦', 'Facepalm', 'meme'],
  ['📈', 'Stonks', 'meme'], ['📉', 'Not Stonks', 'meme'], ['😐', 'Wojak', 'meme'],
  ['💀', 'Bruh Moment', 'meme'], ['🤖', 'NPC', 'meme'], ['😬', 'Cringe', 'meme'],
  ['➗', 'Ratio', 'meme'], ['💊', 'Copium', 'meme'], ['😞', 'Sadge', 'meme'],
  ['🍿', 'Popcorn Guy', 'meme'], ['🚀', 'Yeet', 'meme'], ['🔴', 'Sus', 'meme'],
  ['🔥', 'This Is Fine', 'meme'], ['🧠', 'Big Brain', 'meme'], ['👀', 'Distracted BF', 'meme'],
  ['👉', 'Drake Approves', 'meme'], ['⚪', 'Two Buttons', 'meme'], ['✅', 'Vibe Check', 'meme'],
  ['🐶', 'Cheems', 'meme'], ['🔨', 'Bonk', 'meme'], ['🗿', 'Moai', 'meme'],
  ['⚰️', 'Coffin Dance', 'meme'], ['🦅', 'Sheesh', 'meme'], ['🌱', 'Touch Grass', 'meme'],
  ['🍟', 'Deep Fried', 'meme'], ['🌌', 'Galaxy Brain', 'meme'], ['🌈', 'Nyan Cat', 'meme'],
  ['🚽', 'Skibidi', 'meme'], ['🟨', 'Backrooms', 'meme'], ['🤪', 'Goofy Ahh', 'meme'],
  ['🍵', 'Kermit Tea', 'meme'], ['📊', 'Bell Curve', 'meme'], ['😵', 'Trollge', 'meme'],
  ['⚡', 'Surprised Pikachu', 'meme'], ['💪', 'Gigachad', 'meme'], ['😤', 'Rage Comic', 'meme'],
  ['❓', 'Y U No', 'meme'], ['😏', 'Me Gusta', 'meme'], ['😢', 'Forever Alone', 'meme'],
  ['🙂', 'Okay Guy', 'meme'], ['👶', 'Success Kid', 'meme'], ['🍀', 'Bad Luck Brian', 'meme'],
  ['🧢', 'Scumbag Steve', 'meme'], ['📞', 'Overly Attached', 'meme'], ['🥲', 'Hide the Pain', 'meme'],
  ['🤔', 'Roll Safe', 'meme'], ['🧽', 'Mocking Spongebob', 'meme'], ['😾', 'Woman Yelling at Cat', 'meme'],
  ['🪧', 'Change My Mind', 'meme'], ['🦋', 'Is This a Pigeon', 'meme'], ['🗯️', 'Expanding Brain', 'meme'],
  ['🎰', 'First World Problems', 'meme'], ['🦖', 'Philosoraptor', 'meme'], ['🐻', 'Confession Bear', 'meme'],
  ['🐧', 'Socially Awkward Penguin', 'meme'], ['😾', 'Grumpy Cat', 'meme'], ['🎹', 'Keyboard Cat', 'meme'],
  ['🕺', 'Harlem Shake', 'meme'], ['🧊', 'Ice Bucket', 'meme'], ['👗', 'La Robe', 'meme'],
  ['🎺', 'Doot', 'meme'], ['🥁', 'Rimshot', 'meme'], ['📢', 'Air Horn', 'meme'],

  ['⌨️', 'Ctrl + C', 'web'], ['📋', 'Ctrl + V', 'web'], ['🚫', 'Erreur 404', 'web'],
  ['⏳', 'Chargement', 'web'], ['⭕', 'Buffering', 'web'], ['🤳', 'Captcha', 'web'],
  ['🍪', 'Cookies', 'web'], ['🪟', 'Popup', 'web'], ['📨', 'Spam', 'web'],
  ['🔑', 'Mot de Passe Oublié', 'web'], ['📶', 'Wifi Faible', 'web'], ['🪫', 'Batterie 1 %', 'web'],
  ['🟦', 'Écran Bleu', 'web'], ['💾', 'Disquette', 'web'], ['💿', 'CD-ROM', 'web'],
  ['☎️', 'Modem 56k', 'web'], ['🔌', 'Clé USB', 'web'], ['🖱️', 'Souris à Boule', 'web'],
  ['🪟', 'Windows XP', 'web'], ['🖌️', 'Paint', 'web'], ['💬', 'MSN Messenger', 'web'],
  ['📎', 'Trombone Clippy', 'web'], ['🔤', 'Comic Sans', 'web'], ['🌀', 'WordArt', 'web'],
  ['📜', 'Lorem Ipsum', 'web'], ['🔃', 'Roue de la Mort', 'web'], ['🔄', 'Mise à Jour', 'web'],
  ['📄', 'Conditions Générales', 'web'], ['🔕', 'Notification Ignorée', 'web'], ['🗑️', 'Corbeille', 'web'],

  ['🟫', 'Bloc de Terre', 'gaming'], ['🟩', 'Creeper', 'gaming'], ['⛏️', 'Pioche en Bois', 'gaming'],
  ['❤️', 'Cœur de Pixel', 'gaming'], ['🕹️', 'Game Over', 'gaming'], ['🪙', 'Insert Coin', 'gaming'],
  ['🎮', 'Manette', 'gaming'], ['🐌', 'Lag', 'gaming'], ['🆕', 'Noob', 'gaming'],
  ['🏕️', 'Camper', 'gaming'], ['🤝', 'GG', 'gaming'], ['💤', 'AFK', 'gaming'],
  ['♻️', 'Respawn', 'gaming'], ['🎁', 'Loot Box', 'gaming'], ['🎟️', 'Battle Pass', 'gaming'],
  ['💦', 'Sweat', 'gaming'], ['😤', 'Tryhard', 'gaming'], ['🔫', 'Headshot', 'gaming'],
  ['🛡️', 'Tank', 'gaming'], ['🧪', 'Potion', 'gaming'], ['🗺️', 'Carte au Trésor', 'gaming'],
  ['💰', 'Coffre', 'gaming'], ['🪦', 'Wasted', 'gaming'], ['🚪', 'Portail', 'gaming'],

  ['🎬', 'Générique', 'écran'], ['🍿', 'Séance de 20 h', 'écran'], ['📺', 'Neige TV', 'écran'],
  ['🎞️', 'Bande Annonce', 'écran'], ['🔚', 'Fin', 'écran'], ['⏭️', 'Passer l’Intro', 'écran'],
  ['🛋️', 'Binge Watching', 'écran'], ['🤫', 'Spoiler', 'écran'],

  ['🎧', 'Casque', 'son'], ['🎤', 'Micro Ouvert', 'son'], ['📻', 'Radio', 'son'],
  ['🔇', 'Mute', 'son'], ['🔊', 'Volume 100', 'son'], ['🎚️', 'Table de Mix', 'son'],

  ['🥖', 'Baguette', 'france'], ['🧀', 'Plateau de Fromage', 'france'], ['🍷', 'Ballon de Rouge', 'france'],
  ['🚬', 'Terrasse', 'france'], ['🥐', 'Croissant', 'france'], ['🏳️', 'Grève', 'france'],
  ['🚇', 'Métro Bondé', 'france'], ['☔', 'Météo Bretonne', 'france'], ['🐓', 'Coq', 'france'],
  ['🧑‍🍳', 'Ratatouille', 'france'],

  ['🐈', 'Chat qui Juge', 'bestiaire'], ['🦆', 'Canard en Plastique', 'bestiaire'],
  ['🐢', 'Tortue Pressée', 'bestiaire'], ['🦥', 'Paresseux', 'bestiaire'],
  ['🐹', 'Hamster', 'bestiaire'], ['🦔', 'Hérisson', 'bestiaire'],
  ['🐟', 'Poisson Rouge', 'bestiaire'], ['🦦', 'Loutre', 'bestiaire'],

  ['🍕', 'Part de Pizza', 'bouffe'], ['🌮', 'Taco', 'bouffe'], ['🍜', 'Nouilles Instantanées', 'bouffe'],
  ['🥤', 'Soda Tiède', 'bouffe'], ['🍫', 'Carré de Chocolat', 'bouffe'], ['🥪', 'Sandwich Triangle', 'bouffe'],
  ['🍩', 'Donut', 'bouffe'], ['☕', 'Café de 3 h', 'bouffe'],
];

/* ─── RARE (120) ───────────────────────────────────────── */

const RARE = [
  ['🌟', 'Nyan Prismatique', 'meme'], ['🧅', 'Shrek Onion', 'meme'], ['🗣️', 'Chad', 'meme'],
  ['💇', 'Karen', 'meme'], ['🐕‍🦺', 'Cheems Balltze', 'meme'], ['🧸', 'Fumo', 'meme'],
  ['🎧', 'Cat Jam', 'meme'], ['🤡', 'Clown Makeup', 'meme'], ['🕷️', 'Spider-Man Pointing', 'meme'],
  ['😹', 'Crying Cat', 'meme'], ['🫡', 'Salute', 'meme'], ['🗞️', 'Breaking News', 'meme'],
  ['🧍', 'Standing Guy', 'meme'], ['🪤', 'Bait', 'meme'], ['📌', 'Épinglé', 'meme'],
  ['🥴', 'Drunk Post', 'meme'], ['🫠', 'Melting', 'meme'], ['🙃', 'Upside Down', 'meme'],
  ['🧿', 'Mauvais Œil', 'meme'], ['🪞', 'Miroir Cassé', 'meme'], ['🎭', 'Double Face', 'meme'],
  ['🫥', 'Ghosté', 'meme'], ['🔮', 'Prédiction Ratée', 'meme'], ['🧊', 'Cold Take', 'meme'],
  ['🌶️', 'Hot Take', 'meme'], ['🪃', 'Boomerang', 'meme'], ['🧲', 'Aimant à Drama', 'meme'],
  ['🎣', 'Ragebait', 'meme'], ['📉', 'Chute Libre', 'meme'], ['🪜', 'Skill Issue', 'meme'],

  ['🧱', 'Mur de Briques', 'gaming'], ['🐷', 'Cochon Minecraft', 'gaming'],
  ['💎', 'Diamant', 'gaming'], ['🧨', 'TNT', 'gaming'], ['🏹', 'Arc Enchanté', 'gaming'],
  ['🐺', 'Loup Apprivoisé', 'gaming'], ['🔷', 'Portail Nether', 'gaming'],
  ['👾', 'Space Invader', 'gaming'], ['🍄', 'Champignon 1-Up', 'gaming'],
  ['🐢', 'Carapace Verte', 'gaming'], ['🍌', 'Peau de Banane', 'gaming'], ['🏁', 'Dernier Tour', 'gaming'],
  ['🧊', 'Fortnite Ice', 'gaming'], ['🪂', 'Bus de Combat', 'gaming'], ['🏗️', 'Build Battle', 'gaming'],
  ['🔪', 'Couteau Papillon', 'gaming'], ['💣', 'Bombe Posée', 'gaming'], ['🎯', 'Flick', 'gaming'],
  ['🧙', 'Support Diff', 'gaming'], ['🐉', 'Baron Nashor', 'gaming'], ['⚔️', 'Duel', 'gaming'],
  ['🏆', 'Victoire Royale', 'gaming'], ['📦', 'Caisse d’Approvisionnement', 'gaming'],
  ['🕶️', 'Deal With It', 'gaming'], ['🎲', 'RNG', 'gaming'], ['🩹', 'Nerf', 'gaming'],
  ['📈', 'Buff', 'gaming'], ['🧑‍💻', 'Patch Notes', 'gaming'], ['🚧', 'Serveur en Maintenance', 'gaming'],
  ['🥇', 'Premier Sang', 'gaming'],

  ['🕴️', 'Agent en Noir', 'écran'], ['💊', 'Pilule Rouge', 'écran'], ['🦖', 'Parc à Dinos', 'écran'],
  ['🛸', 'Soucoupe', 'écran'], ['🧛', 'Vampire de Série', 'écran'], ['👑', 'Trône de Fer', 'écran'],
  ['🚲', 'Vélo Volant', 'écran'], ['🎩', 'Chapeau Melon', 'écran'], ['🔦', 'Torche dans le Noir', 'écran'],
  ['🚔', 'Poursuite', 'écran'], ['🧟', 'Horde', 'écran'], ['🪐', 'Space Opera', 'écran'],
  ['🥋', 'Combat Chorégraphié', 'écran'], ['🎪', 'Cirque', 'écran'], ['📽️', 'Projectionniste', 'écran'],

  ['🎸', 'Riff', 'son'], ['🥁', 'Drop', 'son'], ['🎷', 'Sax Solo', 'son'],
  ['🎻', 'Violon Triste', 'son'], ['🪘', 'Boucle Infinie', 'son'], ['📼', 'Cassette', 'son'],
  ['🎼', 'Partition', 'son'], ['🔁', 'Repeat One', 'son'], ['🎙️', 'Podcast', 'son'],
  ['🪗', 'Accordéon', 'son'],

  ['🖥️', 'Tour de PC', 'web'], ['🧑‍💻', 'Terminal Vert', 'web'], ['🐍', 'Serpent Nokia', 'web'],
  ['📟', 'Pager', 'web'], ['🛰️', 'Ping 999', 'web'], ['🧯', 'Rollback', 'web'],
  ['🪛', 'Bidouille', 'web'], ['🧵', 'Thread Interminable', 'web'], ['🔗', 'Lien Mort', 'web'],
  ['📡', 'Serveur Distant', 'web'], ['🗄️', 'Base de Données', 'web'], ['🧮', 'Algorithme', 'web'],
  ['🕸️', 'Toile', 'web'], ['🔒', 'Cadenas Vert', 'web'], ['📬', 'Newsletter', 'web'],

  ['🗼', 'Tour de Fer', 'france'], ['🥁', 'Fanfare de Village', 'france'], ['⛪', 'Clocher', 'france'],
  ['🏰', 'Château de la Loire', 'france'], ['🚴', 'Maillot Jaune', 'france'],
  ['🧀', 'Fondue', 'france'], ['🍇', 'Vendanges', 'france'], ['🎿', 'Semaine au Ski', 'france'],
  ['🌊', 'Plage en Août', 'france'], ['🛵', 'Scooter en Ville', 'france'],

  ['🦊', 'Renard Malin', 'bestiaire'], ['🦉', 'Chouette de Nuit', 'bestiaire'],
  ['🐙', 'Poulpe', 'bestiaire'], ['🦩', 'Flamant', 'bestiaire'], ['🐝', 'Abeille', 'bestiaire'],
  ['🦇', 'Chauve-Souris', 'bestiaire'], ['🐡', 'Poisson-Ballon', 'bestiaire'],
  ['🦜', 'Perroquet Bavard', 'bestiaire'],

  ['🍔', 'Burger Maison', 'bouffe'], ['🍣', 'Plateau Sushi', 'bouffe'], ['🧁', 'Cupcake', 'bouffe'],
  ['🥟', 'Raviolis', 'bouffe'], ['🍦', 'Glace Italienne', 'bouffe'], ['🥞', 'Pancakes', 'bouffe'],
  ['🍿', 'Micro-Ondes', 'bouffe'],
];

/* ─── ÉPIQUE (100) ─────────────────────────────────────── */

const EPIC = [
  ['🌠', 'Nyan Cosmique', 'meme'], ['🧑‍🚀', 'Always Has Been', 'meme'],
  ['🗿', 'Moai Doré', 'meme'], ['🦾', 'Gigachad Augmenté', 'meme'],
  ['🎩', 'Monsieur Meme', 'meme'], ['🪩', 'Disco Wojak', 'meme'],
  ['👁️', 'Œil qui Voit Tout', 'meme'], ['🌀', 'Vortex de Cringe', 'meme'],
  ['🧬', 'Meme Muté', 'meme'], ['🪬', 'Talisman du Ratio', 'meme'],
  ['🎴', 'Carte Rare', 'meme'], ['🏵️', 'Rosette du Troll', 'meme'],
  ['🫧', 'Bulle Spéculative', 'meme'], ['🛎️', 'Ding du Karma', 'meme'],
  ['📿', 'Chapelet de Copium', 'meme'], ['🗳️', 'Sondage Truqué', 'meme'],
  ['🧨', 'Drama Explosif', 'meme'], ['🎢', 'Montagne Russe', 'meme'],
  ['🪫', 'Batterie Sociale Vide', 'meme'], ['🫂', 'Câlin Collectif', 'meme'],

  ['⚒️', 'Pioche en Diamant', 'gaming'], ['🐉', 'Ender Dragon', 'gaming'],
  ['🔯', 'Bloc de Commande', 'gaming'], ['🌌', 'Fin du Monde', 'gaming'],
  ['🏰', 'Raid de Guilde', 'gaming'], ['🗝️', 'Clé de Donjon', 'gaming'],
  ['👻', 'Fantôme du Speedrun', 'gaming'], ['⏱️', 'Record du Monde', 'gaming'],
  ['🧿', 'Objet Légendaire', 'gaming'], ['🥷', 'Smurf', 'gaming'],
  ['📼', 'Replay', 'gaming'], ['🎖️', 'Rang Immortel', 'gaming'],
  ['🧊', 'Freeze Frame', 'gaming'], ['🕳️', 'Hors Map', 'gaming'],
  ['🪤', 'Softlock', 'gaming'], ['🧙‍♂️', 'Boss Caché', 'gaming'],
  ['💾', 'Sauvegarde Corrompue', 'gaming'], ['🔓', 'Succès Débloqué', 'gaming'],
  ['🎛️', 'Mode Développeur', 'gaming'], ['🧊', 'Serveur Vide', 'gaming'],

  ['🎬', 'Plan Séquence', 'écran'], ['🏆', 'Palme', 'écran'],
  ['🎭', 'Twist Final', 'écran'], ['🕰️', 'Voyage Temporel', 'écran'],
  ['🌪️', 'Film Catastrophe', 'écran'], ['🦸', 'Cape au Vent', 'écran'],
  ['🔪', 'Whodunit', 'écran'], ['🚀', 'Décollage', 'écran'],
  ['🧊', 'Épisode Bouteille', 'écran'], ['🎞️', 'Director’s Cut', 'écran'],
  ['🩸', 'Saison Finale', 'écran'], ['👁️‍🗨️', 'Caméo', 'écran'],

  ['🎹', 'Solo de Synthé', 'son'], ['🔊', 'Mur du Son', 'son'],
  ['💽', 'Vinyle Collector', 'son'], ['🎺', 'Fanfare de Victoire', 'son'],
  ['🪕', 'Banjo Inattendu', 'son'], ['🎚️', 'Master Volume', 'son'],
  ['🔔', 'Sample Culte', 'son'], ['🎵', 'Earworm', 'son'],

  ['🧑‍🔬', 'Bug Reproductible', 'web'], ['🔥', 'Serveur en Feu', 'web'],
  ['🧊', 'Cache Froid', 'web'], ['🪝', 'Webhook', 'web'],
  ['🛡️', 'Pare-Feu', 'web'], ['🧰', 'Boîte à Outils', 'web'],
  ['🌐', 'Nom de Domaine', 'web'], ['📉', 'Downtime', 'web'],
  ['🧑‍✈️', 'Pilote Automatique', 'web'], ['🗜️', 'Compression', 'web'],
  ['🧾', 'Facture Cloud', 'web'], ['🔭', 'Monitoring', 'web'],

  ['🥖', 'Baguette Tradition', 'france'], ['🍾', 'Bouchon de Champagne', 'france'],
  ['🏛️', 'Panthéon', 'france'], ['🎨', 'Musée un Dimanche', 'france'],
  ['🚂', 'Train de Nuit', 'france'], ['🧑‍🌾', 'Marché du Samedi', 'france'],
  ['🕯️', 'Bistrot d’Hiver', 'france'], ['🎆', 'Feu du 14', 'france'],

  ['🦁', 'Lion Majestueux', 'bestiaire'], ['🐋', 'Baleine', 'bestiaire'],
  ['🦅', 'Aigle Royal', 'bestiaire'], ['🐆', 'Guépard', 'bestiaire'],
  ['🦚', 'Paon', 'bestiaire'], ['🐎', 'Cheval au Galop', 'bestiaire'],
  ['🦌', 'Cerf', 'bestiaire'], ['🐘', 'Éléphant', 'bestiaire'],

  ['🦞', 'Homard', 'bouffe'], ['🍰', 'Pièce Montée', 'bouffe'],
  ['🥩', 'Côte de Bœuf', 'bouffe'], ['🍫', 'Chocolat Grand Cru', 'bouffe'],
  ['🫕', 'Raclette Complète', 'bouffe'], ['🍯', 'Miel Sauvage', 'bouffe'],
  ['🥂', 'Trinquer', 'bouffe'], ['🧁', 'Pâtisserie Fine', 'bouffe'],
  ['🍽️', 'Étoilé', 'bouffe'], ['🫖', 'Théière Fumante', 'bouffe'],
  ['🥘', 'Plat Mijoté', 'bouffe'], ['🍲', 'Soupe de Grand-Mère', 'bouffe'],
];

/* ─── LÉGENDAIRE (70) ──────────────────────────────────── */

const LEGENDARY = [
  ['🕺', 'Rick Astley', 'meme'], ['🧠', 'Sigma Grindset', 'meme'],
  ['🌊', 'Ohio Final Boss', 'meme'], ['🚽', 'Skibidi Suprême', 'meme'],
  ['🐷', 'John Pork', 'meme'], ['🥤', 'Grimace Shake', 'meme'],
  ['👑', 'Doge Doré', 'meme'], ['🎆', 'Meme du Siècle', 'meme'],
  ['🪐', 'Meme Interstellaire', 'meme'], ['🧊', 'Meme Congelé', 'meme'],
  ['🏛️', 'Meme Classique', 'meme'], ['🗽', 'Meme Monumental', 'meme'],

  ['💠', 'Netherite', 'gaming'], ['🌟', 'Étoile d’Invincibilité', 'gaming'],
  ['🗡️', 'Excalibur', 'gaming'], ['🧝', 'Set Complet', 'gaming'],
  ['🐲', 'Monture Volante', 'gaming'], ['🏅', 'Sans Faute', 'gaming'],
  ['🎯', 'Ace', 'gaming'], ['👑', 'Rang 1 Mondial', 'gaming'],
  ['🕹️', 'Borne d’Arcade', 'gaming'], ['💫', 'Combo Parfait', 'gaming'],

  ['🎬', 'Chef-d’Œuvre', 'écran'], ['🏆', 'Statuette Dorée', 'écran'],
  ['🎭', 'Réplique Culte', 'écran'], ['🚁', 'Cascade Réelle', 'écran'],
  ['🌌', 'Trilogie', 'écran'], ['🎼', 'Bande Originale', 'écran'],
  ['🦇', 'Silhouette dans la Nuit', 'écran'], ['⛵', 'Plan Final', 'écran'],

  ['🎤', 'Concert Complet', 'son'], ['💎', 'Disque de Diamant', 'son'],
  ['🎧', 'Mix Parfait', 'son'], ['🪩', 'Nuit Blanche', 'son'],
  ['🎻', 'Orchestre au Complet', 'son'], ['🔥', 'Freestyle Légendaire', 'son'],

  ['🧙‍♀️', 'Code Source', 'web'], ['🛰️', 'Uptime 100 %', 'web'],
  ['🏗️', 'Refonte Réussie', 'web'], ['🧊', 'Zero Bug', 'web'],
  ['🚀', 'Mise en Prod un Vendredi', 'web'], ['🗝️', 'Root', 'web'],
  ['📡', 'Signal Parfait', 'web'], ['🧠', 'Idée à Un Milliard', 'web'],

  ['🥇', 'Coupe du Monde', 'france'], ['🗼', 'Tour Illuminée', 'france'],
  ['🍾', 'Millésime', 'france'], ['🏰', 'Mont Sur la Mer', 'france'],
  ['🎨', 'Sourire Énigmatique', 'france'], ['🥐', 'Croissant Parfait', 'france'],

  ['🦄', 'Licorne', 'bestiaire'], ['🐉', 'Dragon', 'bestiaire'],
  ['🦢', 'Cygne Noir', 'bestiaire'], ['🦉', 'Grand-Duc', 'bestiaire'],
  ['🐅', 'Tigre Blanc', 'bestiaire'], ['🕊️', 'Colombe', 'bestiaire'],

  ['🍽️', 'Trois Étoiles', 'bouffe'], ['🥇', 'Meilleur Ouvrier', 'bouffe'],
  ['🍰', 'Gâteau de Mariage', 'bouffe'], ['🫒', 'Huile Première Presse', 'bouffe'],
  ['🧂', 'Sel de Guérande', 'bouffe'], ['🍷', 'Grand Cru Classé', 'bouffe'],

  ['🎰', 'Jackpot', 'meme'], ['💸', 'Coup du Siècle', 'meme'],
  ['🃏', 'Joker', 'gaming'], ['🎲', 'Double Six', 'gaming'],
  ['🔱', 'Trident', 'gaming'], ['🏵️', 'Médaille d’Honneur', 'gaming'],
  ['🌋', 'Éruption', 'écran'], ['🌅', 'Dernière Image', 'écran'],
];

/* ─── MYTHIQUE (40) ────────────────────────────────────── */

const MYTHIC = [
  ['🌈', 'Nyan Éternel', 'meme'], ['🗿', 'Moai Ancestral', 'meme'],
  ['👁️', 'Le Grand Ratio', 'meme'], ['🌀', 'Singularité Meme', 'meme'],
  ['🪐', 'Meme Hors du Temps', 'meme'], ['⚜️', 'Meme Royal', 'meme'],
  ['🜂', 'Meme Alchimique', 'meme'], ['🕳️', 'Trou de Ver', 'meme'],

  ['💎', 'Bloc de Bedrock', 'gaming'], ['🌠', 'Drop 0,001 %', 'gaming'],
  ['🏆', 'Trophée Platine', 'gaming'], ['⚡', 'Frame Perfect', 'gaming'],
  ['🧿', 'Artefact Interdit', 'gaming'], ['🗿', 'Easter Egg Ultime', 'gaming'],

  ['🎬', 'Film Perdu', 'écran'], ['🎞️', 'Bobine Unique', 'écran'],
  ['👁️‍🗨️', 'Scène Coupée', 'écran'], ['🌌', 'Univers Étendu', 'écran'],

  ['🎶', 'Note Parfaite', 'son'], ['💿', 'Master Original', 'son'],
  ['🔮', 'Son Mystique', 'son'], ['🎼', 'Symphonie Inachevée', 'son'],

  ['🧬', 'Code Génétique', 'web'], ['🛸', 'Signal Inconnu', 'web'],
  ['🗄️', 'Archive Perdue', 'web'], ['🔐', 'Clé Maîtresse', 'web'],

  ['👑', 'Couronne', 'france'], ['⚜️', 'Fleur de Lys', 'france'],
  ['🗝️', 'Clé du Royaume', 'france'],

  ['🐦‍🔥', 'Phénix', 'bestiaire'], ['🦕', 'Créature Oubliée', 'bestiaire'],
  ['🐙', 'Kraken', 'bestiaire'], ['🦌', 'Cerf Blanc', 'bestiaire'],

  ['🍾', 'Bouteille Centenaire', 'bouffe'], ['🍄', 'Truffe Blanche', 'bouffe'],
  ['🥚', 'Œuf d’Or', 'bouffe'],

  ['🎰', 'Sept Rouleaux', 'meme'], ['💫', 'Étoile Filante', 'meme'],
  ['🏔️', 'Sommet', 'écran'], ['🔥', 'Flamme Éternelle', 'son'],
];

/* ─── MAUDIT (20) ──────────────────────────────────────── */

const CURSED = [
  ['💀', 'Le Vide', 'meme'], ['🕯️', 'Dernière Bougie', 'meme'],
  ['🩸', 'Écran Rouge', 'meme'], ['🫥', 'Effacé', 'meme'],
  ['🪦', 'Compte Supprimé', 'web'], ['📵', 'Signal Perdu', 'web'],
  ['🧿', 'Fichier Corrompu', 'web'], ['⛓️', 'Boucle Infinie', 'web'],
  ['👁️', 'Il Regarde', 'écran'], ['🎭', 'Masque Sans Visage', 'écran'],
  ['🌑', 'Éclipse', 'écran'], ['🔇', 'Silence Absolu', 'son'],
  ['📼', 'Cassette Interdite', 'son'], ['🐍', 'Serpent Ouroboros', 'bestiaire'],
  ['🕷️', 'Toile Sans Fin', 'bestiaire'], ['🦂', 'Scorpion', 'bestiaire'],
  ['🍽️', 'Assiette Vide', 'bouffe'], ['⚱️', 'Urne', 'bouffe'],
  ['🃏', 'Carte Retournée', 'gaming'], ['🎲', 'Dé Pipé', 'gaming'],
];

/* ─── Assemblage ───────────────────────────────────────── */

const RARITIES = {
  /*
   * Les couleurs de rareté.
   *
   * Elles restent distinctes — c'est leur seul travail : reconnaître une
   * rareté d'un coup d'œil, de loin, sur une vignette de 60 pixels. Mais
   * elles sont DÉSATURÉES par rapport aux néons d'origine, pour tenir dans
   * une interface champagne sans la faire ressembler à une borne d'arcade.
   * L'ordre de chaleur suit l'ordre de rareté : gris froid pour le commun,
   * or pour le légendaire, puis deux teintes rares qu'on ne voit presque
   * jamais et qui peuvent donc se permettre d'être vives.
   */
  common:    { id: 'common',    name: 'COMMUN',     color: '#8d95a3', glow: 'rgba(141,149,163,.45)', xp: 4,    dust: 6,    weight: 5800 },
  rare:      { id: 'rare',      name: 'RARE',       color: '#6f9fc9', glow: 'rgba(111,159,201,.5)',  xp: 14,   dust: 24,   weight: 2600 },
  epic:      { id: 'epic',      name: 'ÉPIQUE',     color: '#9a86cf', glow: 'rgba(154,134,207,.55)', xp: 44,   dust: 90,   weight: 1100 },
  legendary: { id: 'legendary', name: 'LÉGENDAIRE', color: '#d4af6a', glow: 'rgba(212,175,106,.6)',  xp: 150,  dust: 340,  weight: 420  },
  mythic:    { id: 'mythic',    name: 'MYTHIQUE',   color: '#cf7f9e', glow: 'rgba(207,127,158,.65)', xp: 520,  dust: 1300, weight: 72   },
  cursed:    { id: 'cursed',    name: 'MAUDIT',     color: '#4fc4a8', glow: 'rgba(79,196,168,.7)',   xp: 1800, dust: 4800, weight: 8    },
};

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic', 'cursed'];

const CATEGORIES = {
  meme:      { id: 'meme',      name: 'Memes',            icon: '😂' },
  gaming:    { id: 'gaming',    name: 'Jeux vidéo',       icon: '🎮' },
  'écran':   { id: 'écran',     name: 'Écrans',           icon: '🎬' },
  son:       { id: 'son',       name: 'Son',              icon: '🎧' },
  web:       { id: 'web',       name: 'Vieux web',        icon: '🖥️' },
  france:    { id: 'france',    name: 'Chez nous',        icon: '🥖' },
  bestiaire: { id: 'bestiaire', name: 'Bestiaire',        icon: '🦊' },
  bouffe:    { id: 'bouffe',    name: 'À table',          icon: '🍕' },
};

/** Transforme un nom en identifiant stable : « Coup du Siècle » → coup-du-siecle. */
function slug(name) {
  return name
    .normalize('NFD')
    // Les diacritiques sont écrits en échappement Unicode : en clair,
    // ils ne survivent pas toujours à un copier-coller mal encodé.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const GROUPS = [
  ['common', COMMON], ['rare', RARE], ['epic', EPIC],
  ['legendary', LEGENDARY], ['mythic', MYTHIC], ['cursed', CURSED],
];

const ITEMS = [];
const seen = new Map();

for (const [rarity, list] of GROUPS) {
  for (const [emoji, name, category] of list) {
    let id = slug(name);
    // Deux entrées peuvent porter le même nom dans des raretés différentes
    // (« Nyan » décliné, par exemple) : on suffixe pour garder des
    // identifiants uniques, ce qui compte pour la sauvegarde des profils.
    if (seen.has(id)) id = `${id}-${rarity}`;
    if (seen.has(id)) {
      throw new Error(`[collection] identifiant en double : ${id} (${name})`);
    }
    seen.set(id, true);
    if (!CATEGORIES[category]) {
      throw new Error(`[collection] catégorie inconnue « ${category} » pour ${name}`);
    }
    ITEMS.push({ id, emoji, name, r: rarity, cat: category });
  }
}

const BY_ID = new Map(ITEMS.map((m) => [m.id, m]));

/** Combien d'objets par rareté, pour la barre de progression. */
const COUNTS = RARITY_ORDER.reduce((acc, r) => {
  acc[r] = ITEMS.filter((m) => m.r === r).length;
  return acc;
}, {});

const BY_CATEGORY = Object.keys(CATEGORIES).reduce((acc, c) => {
  acc[c] = ITEMS.filter((m) => m.cat === c).length;
  return acc;
}, {});

module.exports = {
  ITEMS, BY_ID, RARITIES, RARITY_ORDER, CATEGORIES, COUNTS, BY_CATEGORY, slug,
  TOTAL: ITEMS.length,
};
