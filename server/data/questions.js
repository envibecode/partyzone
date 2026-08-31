'use strict';
/**
 * Banque de questions « culture G » (style PopSauce) — on tape la réponse le plus vite possible.
 * Format : { c: catégorie, q: question, a: [réponses acceptées, la 1re est affichée] }
 * Les comparaisons sont tolérantes (accents, casse, articles, petites fautes de frappe).
 */

const QUESTIONS = [
  /* ── Géographie ───────────────────────────────────────── */
  { c: 'Géographie', q: "Quelle est la capitale de l'Australie ?", a: ['Canberra'] },
  { c: 'Géographie', q: 'Quel est le plus long fleuve du monde ?', a: ['Nil', 'Amazone'] },
  { c: 'Géographie', q: 'Dans quel pays se trouve le Machu Picchu ?', a: ['Pérou'] },
  { c: 'Géographie', q: 'Quel est le plus petit pays du monde par la superficie ?', a: ['Vatican', 'Saint-Siège'] },
  { c: 'Géographie', q: 'Quelle mer borde Israël à l’ouest ?', a: ['Méditerranée', 'mer Méditerranée'] },
  { c: 'Géographie', q: 'Quel désert couvre la majeure partie du nord de l’Afrique ?', a: ['Sahara'] },
  { c: 'Géographie', q: 'Quelle est la capitale du Canada ?', a: ['Ottawa'] },
  { c: 'Géographie', q: 'Quel pays compte le plus d’habitants au monde ?', a: ['Inde'] },
  { c: 'Géographie', q: 'Quelle chaîne de montagnes sépare l’Europe de l’Asie ?', a: ['Oural', 'monts Oural'] },
  { c: 'Géographie', q: 'Quel est le plus haut sommet d’Afrique ?', a: ['Kilimandjaro'] },
  { c: 'Géographie', q: 'Dans quelle ville se trouve la Sagrada Família ?', a: ['Barcelone'] },
  { c: 'Géographie', q: 'Quel océan sépare l’Europe de l’Amérique ?', a: ['Atlantique', 'océan Atlantique'] },
  { c: 'Géographie', q: 'Quelle est la capitale de la Norvège ?', a: ['Oslo'] },
  { c: 'Géographie', q: 'Quel pays a la forme d’une botte ?', a: ['Italie'] },
  { c: 'Géographie', q: 'Quel est le plus grand pays du monde par la superficie ?', a: ['Russie'] },
  { c: 'Géographie', q: 'Quelle est la monnaie du Japon ?', a: ['yen'] },
  { c: 'Géographie', q: 'Quel fleuve traverse Paris ?', a: ['Seine'] },
  { c: 'Géographie', q: 'Quelle est la plus grande île du monde ?', a: ['Groenland'] },
  { c: 'Géographie', q: 'De quel pays Reykjavik est-elle la capitale ?', a: ['Islande'] },
  { c: 'Géographie', q: 'Quel pays d’Amérique du Sud parle portugais ?', a: ['Brésil'] },

  /* ── Histoire ─────────────────────────────────────────── */
  { c: 'Histoire', q: 'En quelle année le mur de Berlin est-il tombé ?', a: ['1989'] },
  { c: 'Histoire', q: 'Qui était le premier homme à marcher sur la Lune ?', a: ['Neil Armstrong', 'Armstrong'] },
  { c: 'Histoire', q: 'Quel empereur français a été exilé à Sainte-Hélène ?', a: ['Napoléon', 'Napoléon Bonaparte'] },
  { c: 'Histoire', q: 'En quelle année a commencé la Première Guerre mondiale ?', a: ['1914'] },
  { c: 'Histoire', q: 'Quelle civilisation a construit les pyramides de Gizeh ?', a: ['Égyptiens', 'Égypte antique', 'Égyptiens de l’Antiquité'] },
  { c: 'Histoire', q: 'Quel jour de 1789 la Bastille a-t-elle été prise ? (jour et mois)', a: ['14 juillet'] },
  { c: 'Histoire', q: 'Qui a peint la chapelle Sixtine ?', a: ['Michel-Ange', 'Michelangelo'] },
  { c: 'Histoire', q: 'Quelle reine d’Égypte fut la dernière du royaume ptolémaïque ?', a: ['Cléopâtre'] },
  { c: 'Histoire', q: 'Quel navire a coulé lors de son voyage inaugural en 1912 ?', a: ['Titanic'] },
  { c: 'Histoire', q: 'Quel mouvement artistique est né en Italie au XVe siècle ?', a: ['Renaissance'] },
  { c: 'Histoire', q: 'Qui a proclamé « Je vous ai compris » en 1958 à Alger ?', a: ['de Gaulle', 'Charles de Gaulle'] },
  { c: 'Histoire', q: 'En quelle année a eu lieu le débarquement de Normandie ?', a: ['1944'] },
  { c: 'Histoire', q: 'Quel roi de France est surnommé le Roi-Soleil ?', a: ['Louis XIV', 'Louis 14'] },
  { c: 'Histoire', q: 'Quelle route commerciale reliait la Chine à l’Europe ?', a: ['route de la soie'] },
  { c: 'Histoire', q: 'Quel scientifique a formulé la théorie de la relativité ?', a: ['Einstein', 'Albert Einstein'] },

  /* ── Sciences ─────────────────────────────────────────── */
  { c: 'Sciences', q: 'Quel est le symbole chimique de l’or ?', a: ['Au'] },
  { c: 'Sciences', q: 'Combien de planètes compte le système solaire ?', a: ['8', 'huit'] },
  { c: 'Sciences', q: 'Quelle planète est la plus proche du Soleil ?', a: ['Mercure'] },
  { c: 'Sciences', q: 'Quel gaz les plantes absorbent-elles pour la photosynthèse ?', a: ['dioxyde de carbone', 'CO2', 'gaz carbonique'] },
  { c: 'Sciences', q: 'Quel est l’organe qui produit l’insuline ?', a: ['pancréas'] },
  { c: 'Sciences', q: 'Combien d’os compte le squelette humain adulte ?', a: ['206'] },
  { c: 'Sciences', q: 'Quelle est la vitesse de la lumière en km/s (arrondie) ?', a: ['300000', '299792', '300 000'] },
  { c: 'Sciences', q: 'Quel scientifique a énoncé la loi de la gravitation universelle ?', a: ['Newton', 'Isaac Newton'] },
  { c: 'Sciences', q: 'Quelle est la planète surnommée la planète rouge ?', a: ['Mars'] },
  { c: 'Sciences', q: 'Quel élément a pour symbole O ?', a: ['oxygène'] },
  { c: 'Sciences', q: 'Quel est le plus grand organe du corps humain ?', a: ['peau'] },
  { c: 'Sciences', q: 'Comment appelle-t-on un animal qui mange à la fois viande et végétaux ?', a: ['omnivore'] },
  { c: 'Sciences', q: 'Quelle molécule porte l’information génétique ?', a: ['ADN'] },
  { c: 'Sciences', q: 'Quelle unité mesure la puissance électrique ?', a: ['watt'] },
  { c: 'Sciences', q: 'Quel scientifique a découvert la pénicilline ?', a: ['Fleming', 'Alexander Fleming'] },
  { c: 'Sciences', q: 'À quelle température l’eau bout-elle au niveau de la mer (en °C) ?', a: ['100'] },

  /* ── Cinéma & séries ──────────────────────────────────── */
  { c: 'Cinéma', q: 'Qui réalise la trilogie du Seigneur des anneaux ?', a: ['Peter Jackson'] },
  { c: 'Cinéma', q: 'Quel est le nom du personnage principal de Matrix ?', a: ['Neo', 'Thomas Anderson'] },
  { c: 'Cinéma', q: 'Dans quel film entend-on « Je suis ton père » ?', a: ['Star Wars', "L'Empire contre-attaque", 'Star Wars 5'] },
  { c: 'Cinéma', q: 'Quel studio a produit Toy Story ?', a: ['Pixar'] },
  { c: 'Cinéma', q: 'Quel acteur incarne Jack Sparrow ?', a: ['Johnny Depp'] },
  { c: 'Cinéma', q: 'Quelle série met en scène Walter White ?', a: ['Breaking Bad'] },
  { c: 'Cinéma', q: 'Quel film de 1997 raconte le naufrage d’un paquebot ?', a: ['Titanic'] },
  { c: 'Cinéma', q: 'Qui joue Iron Man dans le Marvel Cinematic Universe ?', a: ['Robert Downey Jr', 'Robert Downey Junior'] },
  { c: 'Cinéma', q: 'Quelle série se déroule à Westeros ?', a: ['Game of Thrones', 'Le Trône de fer'] },
  { c: 'Cinéma', q: 'Quel réalisateur a signé Pulp Fiction ?', a: ['Tarantino', 'Quentin Tarantino'] },
  { c: 'Cinéma', q: 'Quel film d’animation Disney met en scène Simba ?', a: ['Le Roi Lion', 'Roi Lion', 'Lion King'] },
  { c: 'Cinéma', q: 'Dans Harry Potter, quelle est la maison de Harry à Poudlard ?', a: ['Gryffondor'] },
  { c: 'Cinéma', q: 'Quel film français a pour héroïne une serveuse de Montmartre ?', a: ['Amélie Poulain', 'Le Fabuleux Destin d’Amélie Poulain', 'Amélie'] },
  { c: 'Cinéma', q: 'Quelle série coréenne à succès met en scène des jeux d’enfants mortels ?', a: ['Squid Game'] },
  { c: 'Cinéma', q: 'Quel personnage dit « Wingardium Leviosa » avec insistance ?', a: ['Hermione', 'Hermione Granger'] },

  /* ── Musique ──────────────────────────────────────────── */
  { c: 'Musique', q: 'Quel groupe britannique a sorti l’album Abbey Road ?', a: ['Beatles', 'The Beatles'] },
  { c: 'Musique', q: 'Qui est surnommé le King of Pop ?', a: ['Michael Jackson'] },
  { c: 'Musique', q: 'Quel duo français porte des casques de robot ?', a: ['Daft Punk'] },
  { c: 'Musique', q: 'Combien de cordes a une guitare classique ?', a: ['6', 'six'] },
  { c: 'Musique', q: 'Quel compositeur est devenu sourd ?', a: ['Beethoven', 'Ludwig van Beethoven'] },
  { c: 'Musique', q: 'Quelle chanteuse a sorti l’album 21 ?', a: ['Adele'] },
  { c: 'Musique', q: 'Quel groupe a chanté Bohemian Rhapsody ?', a: ['Queen'] },
  { c: 'Musique', q: 'Quel instrument Miles Davis jouait-il ?', a: ['trompette'] },
  { c: 'Musique', q: 'Quel rappeur français a sorti l’album « Ipséité » ?', a: ['Damso'] },
  { c: 'Musique', q: 'Quelle chanteuse est connue pour « Bad Guy » ?', a: ['Billie Eilish'] },
  { c: 'Musique', q: 'Combien de touches compte un piano standard ?', a: ['88'] },
  { c: 'Musique', q: 'Quel festival de musique se tient chaque année dans le Nevada, en plein désert ?', a: ['Burning Man'] },

  /* ── Sport ────────────────────────────────────────────── */
  { c: 'Sport', q: 'Combien de joueurs compose une équipe de football sur le terrain ?', a: ['11', 'onze'] },
  { c: 'Sport', q: 'Quel pays a remporté la Coupe du monde de football 2018 ?', a: ['France'] },
  { c: 'Sport', q: 'Dans quel sport marque-t-on un « ace » ?', a: ['tennis'] },
  { c: 'Sport', q: 'Quelle course cycliste française dure trois semaines en juillet ?', a: ['Tour de France'] },
  { c: 'Sport', q: 'Combien de points vaut un essai au rugby à XV ?', a: ['5', 'cinq'] },
  { c: 'Sport', q: 'Quel nageur américain détient le record de médailles olympiques ?', a: ['Michael Phelps', 'Phelps'] },
  { c: 'Sport', q: 'Dans quel sport utilise-t-on un shuttlecock (volant) ?', a: ['badminton'] },
  { c: 'Sport', q: 'Quel club de football joue au Camp Nou ?', a: ['Barcelone', 'FC Barcelone', 'Barça'] },
  { c: 'Sport', q: 'Tous les combien d’années ont lieu les Jeux olympiques d’été ?', a: ['4', 'quatre'] },
  { c: 'Sport', q: 'Quel joueur argentin a remporté le Mondial 2022 avec son équipe ?', a: ['Messi', 'Lionel Messi'] },

  /* ── Jeux vidéo ───────────────────────────────────────── */
  { c: 'Jeux vidéo', q: 'Quel plombier moustachu est la mascotte de Nintendo ?', a: ['Mario', 'Super Mario'] },
  { c: 'Jeux vidéo', q: 'Dans Minecraft, quel monstre vert explose près du joueur ?', a: ['creeper'] },
  { c: 'Jeux vidéo', q: 'Quel jeu de tir en équipe oppose Terroristes et Anti-terroristes ?', a: ['Counter-Strike', 'CS', 'CS GO'] },
  { c: 'Jeux vidéo', q: 'Quel studio a développé The Witcher 3 ?', a: ['CD Projekt', 'CD Projekt Red'] },
  { c: 'Jeux vidéo', q: 'Quel hérisson bleu court très vite ?', a: ['Sonic'] },
  { c: 'Jeux vidéo', q: 'Dans Pokémon, quel est le Pokémon numéro 25 du Pokédex ?', a: ['Pikachu'] },
  { c: 'Jeux vidéo', q: 'Quel jeu de survie en battle royale a popularisé les constructions ?', a: ['Fortnite'] },
  { c: 'Jeux vidéo', q: 'Quelle princesse Mario sauve-t-il régulièrement ?', a: ['Peach', 'princesse Peach'] },
  { c: 'Jeux vidéo', q: 'Quel MOBA de Riot Games oppose deux équipes de cinq ?', a: ['League of Legends', 'LoL'] },
  { c: 'Jeux vidéo', q: 'Quel héros de Zelda porte une tunique verte ?', a: ['Link'] },

  /* ── Culture web & tech ───────────────────────────────── */
  { c: 'Web & Tech', q: 'Quelle entreprise a créé l’iPhone ?', a: ['Apple'] },
  { c: 'Web & Tech', q: 'Que signifie « www » ?', a: ['World Wide Web'] },
  { c: 'Web & Tech', q: 'Quel réseau social est représenté par un oiseau bleu à l’origine ?', a: ['Twitter', 'X'] },
  { c: 'Web & Tech', q: 'Quel moteur de recherche appartient à Alphabet ?', a: ['Google'] },
  { c: 'Web & Tech', q: 'Quelle plateforme de discussion vocale est très utilisée par les gamers ?', a: ['Discord'] },
  { c: 'Web & Tech', q: 'Qui a fondé Microsoft avec Paul Allen ?', a: ['Bill Gates', 'Gates'] },
  { c: 'Web & Tech', q: 'Quel langage de programmation partage son nom avec un serpent ?', a: ['Python'] },
  { c: 'Web & Tech', q: 'Que veut dire l’acronyme « IA » ?', a: ['intelligence artificielle'] },
  { c: 'Web & Tech', q: 'Quelle société a créé le système Android ?', a: ['Google'] },
  { c: 'Web & Tech', q: 'Combien de bits dans un octet ?', a: ['8', 'huit'] },

  /* ── Nourriture ───────────────────────────────────────── */
  { c: 'Nourriture', q: 'De quel pays vient la pizza ?', a: ['Italie'] },
  { c: 'Nourriture', q: 'Quel fruit est à la base du guacamole ?', a: ['avocat'] },
  { c: 'Nourriture', q: 'Quelle épice est la plus chère au monde au kilo ?', a: ['safran'] },
  { c: 'Nourriture', q: 'De quelle céréale fait-on le risotto ?', a: ['riz'] },
  { c: 'Nourriture', q: 'Quel fromage français est très connu pour ses moisissures bleues ?', a: ['roquefort', 'bleu'] },
  { c: 'Nourriture', q: 'Quel plat japonais est fait de riz vinaigré et de poisson cru ?', a: ['sushi'] },
  { c: 'Nourriture', q: 'De quelle plante extrait-on le chocolat ?', a: ['cacao', 'cacaoyer'] },
  { c: 'Nourriture', q: 'Quelle boisson est faite à partir de raisin fermenté ?', a: ['vin'] },

  /* ── Animaux & nature ─────────────────────────────────── */
  { c: 'Animaux', q: 'Quel est l’animal terrestre le plus rapide ?', a: ['guépard'] },
  { c: 'Animaux', q: 'Quel est le plus grand animal du monde ?', a: ['baleine bleue', 'rorqual bleu'] },
  { c: 'Animaux', q: 'Combien de pattes a une araignée ?', a: ['8', 'huit'] },
  { c: 'Animaux', q: 'Quel oiseau ne peut pas voler et vit en Antarctique ?', a: ['manchot', 'pingouin'] },
  { c: 'Animaux', q: 'Quel animal est le symbole du WWF ?', a: ['panda'] },
  { c: 'Animaux', q: 'Comment appelle-t-on un bébé cheval ?', a: ['poulain'] },
  { c: 'Animaux', q: 'Quel mammifère est capable de voler ?', a: ['chauve-souris'] },
  { c: 'Animaux', q: 'Quel est le plus grand félin sauvage ?', a: ['tigre'] },

  /* ── Littérature & arts ───────────────────────────────── */
  { c: 'Littérature', q: 'Qui a écrit Les Misérables ?', a: ['Victor Hugo', 'Hugo'] },
  { c: 'Littérature', q: 'Qui a écrit Harry Potter ?', a: ['J.K. Rowling', 'Rowling', 'JK Rowling'] },
  { c: 'Littérature', q: 'Qui a peint La Joconde ?', a: ['Léonard de Vinci', 'de Vinci', 'Da Vinci'] },
  { c: 'Littérature', q: 'Quel auteur a créé Sherlock Holmes ?', a: ['Conan Doyle', 'Arthur Conan Doyle'] },
  { c: 'Littérature', q: 'Qui a écrit Le Petit Prince ?', a: ['Saint-Exupéry', 'Antoine de Saint-Exupéry'] },
  { c: 'Littérature', q: 'Quel peintre néerlandais s’est coupé l’oreille ?', a: ['Van Gogh', 'Vincent Van Gogh'] },
  { c: 'Littérature', q: 'Quel roman de George Orwell met en scène Big Brother ?', a: ['1984'] },
  { c: 'Littérature', q: 'Dans quel musée parisien se trouve la Joconde ?', a: ['Louvre', 'musée du Louvre'] },

  /* ── Divers / logique ─────────────────────────────────── */
  { c: 'Divers', q: 'Combien de couleurs compte un arc-en-ciel dans la description classique ?', a: ['7', 'sept'] },
  { c: 'Divers', q: 'Combien de cases compte un échiquier ?', a: ['64'] },
  { c: 'Divers', q: 'Quelle est la seule lettre absente du nom des 50 États américains ?', a: ['Q'] },
  { c: 'Divers', q: 'Combien de minutes dans une journée ?', a: ['1440', '1 440'] },
  { c: 'Divers', q: 'Quelle couleur obtient-on en mélangeant du bleu et du jaune ?', a: ['vert'] },
  { c: 'Divers', q: 'Combien de côtés a un hexagone ?', a: ['6', 'six'] },
  { c: 'Divers', q: 'Quel est le chiffre romain pour 50 ?', a: ['L'] },
  { c: 'Divers', q: 'Combien de cartes dans un jeu de 52 cartes… sans les jokers ?', a: ['52'] },
  { c: 'Divers', q: 'Quel jour vient après mercredi ?', a: ['jeudi'] },
  { c: 'Divers', q: 'Combien de secondes dans une heure ?', a: ['3600', '3 600'] },
];

const CATEGORIES = [...new Set(QUESTIONS.map((q) => q.c))];

module.exports = { QUESTIONS, CATEGORIES };
