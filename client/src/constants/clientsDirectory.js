// French strings of the Clients page (specs/clients-upcoming-past-directory.md rules 11-22).

export const VIEWS = [
  { value: 'upcoming', param: null, label: 'À venir' },
  { value: 'past', param: 'passes', label: 'Passés' },
  { value: 'none', param: 'sans-sejour', label: 'Sans séjour' },
];

export const SORTS = [
  { value: 'stayDate', label: 'Date de séjour' },
  { value: 'name', label: 'Nom' },
];

export const TEXTS = {
  searchLabel: 'Rechercher un client',
  sortLabel: 'Trier',
  sortByCreation: 'Date de création',
  tabsLabel: 'Séjours des clients',
  noMatchIn: (viewLabel) => `Aucun résultat dans ${viewLabel}`,
  switchTo: (count, viewLabel) => `${count} dans ${viewLabel}`,
  noMatchAnywhere: 'Aucun client trouvé.',
  emptyUpcoming: 'Aucune arrivée prévue.',
  seePast: (count) => `Voir les passés (${count})`,
  emptyPast: 'Aucun séjour passé.',
  emptyNone: 'Tous les clients ont un séjour.',
  orphanStrip: (count) => `${count} client${count > 1 ? 's' : ''} sans réservation ni devis`,
  cleanup: 'Nettoyer les clients',
  stays: (count) => `${count} séjours`,
  nights: (count) => `${count} nuit${count > 1 ? 's' : ''}`,
  callLabel: (name) => `Appeler ${name}`,
};

export function viewFromParam(param) {
  return (VIEWS.find((v) => v.param && v.param === param) || VIEWS[0]).value;
}

export function paramFromView(value) {
  return (VIEWS.find((v) => v.value === value) || VIEWS[0]).param;
}

export function viewLabel(value) {
  return (VIEWS.find((v) => v.value === value) || VIEWS[0]).label;
}
