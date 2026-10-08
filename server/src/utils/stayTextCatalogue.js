/**
 * Stay texts — the sentences of the guest email sequence, as data (specs/plugins-phase-p-productisation.md
 * §3.A rules 1–6).
 *
 * The code decides WHETHER a text appears and fills its tokens; the wording is the operator's, stored
 * in `stay_texts`, and falls back to the neutral default below. A text may use its tokens as
 * `{{token}}` and its flags — or any of its tokens, read as a flag — as `{{#if flag}}…{{else}}…{{/if}}`,
 * the email renderer's grammar. An empty text means « no paragraph ».
 *
 * Every price-bearing text also gets the flag `hasPrice` (the amount is above zero), so a neutral
 * default never shows « (0 €) ».
 */

const { renderTemplate } = require('./emailTemplateRenderer');

const MAILS = Object.freeze({ J7: 'J-7', J2: 'J-2', J1: 'J+1', SEASON: 'Novembre' });

/* eslint-disable max-len */
const CATALOGUE = Object.freeze([
  { key: 'beds.made', email: MAILS.J7, label: 'Lits préparés', tokens: ['bedConfig'], flags: [],
    fr: 'Nous préparerons les lits ainsi : {{bedConfig}}.',
    en: 'We will make up the beds as follows: {{bedConfig}}.' },
  { key: 'beds.linenNotIncluded', email: MAILS.J7, label: 'Lits à faire soi-même', tokens: ['bedConfig', 'price'], flags: ['linenOffered', 'hasPrice'],
    fr: 'Les lits seront installés ainsi : {{bedConfig}}. Le linge de lit n\'est pas compris : pensez à prendre draps et taies d\'oreiller{{#if linenOffered}}, ou demandez-nous de les préparer{{/if}}.',
    en: 'The beds will be set up as follows: {{bedConfig}}. Bed linen is not included: remember to bring sheets and pillowcases{{#if linenOffered}}, or ask us to prepare them{{/if}}.' },
  { key: 'baby.booked', email: MAILS.J7, label: 'Lit bébé réservé', tokens: [], flags: [],
    fr: 'Le lit bébé sera installé avant votre arrivée.',
    en: 'The baby cot will be set up before you arrive.' },
  { key: 'baby.offer', email: MAILS.J7, label: 'Lit bébé à proposer', tokens: ['price'], flags: ['hasPrice'],
    fr: 'Un lit bébé peut être installé sur demande{{#if hasPrice}} ({{price}} pour le séjour){{/if}}.',
    en: 'A baby cot can be set up on request{{#if hasPrice}} ({{price}} for the stay){{/if}}.' },
  { key: 'bag.items', email: MAILS.J7, label: 'À emporter', tokens: [], flags: ['stayOverlapsPool'],
    fr: '- Des chaussures confortables pour les balades{{#if stayOverlapsPool}}\n- Maillots de bain et serviettes pour la piscine{{/if}}',
    en: '- Comfortable shoes for walks{{#if stayOverlapsPool}}\n- Swimsuits and towels for the pool{{/if}}' },
  { key: 'bag.towels', email: MAILS.J7, label: 'Serviettes à emporter', tokens: [], flags: [],
    fr: '- Vos serviettes de toilette',
    en: '- Your bath towels' },
  { key: 'bag.towelsOffer', email: MAILS.J7, label: 'Serviettes à proposer', tokens: ['price'], flags: ['hasPrice'],
    fr: '- Vos serviettes de toilette, ou demandez-nous de les préparer{{#if hasPrice}} ({{price}} par personne){{/if}}.',
    en: '- Your bath towels, or ask us to prepare them{{#if hasPrice}} ({{price}} per person){{/if}}.' },
  { key: 'travelLight', email: MAILS.J7, label: 'Parking éloigné — conseil bagages', tokens: ['distance', 'propertyFrom', 'propertyName'], flags: [], overridable: true,
    fr: 'Le parking se trouve à {{distance}} mètres {{propertyFrom}} : prévoyez des bagages faciles à porter.',
    en: 'The car park is {{distance}} metres from {{propertyName}}: pack bags that are easy to carry.' },
  { key: 'noWifi', email: MAILS.J7, label: 'Pas de wifi', tokens: ['PropertyWith', 'propertyName'], flags: [], overridable: true,
    fr: '{{PropertyWith}}, il n\'y a pas de wifi.',
    en: 'There is no wifi at {{propertyName}}.' },
  { key: 'offers.localIntro', email: MAILS.J7, label: 'Produits locaux — introduction', tokens: ['list'], flags: [],
    fr: 'Pour alléger les courses, nous pouvons vous proposer {{list}}.',
    en: 'To lighten your shopping, we can offer {{list}}.' },
  { key: 'offers.extrasIntro', email: MAILS.J7, label: 'À prévoir — introduction', tokens: ['list'], flags: [],
    fr: 'Pour alléger les courses, nous pouvons prévoir {{list}}.',
    en: 'To lighten your shopping, we can arrange {{list}}.' },
  { key: 'offers.extrasAfterLocal', email: MAILS.J7, label: 'À prévoir — après les produits locaux', tokens: ['list'], flags: [],
    fr: 'Nous pouvons aussi prévoir {{list}}.',
    en: 'We can also arrange {{list}}.' },
  { key: 'offers.deadline', email: MAILS.J7, label: 'Date limite des demandes', tokens: ['date'], flags: [],
    fr: 'Il suffit de nous le dire d\'ici le {{date}}.',
    en: 'Just let us know by {{date}}.' },
  { key: 'parkingLine', email: MAILS.J2, label: 'Parking éloigné — accès', tokens: ['distance', 'propertyFrom', 'propertyName'], flags: [], overridable: true,
    fr: '- Garez-vous au parking, à {{distance}} mètres {{propertyFrom}}.',
    en: '- Park in the car park, {{distance}} metres from {{propertyName}}.' },
  { key: 'house', email: MAILS.J2, label: 'Dans le logement', tokens: [], flags: [], overridable: true,
    fr: '',
    en: '' },
  { key: 'cleaning.included', email: MAILS.J2, label: 'Ménage compris', tokens: [], flags: [],
    fr: 'Le ménage de fin de séjour est compris.',
    en: 'End-of-stay cleaning is included.' },
  { key: 'cleaning.booked', email: MAILS.J2, label: 'Ménage réservé', tokens: [], flags: [],
    fr: 'Vous avez choisi l\'option ménage : nous nous occupons du reste.',
    en: 'You chose the cleaning option: we take care of the rest.' },
  { key: 'cleaning.notBooked', email: MAILS.J2, label: 'Ménage non réservé', tokens: [], flags: [],
    fr: 'Le ménage de fin de séjour n\'est pas compris : merci de rendre le logement comme vous l\'avez trouvé.',
    en: 'End-of-stay cleaning is not included: please leave the accommodation as you found it.' },
  { key: 'complement.atArrival', email: MAILS.J2, label: 'Complément à l\'arrivée', tokens: ['amount'], flags: [],
    fr: 'Un complément de {{amount}} reste à régler sur place à votre arrivée.',
    en: 'A balance of {{amount}} remains to be paid on site when you arrive.' },
  { key: 'complement.atDeparture', email: MAILS.J2, label: 'Complément au départ', tokens: ['amount'], flags: [],
    fr: 'Un complément de {{amount}} reste à régler sur place à votre départ.',
    en: 'A balance of {{amount}} remains to be paid on site when you leave.' },
  { key: 'booked.babyBed', email: MAILS.J2, label: 'Confirmation — lit bébé', tokens: [], flags: [],
    fr: 'Le lit bébé sera installé avant votre arrivée.',
    en: 'The baby cot will be set up before you arrive.' },
  { key: 'booked.towels', email: MAILS.J2, label: 'Confirmation — serviettes', tokens: [], flags: [],
    fr: 'Vos serviettes de toilette seront prêtes.',
    en: 'Your bath towels will be ready.' },
  { key: 'review.direct', email: MAILS.J1, label: 'Avis — réservation directe', tokens: ['link'], flags: [],
    fr: 'Si vous en avez envie, quelques mots sur notre page Google nous aideraient beaucoup : {{link}}.',
    en: 'If you feel like it, a few words on our Google page would help us a lot: {{link}}.' },
  { key: 'review.platform', email: MAILS.J1, label: 'Avis — plateforme', tokens: ['platform', 'link'], flags: ['hasGoogleReview'],
    fr: 'Si ce n\'est pas déjà fait, quelques mots sur {{platform}} nous aideraient beaucoup.{{#if hasGoogleReview}} Votre avis est aussi le bienvenu sur notre page Google : {{link}}{{/if}}',
    en: 'If you have not done so already, a few words on {{platform}} would help us a lot.{{#if hasGoogleReview}} Your review is also welcome on our Google page: {{link}}{{/if}}' },
  { key: 'instagram', email: MAILS.J1, label: 'Réseaux sociaux', tokens: ['link'], flags: [],
    fr: 'Pour suivre nos nouvelles : {{link}}',
    en: 'To follow our news: {{link}}' },
  { key: 'quietSinceDeparture', email: MAILS.J1, label: 'Ouverture du mail', tokens: ['PropertyWith', 'propertyWith', 'propertyName'], flags: [],
    fr: 'Nous espérons que votre séjour {{propertyWith}} vous a plu.',
    en: 'We hope you enjoyed your stay at {{propertyName}}.' },
  { key: 'gift.list', email: MAILS.SEASON, label: 'Bons cadeaux — offre', tokens: ['list'], flags: [],
    fr: 'une ou plusieurs nuits {{list}}',
    en: 'one or more nights {{list}}' },
  { key: 'gift.offer', email: MAILS.SEASON, label: 'Bons cadeaux — par logement', tokens: ['propertyWith', 'propertyName', 'price'], flags: ['hasPrice'],
    fr: '{{propertyWith}}, à partir de {{price}} la nuit',
    en: 'at {{propertyName}}, from {{price}} a night' },
  { key: 'gift.fallback', email: MAILS.SEASON, label: 'Bons cadeaux — sans prix', tokens: [], flags: [],
    fr: 'une ou plusieurs nuits chez nous',
    en: 'one or more nights with us' },
]);
/* eslint-enable max-len */

const BY_KEY = new Map(CATALOGUE.map((entry) => [entry.key, entry]));

/** Tokens and flags of a mention (rule 7): its proposal quotes a price, its confirmation nothing. */
const MENTION_OFFER = Object.freeze({ tokens: ['price'], flags: ['hasPrice'] });
const MENTION_BOOKED = Object.freeze({ tokens: [], flags: [] });
/** A resource's sentence once booked (rule 11). */
const RESOURCE_BOOKED = Object.freeze({ tokens: ['slots'], flags: [] });

function entryOf(key) {
  return BY_KEY.get(key) || null;
}

/**
 * The wording to use for one key and language. `texts` is `{ global: { [key]: { fr, en } },
 * property: { [key]: { fr, en } } }`: a property override wins when filled (rule 3), then the global
 * text when stored (NULL means « never edited »), then the catalogue default.
 */
function wordingOf(key, lang, texts) {
  const entry = entryOf(key);
  if (!entry) return '';
  const side = lang === 'en' ? 'en' : 'fr';
  const own = texts && texts.property && texts.property[key];
  if (entry.overridable && own && own[side] != null && String(own[side]).trim() !== '') return String(own[side]);
  const global = texts && texts.global && texts.global[key];
  if (global && global[side] != null) return String(global[side]);
  return entry[side];
}

/** Renders a stay-text template: tokens as variables, flags plus each token read as a flag. */
function renderText(text, tokens = {}, flags = {}) {
  if (!text) return '';
  const tokenFlags = Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, Boolean(v)]));
  return renderTemplate({ subject: '', body: text }, { vars: tokens, flags: { ...tokenFlags, ...flags } }).body;
}

function renderStayText(key, lang, tokens, flags, texts) {
  return renderText(wordingOf(key, lang, texts), tokens, flags);
}

module.exports = {
  CATALOGUE,
  MAILS,
  MENTION_OFFER,
  MENTION_BOOKED,
  RESOURCE_BOOKED,
  entryOf,
  wordingOf,
  renderText,
  renderStayText,
};
