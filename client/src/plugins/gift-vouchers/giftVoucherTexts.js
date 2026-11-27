// French copy and presentation maps of the « Bons cadeaux » screens (specs/gift-vouchers/gift-vouchers.md §6). The server decides each
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
  campaignFilter: 'Campagne',
  kindFilter: 'Type',
  allCampaigns: 'Toutes',
  kinds: Object.freeze([{ value: '', label: 'Tous' }, { value: 'lodging', label: 'Séjour' }, { value: 'resource', label: 'Composé' }]),
  columns: {
    number: 'Bon', campaign: 'Campagne', contents: 'Contenu', from: 'De la part de', to: 'Pour', issued: 'Émis le', state: 'État', balance: 'Solde', expiry: 'Expire le', usedOn: 'Utilisé le',
  },
  openBooking: 'Ouvrir la fiche',
  detail: {
    code: 'Code', reveal: 'Afficher le code', hide: 'Masquer le code', expiry: 'Valable jusqu’au', balance: 'Solde',
    from: 'De la part de', to: 'Pour', email: 'E-mail', vat: 'TVA', message: 'Message', movements: 'Mouvements', close: 'Fermer',
    resend: 'Renvoyer le mail', pdf: 'Télécharger le bon', print: 'Imprimer…', printTitle: 'Imprimer le bon', extend: 'Prolonger', cancel: 'Annuler le bon', adjust: 'Corriger le solde',
    campaign: 'Campagne', contents: 'Contenu', oneShot: 'Bon sur mesure', unused: 'Part non utilisée', usedOn: 'Utilisé le', booking: 'Fiche du passage',
    notDownloadable: 'Ce bon est utilisé, expiré ou annulé : il ne peut plus être téléchargé ni renvoyé.',
    cancelNotAllowed: 'Ce bon a déjà servi : il ne peut plus être annulé.',
    refundDue: (amount) => `À rembourser ${amount}`, refundSettle: 'Marquer remboursé', refundSettled: 'Remboursement marqué comme effectué.',
    refundDone: (amount, day) => `${amount} remboursés le ${day}`, noRefund: 'Aucun remboursement : bon offert.',
    cancelReason: 'Motif de l’annulation',
    forcedCancel: 'Annulé après le délai de rétractation',
    noEmail: 'Aucune adresse e-mail sur ce bon.',
    mailError: 'Dernier envoi en échec.',
    resent: 'Mail renvoyé.', downloaded: 'Bon téléchargé.', extended: 'Validité prolongée.', cancelled: 'Bon annulé.', adjusted: 'Solde corrigé.',
  },
  cancelDialog: {
    title: 'Annuler ce bon ?',
    message: (number, amount) => `Le bon ${number} ne pourra plus servir. ${amount} sont à rembourser.`,
    messageOffered: (number) => `Le bon ${number} ne pourra plus servir.`,
    confirm: 'Annuler le bon', keep: 'Garder',
    forcedTitle: 'Annuler après le délai de rétractation ?',
    forcedMessage: (number, endsOn, amount) => `Le délai de rétractation de 14 jours s’est terminé le ${endsOn}. Annuler le bon ${number} est un geste commercial : ${amount} sont à rembourser.`,
    forcedMessageOffered: (number, endsOn) => `Le délai de rétractation de 14 jours s’est terminé le ${endsOn}. Annuler le bon ${number} est un geste commercial.`,
    reason: 'Motif', reasonRequired: 'Un motif est demandé.', forcedConfirm: 'Annuler quand même',
  },
  resendDialog: {
    title: 'Renvoyer le mail', email: 'Autre adresse e-mail (facultatif)', help: 'Sans adresse saisie, le mail repart à l’adresse de l’offreur.', submit: 'Renvoyer',
  },
  // The fiche's card (rules 40-41): short, impersonal.
  stayCard: {
    title: 'Bon cadeau',
    owed: (amount) => `Reste à payer : ${amount}.`,
    codeLabel: 'Code du bon',
    amountLabel: 'Montant (€)',
    pay: 'Payer par bon cadeau',
    paid: 'Paiement par bon cadeau enregistré.',
    payFailed: 'Le paiement n’a pas pu être enregistré.',
    codeRequired: 'Le code du bon est attendu.',
    amountInvalid: 'Montant invalide.',
    amountAbove: (owed) => `Au plus ${owed}.`,
    undo: 'Annuler',
    undoTitle: 'Annuler le paiement par bon cadeau',
    undoMessage: (amount) => `${amount} retournent sur le bon et le montant reçu est retiré du séjour.`,
    undoConfirm: 'Annuler le paiement',
    undone: 'Paiement par bon cadeau annulé.',
    undoFailed: 'Le paiement n’a pas pu être annulé.',
    recreditOffer: (amount, total) => `${amount} sur ${total} payés par bon cadeau peuvent retourner sur le bon. Jamais un remboursement en argent.`,
    recreditNone: 'L’indemnité d’annulation retient toute la part payée par bon cadeau.',
    recredit: 'Recréditer le bon',
    recredited: 'Bon recrédité.',
    recreditFailed: 'Le bon n’a pas pu être recrédité.',
  },
  extendDialog: { title: 'Prolonger la validité', date: 'Nouvelle date de fin', submit: 'Prolonger' },
  adjustDialog: {
    title: 'Corriger le solde', amount: 'Montant (+ ou −)', amountHelp: 'Positif pour ajouter, négatif pour retirer.', reason: 'Motif', submit: 'Corriger',
  },
});

export const SETTINGS_TEXTS = Object.freeze({
  title: 'Bons cadeaux',
  saved: 'Réglages enregistrés.',
  loadError: 'Les réglages n’ont pas pu être chargés.',
  pages: {
    title: 'Adresses',
    pageUrl: 'Page du bon sur le site',
    pageUrlHelp: 'L’adresse que le mail du bon ouvre.',
    linkBase: 'Base des liens permanents',
    linkBaseHelp: 'Premier segment des deux liens imprimés sur les cartes : /bon-cadeau/offrir/… et /bon-cadeau/utiliser.',
  },
  drink: {
    title: 'Créneau moins cher que le bon',
    label: 'Boisson offerte sur l’écart',
    none: 'Aucune : l’écart est seulement noté sur le bon',
    pending: 'Option enregistrée',
    deleted: 'Option supprimée du catalogue',
    notGivable: 'Cette option n’est plus vendable hors séjour : aucune boisson ne sera offerte tant qu’elle n’est pas remplacée.',
    help: 'Quand le bénéficiaire choisit un créneau qui coûte moins que son bon, une boisson de cette option lui est offerte, sans autre contrepartie.',
  },
});

// Lodging fields of a campaign (specs/gift-vouchers/gift-voucher-campaigns.md rule 3): the amount bounds, the VAT rate and the price ideas moved here from the settings.
export const LODGING_TEXTS = Object.freeze({
  title: 'Montant libre',
  help: 'Bornes du montant, TVA et idées de séjour du bon séjour.',
  min: 'Montant minimal (€)', max: 'Montant maximal (€)',
  vat: {
    rate: 'TVA des bons cadeaux', unit: '%', help: 'S’applique aux bons vendus à partir de l’enregistrement. Un bon déjà vendu garde son taux.',
    empty: 'Saisir un taux (0 si les bons ne portent pas de TVA).', notNumber: 'Saisir un nombre, par exemple 10 ou 5,5.',
    decimals: 'Deux décimales au plus.', range: 'Saisir un taux entre 0 et 100 %.',
  },
  ideas: {
    title: 'Idées de séjour',
    help: 'Chaque idée est un séjour chiffré au tarif en vigueur : jamais un montant libre.',
    label: 'Libellé', property: 'Logement', nights: 'Nuits', guests: 'Personnes', add: 'Ajouter une idée', remove: 'Retirer cette idée', empty: 'Aucune idée.',
  },
});

export const CAMPAIGN_STATES = Object.freeze({
  draft: { label: 'Brouillon', status: 'neutral' },
  on_sale: { label: 'En vente', status: 'success' },
  closed: { label: 'Fermée', status: 'warning' },
});

export const CAMPAIGN_KINDS = Object.freeze({ lodging: 'Montant libre', resource: 'Composé' });

// The validity menu (week-weekend-and-print spec rule 13) and the periods of a bath voucher (rule 10): the words only, the server judges.
export const VALIDITY_CHOICES = Object.freeze([3, 6, 12, 18, 24]);
export const PERIOD_LABELS = Object.freeze({ week: 'Semaine', weekend: 'Week-end' });

export const CAMPAIGN_TEXTS = Object.freeze({
  title: 'Campagnes',
  newCampaign: 'Nouvelle campagne',
  importRecipe: 'Importer une recette',
  imported: 'Recette importée en brouillon.',
  importFailed: 'La recette n’a pas pu être importée.',
  importRefused: 'Recette refusée, rien n’est écrit :',
  empty: 'Aucune campagne pour le moment.',
  loadError: 'Les campagnes n’ont pas pu être chargées.',
  notPriced: 'Non proposée : ',
  columns: { name: 'Campagne', state: 'État', kind: 'Type', validity: 'Validité', contents: 'Contenu' },
  months: (n) => `${n} mois`,
  editor: {
    newTitle: 'Nouvelle campagne',
    loadError: 'La campagne n’a pas pu être chargée.',
    saved: 'Campagne enregistrée.',
    duplicate: 'Dupliquer', duplicated: 'Copie créée en brouillon.',
    exportRecipe: 'Exporter la recette',
    general: 'Général', name: 'Nom (interne)', publicTitle: 'Titre public', publicTitleHelp: 'Sur le site et au dos du bon.', state: 'État', validity: 'Validité', kind: 'Type',
    periods: 'Périodes proposées', periodsHelp: 'Le donateur choisit la semaine ou le week-end ; chaque période a son prix.', previewNoPeriod: 'Aucune période n’est cochée : le bon ne peut pas se vendre.', previewPeriod: (label) => `Prix · ${label}`,
    content: 'Contenu', addOns: 'Options proposées', addOnsLabel: 'Options à proposer', addOnsHelp: 'Proposées à l’offreur et au destinataire en plus du contenu.',
    extraTime: 'Temps en plus', extraTimeOffered: 'Proposer du temps en plus', extraTimeMax: 'Temps en plus au maximum (min)',
    visuals: 'Visuels', voucherFront: 'Recto du bon', merchantFront: 'Recto de la carte commerçant (facultatif)', noVisual: 'Aucun',
    addVisual: 'Ajouter un visuel', visualsNote: 'À choisir dans la bibliothèque. JPEG ou PNG, A6 portrait, 1240 × 1748 px au minimum. Les versos sont dessinés par GuestFlow.',
    links: 'Liens permanents', slug: 'Identifiant du lien', slugLocked: 'Verrouillé : une carte du commerçant a été imprimée avec ce lien.',
    linkOffer: 'Acheter', linkUse: 'Utiliser', linkNone: 'Le lien d’achat apparaît avec l’identifiant.',
    downloads: 'Téléchargements', merchantCard: 'Carte commerçant (PDF imprimeur)', merchantCardNote: 'A6 recto verso, fonds perdus 3 mm, traits de coupe, image à sa résolution d’origine.',
    print: 'Imprimer…', printTitle: 'Imprimer des cartes commerçant', priceOfTheDay: 'Le prix est celui du jour de l’impression.',
    frontPrice: 'Position du prix', frontPriceHelp: 'Sur le recto de la carte commerçant : « à partir de » et le prix le plus bas de la campagne.',
    frontPriceOptions: Object.freeze([{ value: 'bottom-right', label: 'En bas à droite' }, { value: 'bottom-left', label: 'En bas à gauche' }, { value: 'top-right', label: 'En haut à droite' }, { value: 'top-left', label: 'En haut à gauche' }, { value: 'none', label: 'Aucun' }]),
    merchantCardDone: 'Carte commerçant téléchargée.', downloadFailed: 'Le téléchargement n’a pas abouti.',
    preview: 'Prix calculé', previewLodging: 'Montant libre : le prix est celui que choisit l’offreur.', previewIdle: 'Choisir une ressource pour voir le prix.',
    previewFailed: 'Prix indisponible.', vatIncluded: (rate) => `dont TVA ${rate} %`, total: 'Total',
    states: Object.freeze([{ value: 'draft', label: 'Brouillon' }, { value: 'on_sale', label: 'En vente' }, { value: 'closed', label: 'Fermée' }]),
    kinds: Object.freeze([{ value: 'resource', label: 'Composé (ressource et options)' }, { value: 'lodging', label: 'Montant libre (séjour)' }]),
    notPriceable: 'Cette campagne n’est pas proposée tant que le prix ne peut pas être calculé : ',
    withdrawn: (items) => `${items.length > 1 ? 'Retirées' : 'Retirée'} de l’offre : ${items.map((w) => `« ${w.label} » — ${w.reason}`).join(' ; ')} ${items.length > 1 ? 'Les retirer' : 'La retirer'} de la campagne pour pouvoir l’enregistrer.`,
  },
});

export const COMPOSITION_TEXTS = Object.freeze({
  title: 'Contenu du bon',
  add: 'Ajouter un élément',
  empty: 'Aucun élément. Un bon comprend une ressource à l’heure et des options.',
  pickerTitle: 'Ajouter un élément',
  search: 'Rechercher',
  noResult: 'Aucun élément ne correspond.',
  resourcesGroup: 'Ressources à l’heure', optionsGroup: 'Options',
  secondResource: 'Un bon comprend une seule ressource à l’heure.',
  modes: 'Tranche', minutes: 'Temps inclus (min)', minutesHelp: (step, minimum) => `Par tranches de ${step} min, ${minimum} min au minimum.`,
  perHour: '/ h', hours: (from, to) => `de ${from} à ${to}`,
  quantity: 'Quantité', remove: 'Retirer', close: 'Fermer', loadError: 'Le catalogue n’a pas pu être chargé.',
  addOnsPlaceholder: 'Ajouter une option',
});

export const VISUAL_TEXTS = Object.freeze({
  title: 'Visuels',
  add: 'Ajouter un visuel',
  empty: 'Aucun visuel dans la bibliothèque.',
  loadError: 'Les visuels n’ont pas pu être chargés.',
  note: 'Un visuel retiré de la bibliothèque reste conservé tant qu’un bon valide non utilisé le porte : son PDF se télécharge et son mail se renvoie.',
  name: 'Nom', use: 'Usage', image: 'Image',
  uses: Object.freeze([
    { value: 'voucher', label: 'Recto du bon' }, { value: 'merchant', label: 'Recto de la carte commerçant' }, { value: 'both', label: 'Les deux' },
  ]),
  campaigns: 'Campagnes', validVouchers: 'Bons valides', none: 'Aucune',
  save: 'Enregistrer', cancel: 'Annuler', created: 'Visuel ajouté.', renamed: 'Visuel enregistré.', deleted: 'Visuel retiré de la bibliothèque.',
  rename: 'Renommer', replace: 'Remplacer l’image', replaceNote: 'Les bons déjà émis gardent leur version.',
  delete: 'Retirer', deleteTitle: 'Retirer ce visuel ?', deleteMessage: (name) => `« ${name} » quitte la bibliothèque. Les bons déjà émis le gardent.`,
  versions: (n) => `${n} versions`,
  dropLabel: 'Déposer une image ou toucher pour choisir', dropHelp: 'JPEG ou PNG, A6 portrait, 1240 × 1748 px au minimum.',
});

export const NEW_VOUCHER_TEXTS = Object.freeze({
  title: 'Nouveau bon',
  loadError: 'L’offre n’a pas pu être chargée.',
  steps: { offer: '1 · Offre', who: '2 · Pour qui', outcome: '3 · Issue' },
  custom: 'Sur mesure', customHelp: 'Un bon composé pour ce client seul, hors des campagnes.',
  amount: 'Montant (€)', amountRange: (min, max) => `de ${min} à ${max}`,
  ideas: 'Idées',
  validity: 'Validité', period: 'Période', periodFact: (label) => `Période : ${label}`, validUntil: (date) => `Valable jusqu’au ${date}`, visual: 'Visuel', noVisual: 'Aucun', addVisual: 'Ajouter un visuel',
  extraTime: 'Temps en plus', addOns: 'Options', quantity: 'Quantité',
  extras: {
    title: 'Ajouter au bon',
    ariaLabel: (n) => `Ajouter au bon${n ? `, ${n} choisi${n > 1 ? 's' : ''}` : ''}`,
    minutes: 'Minutes',
    available: (n, from) => `${n} disponible${n > 1 ? 's' : ''} · dès ${from}`,
    each: (price, unit) => `${price} ${unit}`,
    extraTimeStep: (price, step) => `${price} par tranche de ${step}`,
    lineTotal: (qty, unit, total) => `${qty} × ${unit} = ${total}`,
    progressiveTotal: (qty, total) => `${qty} : ${total}`,
    extraTimeTotal: (time, total) => `+${time} = ${total}`,
    extraTimeOnly: (time) => `+${time}`,
    max: (value) => `${value} au maximum par bon`,
    foot: 'Prix TTC, ajoutés au montant du bon.',
    pending: '…',
  },
  offeredAddOns: 'Options proposées au destinataire', offeredExtra: 'Temps en plus proposé au destinataire (min)',
  recipientFirstName: 'Prénom', recipientLastName: 'Nom', sender: 'De la part de', message: 'Message (facultatif)', email: 'E-mail de l’offreur', emailOptional: '(facultatif)', emailRequired: 'Une adresse e-mail est demandée pour envoyer le lien.',
  outcomes: { paid: 'Payé', offered: 'Offert', link: 'Envoyer un lien de paiement' },
  method: 'Moyen de paiement', date: 'Date de vente',
  offeredNote: 'Offert par l’établissement. Aucune vente ni TVA enregistrée, aucun remboursement possible.',
  linkNote: 'Le lien, valable 1 h, part au clic. Une fois payé, le bon est émis et envoyé. Sans paiement, rien n’est créé.',
  recap: 'Récapitulatif', total: 'Total', vatIncluded: (rate) => `dont TVA ${rate} %`, recapIdle: 'Compléter l’offre pour voir le prix.', recapFailed: 'Prix indisponible.',
  submit: 'Créer le bon', submitLink: 'Envoyer le lien',
  created: 'Bon créé.', linkSent: (email) => `Lien de paiement envoyé à ${email}.`,
  failed: 'Le bon n’a pas pu être créé.',
  noCampaign: 'Aucune campagne en vente. « Sur mesure » reste possible.',
  omitted: 'Non proposée : ',
});

// A server refusal of « Nouveau bon » names a field of the page; the message is shown on it.
export const NEW_VOUCHER_ERROR_FIELDS = Object.freeze({
  AMOUNT_INVALID: 'amount',
  VOUCHER_AMOUNT_OUT_OF_BOUNDS: 'amount',
  EMAIL_INVALID: 'email',
  RECIPIENT_FIRST_NAME_REQUIRED: 'recipientFirstName',
  RECIPIENT_LAST_NAME_REQUIRED: 'recipientLastName',
  PAYMENT_METHOD_INVALID: 'method',
  DATE_INVALID: 'date',
  DATE_IN_FUTURE: 'date',
  FIELD_INVALID: 'message',
  EXTRA_TIME_INVALID: 'extraMinutes',
  EXTRA_TIME_NOT_OFFERED: 'extraMinutes',
  ADDONS_INVALID: 'addOns',
  ADDON_NOT_OFFERED: 'addOns',
  ADDON_QTY_INVALID: 'addOns',
  ADDON_DUPLICATE: 'addOns',
  PERIOD_REQUIRED: 'period',
  PERIOD_NOT_OFFERED: 'period',
  VALIDITY_INVALID: 'validityMonths',
});
