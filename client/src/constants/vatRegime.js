// French labels of the VAT regime card and its switch dialog (specs/vat-optional-mode.md §6).
// The sentences about a period and the lines of « Ce qui change » come from the server.

export const VAT_BASIS = Object.freeze({ BOOKING: 'booking', ARRIVAL: 'arrival', ALL: 'all' });

export const VAT_SCOPES = [
  { value: VAT_BASIS.BOOKING, title: 'Réservations prises à partir du', hint: 'Les séjours déjà réservés gardent leur régime.', dated: true },
  { value: VAT_BASIS.ARRIVAL, title: 'Séjours qui commencent à partir du', hint: 'Même les réservations déjà prises changent, si le séjour commence après.', dated: true },
  { value: VAT_BASIS.ALL, title: 'Toutes les réservations — correction', hint: 'En cas de mauvais réglage : tout l’historique est refait.', dated: false },
];

export const VAT_TEXTS = Object.freeze({
  cardTitle: 'TVA',
  subjectSub: 'Appliqué à l’ensemble des prestations : hébergement, options, ressources.',
  notSubjectSub: 'Aucune TVA sur les prix, les devis et les liens de paiement.',
  rateHelp: '10 % par défaut.',
  switchButton: 'Changer de régime…',
  historyTitle: 'Historique',
  undo: 'Annuler ce changement',
  undoConfirmTitle: 'Annuler ce changement ?',
  undoConfirmMessage: 'Le régime précédent reste en vigueur. Aucune réservation n’est touchée.',
  scheduledTag: 'Prévu',
  correctionTag: 'Correction',
  inForceTag: 'En vigueur',
  whatChanges: 'Ce qui change',
  appliesTo: 'Appliquer à',
  previewWaiting: 'Aperçu disponible une fois les champs corrigés.',
  ackSent: 'Les écritures déjà transmises au comptable changent.',
  ackDocuments: 'Les documents déjà envoyés ne changent pas.',
  stale: 'Les réservations ont changé. Aperçu mis à jour.',
  scheduledHelp: 'Changement prévu, annulable tant qu’aucune réservation ne l’utilise.',
});

export const switchTitle = (toNotSubject) => (toNotSubject ? 'Passer sans TVA' : 'Passer à la TVA');
export const switchSubmit = (toNotSubject, correction) => {
  if (correction) return 'Corriger toutes les réservations';
  return toNotSubject ? 'Passer sans TVA' : 'Passer à la TVA';
};
export const regimeLabel = (period) => (period.regime === 'not_subject'
  ? 'Sans TVA' : `Assujetti · ${String(period.rate).replace('.', ',')} %`);
