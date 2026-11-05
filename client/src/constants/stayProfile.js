// « Profil des séjours » (specs/stay-profile.md §3.4) — the page's French strings. Every figure, label
// and source caption of a panel comes from the server; these are the page's own words.

export const STAY_PROFILE_PATH = '/finance/profil';

export const STAY_PROFILE_TEXT = {
  title: 'Profil des séjours',
  loading: 'Chargement du profil des séjours…',
  loadError: 'Impossible de charger le profil des séjours.',
  allProperties: 'Tous les logements',
  propertyLabel: 'Logement',
  exerciseLabel: 'Exercice',
  dimensionLabel: 'Découpage',
  measureLabel: 'Mesure',
  breakdownPanel: 'Répartition des séjours',
  basketPanel: 'Panier moyen par séjour',
  empty: 'Aucun séjour sur la période.',
  basketEmpty: "Aucun séjour sur l'exercice.",
  notCancelled: 'séjours non annulés',
  month: 'Mois',
  delta: 'Écart',
  stays: 'Séjours',
  amount: 'Montant',
  share: 'Part',
  refresh: 'Actualiser',
};

export const MEASURES = [
  { value: 'count', label: 'Nombre' },
  { value: 'amount', label: 'Montant' },
];
