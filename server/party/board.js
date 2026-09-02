'use strict';
/**
 * LE PLATEAU.
 *
 * Quarante cases, le plateau français : boulevard de Belleville d'un côté,
 * rue de la Paix de l'autre. Tout est ici et rien n'est ailleurs — les
 * loyers, le prix des maisons, l'hypothèque, les deux paquets de cartes.
 * Le moteur de jeu (`monopoly.js`) ne connaît aucun chiffre : il lit ce
 * fichier. C'est la seule façon de changer une valeur sans risquer d'en
 * oublier une copie quelque part.
 *
 * LES BARÈMES DE LOYER
 * ────────────────────
 * `rent` est un tableau de six valeurs : terrain nu, 1, 2, 3, 4 maisons,
 * puis hôtel. Le terrain nu est doublé quand un joueur possède TOUT le
 * groupe de couleur et qu'aucune de ses cases n'est hypothéquée — c'est la
 * règle qui rend les monopoles si violents, et c'est elle qui fait qu'on
 * échange des terrains au lieu de les garder.
 *
 * `mortgage` vaut toujours la moitié du prix d'achat, et se rachète à
 * 110 % — les 10 % sont détruits. Comme la commission du marché du site,
 * c'est ce qui empêche la masse monétaire de gonfler indéfiniment.
 */

/* ─── Les groupes de couleur ───────────────────────────── */

const GROUPS = {
  brun:   { name: 'Brun',        color: '#8B5A2B', house: 50 },
  ciel:   { name: 'Bleu ciel',   color: '#7EC8E3', house: 50 },
  rose:   { name: 'Violet',      color: '#C060B0', house: 100 },
  orange: { name: 'Orange',      color: '#E8892B', house: 100 },
  rouge:  { name: 'Rouge',       color: '#D6383A', house: 150 },
  jaune:  { name: 'Jaune',       color: '#E8C61F', house: 150 },
  vert:   { name: 'Vert',        color: '#2E9E5B', house: 200 },
  bleu:   { name: 'Bleu foncé',  color: '#2F6FD0', house: 200 },
};

/* ─── Les quarante cases ───────────────────────────────── */

const T = (name, group, price, rent, mortgage) =>
  ({ type: 'terrain', name, group, price, rent, mortgage });
const GARE = (name) =>
  ({ type: 'gare', name, group: 'gare', price: 200, mortgage: 100 });
const SERVICE = (name) =>
  ({ type: 'service', name, group: 'service', price: 150, mortgage: 75 });

const BOARD = [
  { type: 'depart', name: 'Départ', hint: 'Touche 200 en passant' },
  T('Boulevard de Belleville', 'brun', 60, [2, 10, 30, 90, 160, 250], 30),
  { type: 'caisse', name: 'Caisse commune' },
  T('Rue Lecourbe', 'brun', 60, [4, 20, 60, 180, 320, 450], 30),
  { type: 'impot', name: 'Impôt sur le revenu', amount: 200, hint: '200 pièces' },
  GARE('Gare Montparnasse'),
  T('Rue de Vaugirard', 'ciel', 100, [6, 30, 90, 270, 400, 550], 50),
  { type: 'chance', name: 'Chance' },
  T('Rue de Courcelles', 'ciel', 100, [6, 30, 90, 270, 400, 550], 50),
  T('Avenue de la République', 'ciel', 120, [8, 40, 100, 300, 450, 600], 60),
  { type: 'prison', name: 'Prison', hint: 'Simple visite' },
  T('Boulevard de la Villette', 'rose', 140, [10, 50, 150, 450, 625, 750], 70),
  SERVICE('Compagnie d’électricité'),
  T('Avenue de Neuilly', 'rose', 140, [10, 50, 150, 450, 625, 750], 70),
  T('Rue de Paradis', 'rose', 160, [12, 60, 180, 500, 700, 900], 80),
  GARE('Gare de Lyon'),
  T('Avenue Mozart', 'orange', 180, [14, 70, 200, 550, 750, 950], 90),
  { type: 'caisse', name: 'Caisse commune' },
  T('Boulevard Saint-Michel', 'orange', 180, [14, 70, 200, 550, 750, 950], 90),
  T('Place Pigalle', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
  { type: 'parc', name: 'Parc gratuit', hint: 'On souffle' },
  T('Avenue Matignon', 'rouge', 220, [18, 90, 250, 700, 875, 1050], 110),
  { type: 'chance', name: 'Chance' },
  T('Boulevard Malesherbes', 'rouge', 220, [18, 90, 250, 700, 875, 1050], 110),
  T('Avenue Henri-Martin', 'rouge', 240, [20, 100, 300, 750, 925, 1100], 120),
  GARE('Gare du Nord'),
  T('Faubourg Saint-Honoré', 'jaune', 260, [22, 110, 330, 800, 975, 1150], 130),
  T('Place de la Bourse', 'jaune', 260, [22, 110, 330, 800, 975, 1150], 130),
  SERVICE('Compagnie des eaux'),
  T('Rue La Fayette', 'jaune', 280, [24, 120, 360, 850, 1025, 1200], 140),
  { type: 'go-prison', name: 'Allez en prison', hint: 'Directement' },
  T('Avenue de Breteuil', 'vert', 300, [26, 130, 390, 900, 1100, 1275], 150),
  T('Avenue Foch', 'vert', 300, [26, 130, 390, 900, 1100, 1275], 150),
  { type: 'caisse', name: 'Caisse commune' },
  T('Boulevard des Capucines', 'vert', 320, [28, 150, 450, 1000, 1200, 1400], 160),
  GARE('Gare Saint-Lazare'),
  { type: 'chance', name: 'Chance' },
  T('Avenue des Champs-Élysées', 'bleu', 350, [35, 175, 500, 1100, 1300, 1500], 175),
  { type: 'taxe', name: 'Taxe de luxe', amount: 100, hint: '100 pièces' },
  T('Rue de la Paix', 'bleu', 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

// Chaque case connaît son index : ça évite d'aller le rechercher partout.
BOARD.forEach((cell, i) => { cell.i = i; });

/* ─── Les cases repères ────────────────────────────────── */

const GO = 0;
const JAIL = 10;
const GO_TO_JAIL = 30;
const FREE = 20;

const GARES = BOARD.filter((c) => c.type === 'gare').map((c) => c.i);
const SERVICES = BOARD.filter((c) => c.type === 'service').map((c) => c.i);

/** Les index des cases d'un groupe de couleur — pour compter les monopoles. */
const GROUP_CELLS = {};
for (const cell of BOARD) {
  if (cell.type !== 'terrain') continue;
  (GROUP_CELLS[cell.group] = GROUP_CELLS[cell.group] || []).push(cell.i);
}

/* ─── Les cartes ───────────────────────────────────────────
 *
 * Chaque carte est une intention, pas du code : `{ do: '…' }` décrit ce
 * qu'il faut faire, et le moteur l'exécute. Les cartes se lisent donc
 * comme un règlement, et on peut en ajouter une sans toucher au moteur.
 *
 * Les deux « libéré de prison » sont les seules cartes qu'on garde en
 * main ; toutes les autres s'appliquent aussitôt et retournent sous la
 * pile.
 */

const CHANCE = [
  { text: 'Avancez jusqu’à la case Départ. Touchez 200.', do: 'go', to: GO },
  { text: 'Rendez-vous rue de la Paix.', do: 'go', to: 39 },
  { text: 'Avancez jusqu’à l’avenue Henri-Martin. Si vous passez par la case Départ, touchez 200.', do: 'go', to: 24 },
  { text: 'Avancez jusqu’au boulevard de la Villette. Si vous passez par la case Départ, touchez 200.', do: 'go', to: 11 },
  { text: 'Avancez jusqu’à la gare la plus proche. Le loyer dû au propriétaire est doublé.', do: 'gare-proche' },
  { text: 'Avancez jusqu’à la gare la plus proche. Le loyer dû au propriétaire est doublé.', do: 'gare-proche' },
  { text: 'Avancez jusqu’au service public le plus proche. Lancez les dés et payez dix fois le montant au propriétaire.', do: 'service-proche' },
  { text: 'La banque vous verse un dividende de 50.', do: 'gain', amount: 50 },
  { text: 'Vous êtes libéré de prison. Cette carte peut être conservée.', do: 'liberte' },
  { text: 'Reculez de trois cases.', do: 'recule', steps: 3 },
  { text: 'Allez en prison. Sans passer par la case Départ, sans toucher 200.', do: 'prison' },
  { text: 'Faites des réparations sur tous vos immeubles : 25 par maison, 100 par hôtel.', do: 'reparations', house: 25, hotel: 100 },
  { text: 'Amende pour excès de vitesse : payez 15.', do: 'perte', amount: 15 },
  { text: 'Prenez le train à la gare Montparnasse. Si vous passez par la case Départ, touchez 200.', do: 'go', to: 5 },
  { text: 'Vous avez gagné le concours de mots croisés. Touchez 100.', do: 'gain', amount: 100 },
  { text: 'Votre immeuble et votre prêt rapportent. Touchez 150.', do: 'gain', amount: 150 },
];

const CAISSE = [
  { text: 'Avancez jusqu’à la case Départ. Touchez 200.', do: 'go', to: GO },
  { text: 'Erreur de la banque en votre faveur. Touchez 200.', do: 'gain', amount: 200 },
  { text: 'Frais médicaux : payez 50.', do: 'perte', amount: 50 },
  { text: 'Vente de votre stock. Touchez 50.', do: 'gain', amount: 50 },
  { text: 'Vous êtes libéré de prison. Cette carte peut être conservée.', do: 'liberte' },
  { text: 'Allez en prison. Sans passer par la case Départ, sans toucher 200.', do: 'prison' },
  { text: 'Recevez votre revenu annuel : 100.', do: 'gain', amount: 100 },
  { text: 'Retour d’impôt : touchez 20.', do: 'gain', amount: 20 },
  { text: 'C’est votre anniversaire. Chaque joueur vous donne 10.', do: 'anniversaire', amount: 10 },
  { text: 'La vente de votre assurance-vie rapporte 100.', do: 'gain', amount: 100 },
  { text: 'Payez votre note d’hôpital : 100.', do: 'perte', amount: 100 },
  { text: 'Payez votre note de scolarité : 50.', do: 'perte', amount: 50 },
  { text: 'Vous gagnez un concours de beauté. Touchez 10.', do: 'gain', amount: 10 },
  { text: 'Vous héritez de 100.', do: 'gain', amount: 100 },
  { text: 'Vous êtes imposé pour les réparations de voirie : 40 par maison, 115 par hôtel.', do: 'reparations', house: 40, hotel: 115 },
  { text: 'Recevez les intérêts de votre emprunt à 7 % : 25.', do: 'gain', amount: 25 },
];

/* ─── Les constantes de la partie ──────────────────────── */

const START_MONEY = 1500;
const SALARY = 200;         // au passage par la case Départ
const JAIL_FINE = 50;       // pour sortir de prison en payant
const JAIL_TURNS = 3;       // trois tentatives de double avant de payer d'office
const HOUSES = 32;          // le stock de maisons de la banque
const HOTELS = 12;          // et celui des hôtels
const UNMORTGAGE_RATE = 1.1;

module.exports = {
  BOARD, GROUPS, GROUP_CELLS, GARES, SERVICES,
  CHANCE, CAISSE,
  GO, JAIL, GO_TO_JAIL, FREE,
  START_MONEY, SALARY, JAIL_FINE, JAIL_TURNS, HOUSES, HOTELS, UNMORTGAGE_RATE,
};
