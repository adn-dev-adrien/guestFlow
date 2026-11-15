// French copy and presentation maps of the « Bons cadeaux » screens (specs/gift-vouchers.md §6). The server decides each
// voucher's state; these maps only give it a label and a colour.
export const STATE_BADGES = Object.freeze({
  pending: { label: 'En attente', status: 'neutral' },
  active: { label: 'Valable', status: 'success' },
  started: { label: 'Entamé', status: 'info' },
  exhausted: { label: 'Épuisé', status: 'neutral' },
  expired: { label: 'Expiré', status: 'warning' },
  cancelled: { label: 'Annulé', status: 'error' },
});

export const STATE_FILTERS = Object.freeze([
  { value: '', label: 'Tous' },
  { value: 'active', label: 'Valables' },
  { value: 'started', label: 'Entamés' },
  { value: 'exhausted', label: 'Épuisés' },
  { value: 'expired', label: 'Expirés' },
  { value: 'cancelled', label: 'Annulés' },
]);

export const TEXTS = Object.freeze({
  title: 'Bons cadeaux',
  newVoucher: 'Nouveau bon',
  outstanding: 'Solde en cours',
  search: 'Numéro, e-mail ou nom',
  stateFilter: 'État',
  empty: 'Aucun bon cadeau pour le moment.',
  emptyFiltered: 'Aucun bon ne correspond à la recherche.',
  loadError: 'Les bons cadeaux n’ont pas pu être chargés.',
  detailError: 'Le bon n’a pas pu être chargé.',
  columns: { number: 'Bon', from: 'De la part de', to: 'Pour', issued: 'Émis le', state: 'État', balance: 'Solde', expiry: 'Expire le' },
  detail: {
    code: 'Code', reveal: 'Afficher le code', hide: 'Masquer le code', expiry: 'Valable jusqu’au', balance: 'Solde',
    from: 'De la part de', to: 'Pour', email: 'E-mail', message: 'Message', movements: 'Mouvements', close: 'Fermer',
    resend: 'Renvoyer le mail', pdf: 'Télécharger le PDF', extend: 'Prolonger', cancel: 'Annuler le bon', adjust: 'Corriger le solde',
    cancelNotAllowed: 'Ce bon a déjà servi : il ne peut plus être annulé.',
    noEmail: 'Aucune adresse e-mail sur ce bon.',
    mailError: 'Dernier envoi en échec.',
    resent: 'Mail renvoyé.', extended: 'Validité prolongée.', cancelled: 'Bon annulé.', adjusted: 'Solde corrigé.',
  },
  cancelDialog: {
    title: 'Annuler ce bon ?',
    message: 'Le bon ne pourra plus servir. Un bon payé en ligne est signalé comme remboursement à faire.',
    confirm: 'Annuler le bon', keep: 'Garder',
  },
  extendDialog: { title: 'Prolonger la validité', date: 'Nouvelle date de fin', submit: 'Prolonger' },
  adjustDialog: {
    title: 'Corriger le solde', amount: 'Montant (+ ou −)', amountHelp: 'Positif pour ajouter, négatif pour retirer.', reason: 'Motif', submit: 'Corriger',
  },
  form: {
    title: 'Nouveau bon', amount: 'Montant', recipient: 'Pour', sender: 'De la part de', message: 'Message', email: 'E-mail de l’acheteur (facultatif)',
    method: 'Payé par', date: 'Date de vente', submit: 'Créer le bon', created: 'Bon créé.',
  },
});

// A server refusal names a field of the « Nouveau bon » form; the message is shown on it.
export const FORM_ERROR_FIELDS = Object.freeze({
  AMOUNT_INVALID: 'amount',
  VOUCHER_AMOUNT_OUT_OF_BOUNDS: 'amount',
  EMAIL_INVALID: 'email',
  PAYMENT_METHOD_INVALID: 'method',
  DATE_INVALID: 'date',
  DATE_IN_FUTURE: 'date',
  FIELD_INVALID: 'message',
});

export const SETTINGS_TEXTS = Object.freeze({
  title: 'Bons cadeaux',
  saved: 'Réglages enregistrés.',
  loadError: 'Les réglages n’ont pas pu être chargés.',
  validity: { title: 'Validité et montants', months: 'Validité (mois)', min: 'Montant minimal (€)', max: 'Montant maximal (€)' },
  pages: {
    title: 'Adresses',
    pageUrl: 'Page du bon sur le site',
    pageUrlHelp: 'L’adresse que le mail du bon ouvre.',
    bookingUrl: 'Page de réservation',
    bookingUrlHelp: 'L’adresse du code QR du PDF.',
  },
  ideas: {
    title: 'Idées de séjour',
    help: 'Chaque idée est un séjour chiffré au tarif en vigueur : jamais un montant libre.',
    label: 'Libellé', property: 'Logement', nights: 'Nuits', guests: 'Personnes', add: 'Ajouter une idée', remove: 'Retirer cette idée', empty: 'Aucune idée.',
  },
  mail: {
    title: 'Mail du bon',
    help: 'Mots disponibles : {amount}, {expiry}, {link}, {recipientName}, {senderName}, {number}.',
    subjectFr: 'Objet (français)', bodyFr: 'Message (français)', subjectEn: 'Objet (anglais)', bodyEn: 'Message (anglais)',
  },
});
