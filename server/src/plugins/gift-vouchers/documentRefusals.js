/** The refusals of `documents.js`, in the operator's words: `[status, sentence]` by code, shared by the controllers that serve a PDF. */

const DOCUMENT_REFUSALS = Object.freeze({
  NO_SITE_ORIGIN: [409, 'L’adresse du site web (code QR et lien imprimés sur la carte) est à renseigner dans les réglages.'],
  NO_MERCHANT_VISUAL: [409, 'Cette campagne n’a pas de visuel pour la carte du commerçant : en choisir un d’abord.'],
  CAMPAIGN_NO_SLUG: [409, 'Cette campagne n’a pas de lien permanent : en définir un d’abord.'],
  CODE_UNREADABLE: [409, 'Le code ne peut plus être relu : la clé de chiffrement a changé.'],
});

module.exports = { DOCUMENT_REFUSALS };
