/** French strings of Options & ressources (specs/options-resources-ux.md rules 10, 11, 16, 17, 22). */

export const PAGE_TITLE = 'Options & ressources';

export const OPTION_PRICE_TYPES = [
  { value: 'per_stay', label: 'Prix fixe' },
  { value: 'per_person', label: 'Par personne' },
  { value: 'per_night', label: 'Par jour' },
  { value: 'per_person_per_night', label: 'Par personne / jour' },
  { value: 'per_participant_progressive', label: 'Dégressif participants' },
  { value: 'percent_of_stay', label: '% du montant du séjour' },
  { value: 'free', label: 'Gratuit' },
];

export const RESOURCE_PRICE_TYPES = [
  { value: 'per_stay', label: 'Prix fixe' },
  { value: 'per_person', label: 'Par personne' },
  { value: 'per_night', label: 'Par jour' },
  { value: 'per_person_per_night', label: 'Par personne / jour' },
  { value: 'per_hour', label: 'Par heure' },
  { value: 'free', label: 'Gratuit' },
];

export const UNIT_BY_PRICE_TYPE = {
  per_stay: '/ séjour',
  per_person: '/ pers.',
  per_night: '/ jour',
  per_person_per_night: '/ pers. / jour',
  per_hour: '/ h',
};

export const TEXTS = {
  searchLabel: 'Rechercher une option',
  allCategories: 'Toutes',
  allProperties: 'Tous',
  propertyFilter: 'Logement',
  categories: 'Catégories',
  noResult: 'Aucun résultat',
  clearFilters: 'Effacer les filtres',
  newOption: 'Nouvelle option',
  newResource: 'Nouvelle ressource',
  optionSaved: 'Option enregistrée',
  optionAdded: 'Option ajoutée',
  optionRestored: 'Option restaurée',
  resourceSaved: 'Ressource enregistrée',
  resourceAdded: 'Ressource ajoutée',
  emptyOptionsTitle: 'Aucune option',
  emptyOptionsMessage: 'Petit-déjeuner, ménage, boissons…',
  emptyOptionsAction: 'Ajouter une option',
  emptyResourcesTitle: 'Aucune ressource',
  emptyResourcesMessage: 'Lit bébé, bain nordique, vélos…',
  emptyResourcesAction: 'Ajouter une ressource',
  archived: 'Archivées',
  restore: 'Restaurer',
  archivedNote: 'Retirée des nouvelles réservations.',
  edit: 'Modifier',
  archive: 'Archiver',
  systemOption: 'Option système : elle reste au catalogue.',
  archiveTitle: (name) => `Archiver « ${name} » ?`,
  archiveMessage: 'Retirée des nouvelles réservations. Les réservations existantes la gardent.',
  loadError: 'Impossible de charger le catalogue.',
};

export const FIELD = {
  titleRequired: 'Nom requis',
  notANumber: 'Nombre attendu',
  negative: 'Positif ou nul',
  decimals: '2 décimales max',
  percentMax: '100 % max',
  wholeNumber: 'Nombre entier attendu',
  afterOpening: 'Après l’ouverture',
};
