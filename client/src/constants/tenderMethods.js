/**
 * Payment methods of a split payment (specs/mixed-method-payments.md rule 4) and the French copy of the
 * « Plusieurs moyens » controls.
 *
 * The list is the server's (`server/src/utils/paymentTenders.js` METHODS): the ledger hands it over as
 * `action.split.methods`. This copy is only the fallback for the surfaces that receive no ledger (SAS,
 * mid-stay note, installment plan) — keep the two in the same order with the same labels.
 */
export const TENDER_METHODS = Object.freeze([
  { value: 'card', label: 'CB' },
  { value: 'cash', label: 'Espèces' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'transfer', label: 'Virement' },
  { value: 'holidayVoucher', label: 'Chèques-vacances' },
  { value: 'other', label: 'Autre' },
]);

export const TENDER_TEXTS = Object.freeze({
  open: 'Plusieurs moyens',
  close: 'Un seul moyen',
  add: 'Ajouter un moyen',
  internal: 'Caisse interne',
  remainderSuffix: 'reste',
  remove: 'Retirer cette ligne',
  due: 'Dû',
  covered: 'Reste 0,00 €',
  short: (amount) => `${amount} non couverts`,
  over: (amount) => `${amount} de trop`,
  shortTitle: (amount) => `${amount} ne sont pas couverts.`,
  dueTitle: 'Reste à percevoir',
  dueHelp: (amount) => `La fiche garde ${amount} à encaisser plus tard.`,
  waivedTitle: 'Geste commercial',
  waivedHelp: (amount) => `${amount} accordés, enregistrés en réduction.`,
  collect: (amount) => `Encaisser ${amount}`,
  save: 'Enregistrer',
  modify: 'Modifier',
  internalTag: 'caisse interne',
  methodAria: (n) => `Moyen ${n}`,
  amountAria: (label) => `Montant ${label}`,
});
