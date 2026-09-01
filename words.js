'use strict';
/**
 * LES PAIRES DE MOTS DE L'UNDERCOVER.
 *
 * Chaque paire donne un mot aux civils et un mot voisin à l'infiltré. Tout
 * le sel du jeu tient à la distance entre les deux : trop loin, l'infiltré
 * se grille en une phrase ; trop près, personne ne peut le démasquer et la
 * partie s'enlise.
 *
 * Les paires sont donc rangées par difficulté :
 *
 *  • facile   — deux objets voisins mais nettement différents (thé / café) ;
 *  • moyen    — même famille, une nuance (menteur / hypocrite) ;
 *  • difficile— presque synonymes (jaloux / envieux).
 *
 * Le salon choisit son niveau ; par défaut on mélange les trois.
 */

/* ─── Facile ────────────────────────────────────────────── */

const EASY = [
  ['Thé', 'Café'], ['Chien', 'Chat'], ['Vélo', 'Trottinette'], ['Plage', 'Piscine'],
  ['Pizza', 'Tarte'], ['Métro', 'Bus'], ['Neige', 'Pluie'], ['Guitare', 'Piano'],
  ['Cinéma', 'Théâtre'], ['Docteur', 'Infirmier'], ['Montre', 'Bracelet'], ['Lac', 'Rivière'],
  ['Sac à dos', 'Valise'], ['Père Noël', 'Lapin de Pâques'], ['Fourchette', 'Cuillère'],
  ['Crayon', 'Stylo'], ['Bougie', 'Lampe'], ['Chaussettes', 'Gants'], ['Miel', 'Confiture'],
  ['Ballon', 'Frisbee'], ['Casque', 'Écouteurs'], ['Vampire', 'Zombie'], ['Sorcier', 'Chevalier'],
  ['Tortue', 'Escargot'], ['Poule', 'Canard'], ['Camion', 'Tracteur'], ['Bateau', 'Sous-marin'],
  ['Aéroport', 'Gare'], ['Boulangerie', 'Pâtisserie'], ['Frites', 'Chips'],
  ['Barbe', 'Moustache'], ['Chapeau', 'Casquette'], ['Lunettes', 'Masque'],
  ['Hôpital', 'Pharmacie'], ['Prison', 'Cachot'], ['Fantôme', 'Ombre'],
  ['Château', 'Cabane'], ['Épée', 'Hache'], ['Balai', 'Aspirateur'], ['Savon', 'Shampoing'],
  ['Facteur', 'Livreur'], ['Professeur', 'Directeur'], ['Pompier', 'Policier'],
  ['Vague', 'Marée'], ['Volcan', 'Geyser'], ['Désert', 'Savane'], ['Forêt', 'Jungle'],
];

/* ─── Moyen ─────────────────────────────────────────────── */

const MEDIUM = [
  ['Menteur', 'Hypocrite'], ['Timide', 'Réservé'], ['Rêve', 'Souvenir'], ['Secret', 'Mensonge'],
  ['Ami', 'Complice'], ['Chef', 'Patron'], ['Promesse', 'Contrat'], ['Habitude', 'Rituel'],
  ['Colère', 'Rancune'], ['Peur', 'Angoisse'], ['Silence', 'Vide'], ['Blague', 'Moquerie'],
  ['Compliment', 'Flatterie'], ['Courage', 'Inconscience'], ['Chance', 'Hasard'],
  ['Fatigue', 'Ennui'], ['Voyage', 'Fuite'], ['Foule', 'File d’attente'], ['Fête', 'Soirée'],
  ['Cadeau', 'Récompense'], ['Photo', 'Portrait'], ['Journal', 'Rumeur'], ['Publicité', 'Propagande'],
  ['Sondage', 'Vote'], ['Diplôme', 'Certificat'], ['Salaire', 'Pourboire'], ['Dette', 'Emprunt'],
  ['Assurance', 'Garantie'], ['Répétition', 'Entraînement'], ['Public', 'Jury'],
  ['Applaudissement', 'Sifflet'], ['Sieste', 'Nuit blanche'], ['Recette', 'Notice'],
  ['Épice', 'Parfum'], ['Bruit', 'Musique'], ['Écho', 'Rappel'], ['Fenêtre', 'Vitrine'],
  ['Escalier', 'Ascenseur'], ['Carte', 'Boussole'], ['Clé', 'Code'], ['Serrure', 'Cadenas'],
  ['Uniforme', 'Déguisement'], ['Tatouage', 'Cicatrice'], ['Miroir', 'Reflet'],
  ['Trophée', 'Médaille'], ['Match nul', 'Défaite'], ['Arbitre', 'Témoin'],
  ['Bibliothèque', 'Archives'], ['Musée', 'Grenier'], ['Anniversaire', 'Rentrée'],
];

/* ─── Difficile ─────────────────────────────────────────── */

const HARD = [
  ['Jaloux', 'Envieux'], ['Doute', 'Hésitation'], ['Erreur', 'Faute'], ['Espoir', 'Attente'],
  ['Talent', 'Don'], ['Règle', 'Loi'], ['Excuse', 'Justification'], ['Souvenir', 'Nostalgie'],
  ['Confiance', 'Naïveté'], ['Patience', 'Résignation'], ['Fierté', 'Orgueil'],
  ['Discussion', 'Débat'], ['Conseil', 'Avis'], ['Question', 'Doute'], ['Sourire', 'Rictus'],
  ['Politesse', 'Hypocrisie'], ['Discrétion', 'Indifférence'], ['Routine', 'Monotonie'],
  ['Effort', 'Sacrifice'], ['But', 'Envie'], ['Idée', 'Intuition'], ['Preuve', 'Indice'],
  ['Copie', 'Inspiration'], ['Ordre', 'Demande'], ['Retard', 'Report'], ['Pause', 'Abandon'],
  ['Départ', 'Adieu'], ['Rencontre', 'Croisement'], ['Voisin', 'Inconnu'], ['Foi', 'Croyance'],
  ['Rumeur', 'Légende'], ['Instant', 'Moment'], ['Habitude', 'Manie'], ['Détail', 'Nuance'],
  ['Chuchotement', 'Murmure'], ['Frontière', 'Limite'], ['Faim', 'Gourmandise'],
  ['Froid', 'Frisson'], ['Reflet', 'Illusion'], ['Sommeil', 'Somnolence'],
];

const LEVELS = {
  facile: EASY,
  moyen: MEDIUM,
  difficile: HARD,
};

const ALL = [...EASY, ...MEDIUM, ...HARD];

/**
 * Tire une paire, en évitant celles déjà sorties dans le salon — on ne veut
 * pas retomber sur « thé / café » trois manches de suite.
 */
function pick(level = 'melange', used = []) {
  const pool = LEVELS[level] || ALL;
  const seen = new Set(used);
  const fresh = pool.filter((pair) => !seen.has(pair[0]));
  const from = fresh.length ? fresh : pool;
  const pair = from[Math.floor(Math.random() * from.length)];

  // Le mot des civils et celui de l'infiltré sont tirés au sort dans la
  // paire : sinon l'habitué finirait par savoir que c'est toujours le
  // premier des deux qui est majoritaire.
  return Math.random() < 0.5 ? { civil: pair[0], spy: pair[1] } : { civil: pair[1], spy: pair[0] };
}

module.exports = { pick, LEVELS, ALL, EASY, MEDIUM, HARD };
