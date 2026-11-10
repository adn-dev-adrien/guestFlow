/**
 * The refusals of the guest API, in the guest's language (specs/guest-app.md rules 19 and 56, audit R36-PUB-L1): the
 * `code` never moves — the app branches on it — and the `message` follows the request's language, as the public API's
 * own envelope does (`publicHttp`, specs/site-english-version.md rule 8). A refusal is `{ status, code, key, params }`;
 * its words are looked up here when it is answered.
 */

const sdk = require('../sdk');
const { languageOf } = require('./language');

const publicHttp = sdk.coreModule('publicHttp');

const TEXTS = Object.freeze({
  fr: Object.freeze({
    unknownCode: 'Ce code n’est pas reconnu.',
    stayNotFound: 'Nous n’avons pas trouvé ce séjour. Vérifiez le nom et le numéro.',
    sessionExpired: 'Votre session a expiré.',
    stayRequired: 'Cette action demande un séjour en cours.',
    moduleOff: 'Ce service n’est pas proposé dans ce logement.',
    pageNotFound: 'Cette page n’existe pas dans ce livret.',
    searchRequired: 'Saisissez une recherche.',
    searchLength: ({ min, max }) => `La recherche fait de ${min} à ${max} caractères.`,
    invalidId: 'Identifiant invalide.',
    invalidDate: 'Date invalide.',
    itemNotFound: 'Cet article n’est pas proposé.',
    invalidRequest: 'Requête invalide.',
    invalidCart: 'Le panier est invalide.',
    emptyCart: 'Le panier est vide.',
    invalidLine: 'Un article du panier est invalide.',
    invalidMornings: 'Les matins choisis sont invalides.',
    invalidTime: 'L’heure choisie est invalide.',
    invalidPersons: 'Le nombre de personnes est invalide.',
    invalidSlot: 'Un créneau est invalide.',
    slotNoQuantity: 'Un créneau ne prend pas de quantité.',
    invalidQuantity: 'Une quantité est invalide.',
    duplicateLine: 'Un article apparaît deux fois dans le panier.',
    invalidDeliverAt: 'L’heure de livraison est invalide.',
    invalidPayment: 'Le mode de paiement est invalide.',
    maxSessions: ({ max }) => `${max} créneaux au plus par article.`,
    maxLines: ({ max }) => `${max} articles au plus par commande.`,
    maxQuantity: ({ max, title }) => `${max} au plus pour « ${title} ».`,
    maxTotal: ({ amount }) => `Une commande ne dépasse pas ${amount}.`,
    personsOverParty: 'Le nombre de personnes dépasse celui du séjour.',
    personsLeft: ({ left, title }) => `${left} personne${left > 1 ? 's' : ''} au plus pour « ${title} ».`,
    personsNone: ({ title }) => `« ${title} » sert déjà toutes les personnes du séjour.`,
    breakfastPersons: ({ left }) => `Le petit-déjeuner du séjour est prévu pour ${left} personne${left > 1 ? 's' : ''}.`,
    chooseSlot: 'Choisissez un créneau.',
    notOnSlot: 'Cet article ne se réserve pas sur un créneau.',
    shopClosed: 'La boutique est fermée pour ce séjour.',
    slotJustTaken: 'Ce créneau vient d’être pris.',
    stayNotWritable: 'Commande impossible pour ce séjour : contactez l’équipe.',
    orderInProgress: 'Cette commande est en cours d’enregistrement.',
    orderKeySpent: 'Cette commande n’est plus en attente de paiement : recommencez la commande.',
    cardUnavailable: 'Le paiement par carte est indisponible.',
    slotGone: 'Un créneau n’est plus disponible.',
    itemGone: 'Un article n’est plus disponible.',
    itemNotBillable: ({ title }) => `« ${title} » ne se commande pas dans l’application pour ce séjour : contactez l’équipe.`,
    deliveryGone: 'Cette heure de livraison n’est plus possible.',
    chooseDelivery: 'Choisissez une heure de livraison.',
    choosePayment: 'Choisissez un mode de paiement.',
    cardPending: 'Une commande attend déjà son paiement : reprenez-la ou abandonnez-la dans « Mes commandes ».',
    cardToNote: 'Le paiement par carte est indisponible : ajoutez la commande à votre note.',
    orderNotFound: 'Commande introuvable.',
    orderNotPending: 'Cette commande n’attend plus de paiement.',
    tooManyRequests: 'Trop de requêtes, réessayez plus tard.',
    tooManyAttempts: 'Trop de tentatives, réessayez plus tard.',
    tooManyOrders: 'Trop de commandes en une heure, réessayez plus tard.',
    tooManyCardOrders: 'Trop de paiements par carte pour ce séjour en une heure : ajoutez la commande à votre note.',
  }),
  en: Object.freeze({
    unknownCode: 'This code is not recognised.',
    stayNotFound: 'We could not find this stay. Check the name and the number.',
    sessionExpired: 'Your session has expired.',
    stayRequired: 'This needs a stay in progress.',
    moduleOff: 'This service is not offered in this lodging.',
    pageNotFound: 'This page is not in this booklet.',
    searchRequired: 'Type something to search.',
    searchLength: ({ min, max }) => `A search is ${min} to ${max} characters long.`,
    invalidId: 'Invalid id.',
    invalidDate: 'Invalid date.',
    itemNotFound: 'This item is not offered.',
    invalidRequest: 'Invalid request.',
    invalidCart: 'The basket is invalid.',
    emptyCart: 'The basket is empty.',
    invalidLine: 'An item of the basket is invalid.',
    invalidMornings: 'The mornings chosen are invalid.',
    invalidTime: 'The time chosen is invalid.',
    invalidPersons: 'The number of people is invalid.',
    invalidSlot: 'A slot is invalid.',
    slotNoQuantity: 'A slot takes no quantity.',
    invalidQuantity: 'A quantity is invalid.',
    duplicateLine: 'An item appears twice in the basket.',
    invalidDeliverAt: 'The delivery time is invalid.',
    invalidPayment: 'The payment method is invalid.',
    maxSessions: ({ max }) => `At most ${max} slots per item.`,
    maxLines: ({ max }) => `At most ${max} items per order.`,
    maxQuantity: ({ max, title }) => `At most ${max} for “${title}”.`,
    maxTotal: ({ amount }) => `An order is at most ${amount}.`,
    personsOverParty: 'The number of people is above the stay’s.',
    personsLeft: ({ left, title }) => `At most ${left} ${left > 1 ? 'people' : 'person'} for “${title}”.`,
    personsNone: ({ title }) => `“${title}” already serves everyone in the stay.`,
    breakfastPersons: ({ left }) => `The stay’s breakfast is planned for ${left} ${left > 1 ? 'people' : 'person'}.`,
    chooseSlot: 'Choose a slot.',
    notOnSlot: 'This item is not booked on a slot.',
    shopClosed: 'The shop is closed for this stay.',
    slotJustTaken: 'This slot was just taken.',
    stayNotWritable: 'This stay cannot take an order: contact the team.',
    orderInProgress: 'This order is being recorded.',
    orderKeySpent: 'This order no longer awaits its payment: start the order again.',
    cardUnavailable: 'Card payment is unavailable.',
    slotGone: 'A slot is no longer available.',
    itemGone: 'An item is no longer available.',
    itemNotBillable: ({ title }) => `“${title}” cannot be ordered in the app for this stay: contact the team.`,
    deliveryGone: 'This delivery time is no longer possible.',
    chooseDelivery: 'Choose a delivery time.',
    choosePayment: 'Choose a payment method.',
    cardPending: 'An order already awaits its payment: resume it or abandon it in “My orders”.',
    cardToNote: 'Card payment is unavailable: add the order to your bill.',
    orderNotFound: 'Order not found.',
    orderNotPending: 'This order no longer awaits a payment.',
    tooManyRequests: 'Too many requests, try again later.',
    tooManyAttempts: 'Too many attempts, try again later.',
    tooManyOrders: 'Too many orders in an hour, try again later.',
    tooManyCardOrders: 'Too many card payments for this stay in an hour: add the order to your bill.',
  }),
});

const refusal = (status, code, key, params) => ({
  status, code, key, ...(params ? { params } : {}),
});

/** The words of a refusal key in a language; a key no table holds is a programming error, said loudly. */
function textOf(key, lang, params = {}) {
  const table = TEXTS[lang] || TEXTS.fr;
  const entry = table[key];
  if (entry === undefined) throw new Error(`guest-app refusal without words: ${key}`);
  return typeof entry === 'function' ? entry(params) : entry;
}

/** The language of the request a response answers. */
const langOfResponse = (res) => {
  const req = res.req;
  return languageOf(req, req && req.guest && req.guest.stay);
};

/** A refusal answered in the request's language. `details`: a list of field errors, or an object (the units left, a quote). */
function fail(res, { status, code, key, params, message }, details) {
  const text = message || textOf(key, langOfResponse(res), params);
  if (details && !Array.isArray(details)) return res.status(status).json({ error: { code, message: text, details } });
  return publicHttp.fail(res, status, code, text, details);
}

module.exports = {
  TEXTS, fail, refusal, textOf,
};
