// French labels of the VAT regime card and its switch dialog (specs/vat-optional-mode.md §6).
// The sentences about a period and the lines of « Ce qui change » come from the server.

export const VAT_BASIS = Object.freeze({ BOOKING: 'booking', ARRIVAL: 'arrival', ALL: 'all' });

export const VAT_SCOPES = [
  { value: VAT_BASIS.BOOKING, title: 'Réservations prises à partir du', hint: 'Les réservations déjà prises gardent leur régime.', dated: true },
  { value: VAT_BASIS.ARRIVAL, title: 'Séjours qui commencent à partir du', hint: 'Y compris les séjours déjà réservés.', dated: true },
  { value: VAT_BASIS.ALL, title: 'Toutes les réservations — correction', hint: 'Pour un régime mal paramétré.', dated: false, correction: true },
];

export const VAT_TEXTS = Object.freeze({
  cardTitle: 'TVA',
  subjectSub: 'Appliqué à l’ensemble des prestations : hébergement, options, ressources.',
  notSubjectSub: 'Aucune TVA sur les prix, les devis et les liens de paiement.',
  rateHelp: '10 % par défaut.',
  rateRequired: 'Taux requis.',
  switchButton: 'Changer de régime…',
  historyTitle: 'Historique',
  undo: 'Annuler ce changement',
  undoConfirmTitle: 'Annuler ce changement ?',
  undoConfirmMessage: 'Le régime précédent est rétabli ; les réservations déplacées par ce changement y reviennent.',
  keep: 'Garder',
  scheduledTag: 'Prévu',
  correctionTag: 'Correction',
  inForceTag: 'En vigueur',
  whatChanges: 'Ce qui change',
  appliesTo: 'Appliquer à',
  previewWaiting: 'Aperçu disponible une fois les champs corrigés.',
  ackSent: 'Les écritures déjà transmises au comptable changent.',
  ackCollected: 'Des réservations déjà encaissées changent de régime.',
  ackDocuments: 'Les documents déjà envoyés ne changent pas.',
  regimeStale: 'Le régime a changé entre-temps. Écran mis à jour.',
  stale: 'Les réservations ont changé. Aperçu mis à jour.',
  thresholdLabel: 'Seuil de franchise (€)',
  thresholdHint: 'Montant fixé par la loi pour l’activité. À vérifier avant saisie.',
  thresholdSetOn: (date) => `Saisi le ${date}`,
  scheduledHelp: 'Changement prévu, annulable tant qu’aucune réservation ne l’utilise.',
});

// Rule 35 — only the franchise en base has a threshold; the draft decides, so the field follows the select.
export const showsFranchiseField = (vat) => Boolean(vat) && vat.regime === 'not_subject' && vat.legalMention === 'art_293_b';

export const switchTitle = (toNotSubject) => (toNotSubject ? 'Passer sans TVA' : 'Passer à la TVA');
export const switchSubmit = (toNotSubject, correction) => {
  if (correction) return 'Corriger toutes les réservations';
  return toNotSubject ? 'Passer sans TVA' : 'Passer à la TVA';
};
export const regimeLabel = (period) => (period.regime === 'not_subject'
  ? 'Sans TVA' : `Assujetti · ${String(period.rate).replace('.', ',')} %`);
