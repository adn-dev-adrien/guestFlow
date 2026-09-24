/**
 * Public-site label maps — French + English.
 *
 * Single source of truth for every literal the public API sends to the website, so the site can
 * keep doing what it already does: render what the server said, without owning one translation
 * table or one pluralisation rule (specs/site-english-version.md §3 rule 3, §4 preamble).
 *
 * Built like `devisPdfLabels.js`, deliberately: two frozen maps of identical shape, reached through
 * `labels(lang).<key>`, **failing loud** on an unknown language or an unknown key. A silent fallback
 * is the one behaviour this module must not have — it would leak French into an English page in the
 * exact place nobody looks.
 *
 * Some entries are functions: pluralisation and agreement differ between the two languages, and
 * that difference belongs here rather than in the caller.
 *
 * See specs/site-english-version.md §3 rules 3, 8, 10 and §4.1.
 */

const FR = Object.freeze({
  // ── Price basis, per priceType (specs/public-planning-options.md) ──────────
  priceUnit: Object.freeze({
    per_person: 'par personne',
    per_person_per_night: 'par personne et par nuit',
    per_night: 'par nuit',
    per_stay: 'au séjour',
    per_participant_progressive: 'par participant',
    // specs/cancellation-insurance.md §3.1 — `price` is a percentage for this type, so the unit
    // label says what the percentage applies to.
    percent_of_stay: 'du montant du séjour',
  }),

  // ── Price basis for a quote line, where the wording is the stay's, not the catalogue's ─────
  quoteUnit: Object.freeze({
    per_hour: 'par heure',
    per_stay: 'pour le séjour',
    per_night: 'par nuit',
    per_person: 'par personne',
    per_person_per_night: 'par personne et par nuit',
  }),
  quoteQuantity: Object.freeze({
    per_hour: "Nombre d'heures",
  }),

  // ── Planning-card option billed by séance (the non per-person case) ────────
  sessionUnit: 'par séance',
  sessionQuantity: 'Nombre de séances',

  // ── Portions: breakfasts and covers (specs/site-meal-portions.md) ──────────
  portions: Object.freeze({
    breakfast: Object.freeze({
      unit: 'petit déjeuner',
      unitPlural: 'petits déjeuners',
      priceUnitLabel: 'par petit déjeuner',
      quantityLabel: 'Nombre de petits déjeuners',
      servingUnit: 'matin',
      servingUnitPlural: 'matins',
    }),
    meal: Object.freeze({
      unit: 'couvert',
      unitPlural: 'couverts',
      priceUnitLabel: 'par couvert',
      quantityLabel: 'Nombre de couverts',
      servingUnit: 'repas',
      servingUnitPlural: 'repas',
    }),
  }),
  person: 'personne',
  personPlural: 'personnes',
  night: 'nuit',
  nightPlural: 'nuits',
  /** « Jusqu'à 32 — 4 personnes × 8 repas » */
  portionHint: (cap, personsText, servingsText) => `Jusqu'à ${cap} — ${personsText} × ${servingsText}`,
  /** « 6 petits déjeuners au maximum pour 2 personnes et 3 nuits. » */
  portionRefusal: (capText, personsText, basisText) => `${capText} au maximum pour ${personsText} et ${basisText}.`,

  // ── Allowances (specs/hourly-resource-thermal-model, nordic bath) ──────────
  /** « 1 h 30 offerte », « 2 h offertes » — the agreement follows the unit actually written. */
  offeredPerStay: (amountText, plural) => `${amountText} ${plural ? 'offertes' : 'offerte'} par séjour`,
  offeredAgreement: (plural) => (plural ? 'offertes' : 'offerte'),

  // ── Quote ─────────────────────────────────────────────────────────────────
  computedForYourDates: 'Tarif calculé pour vos dates de séjour',

  // ── Error messages, keyed by MEANING, not by HTTP code ────────────────────
  // `VALIDATION_FAILED` covers six distinct refusals; keying on the code alone could not tell an
  // invalid date range from an option that does not belong to the property.
  errors: Object.freeze({
    devisNotFound: 'Devis introuvable.',
    propertyNotFound: 'Logement introuvable.',
    termsNotFound: 'Version introuvable.',
    alreadyConfirmed: 'Cette réservation est déjà confirmée.',
    datesUnavailable: 'Ces dates ne sont plus disponibles.',
    overCapacity: 'Le nombre de personnes dépasse la capacité du logement.',
    clientInvalid: 'Coordonnées du client invalides.',
    requestInvalid: 'Données de demande invalides.',
    devisInvalid: 'Données de devis invalides.',
    optionUnavailable: 'Option non disponible pour ce logement.',
    periodInvalid: 'Paramètres de période invalides.',
    resourceUnavailable: 'Ressource non disponible pour ce logement.',
    paymentProviderError: 'Erreur du fournisseur de paiement.',
    termsNotConfigured: 'Les conditions générales ne sont pas encore publiées.',
  }),
});

const EN = Object.freeze({
  priceUnit: Object.freeze({
    per_person: 'per person',
    per_person_per_night: 'per person per night',
    per_night: 'per night',
    per_stay: 'per stay',
    per_participant_progressive: 'per participant',
    percent_of_stay: 'of the stay total',
  }),

  quoteUnit: Object.freeze({
    per_hour: 'per hour',
    per_stay: 'for the stay',
    per_night: 'per night',
    per_person: 'per person',
    per_person_per_night: 'per person per night',
  }),
  quoteQuantity: Object.freeze({
    per_hour: 'Number of hours',
  }),

  sessionUnit: 'per session',
  sessionQuantity: 'Number of sessions',

  portions: Object.freeze({
    breakfast: Object.freeze({
      unit: 'breakfast',
      unitPlural: 'breakfasts',
      priceUnitLabel: 'per breakfast',
      quantityLabel: 'Number of breakfasts',
      servingUnit: 'morning',
      servingUnitPlural: 'mornings',
    }),
    meal: Object.freeze({
      unit: 'cover',
      unitPlural: 'covers',
      priceUnitLabel: 'per cover',
      quantityLabel: 'Number of covers',
      servingUnit: 'meal',
      servingUnitPlural: 'meals',
    }),
  }),
  person: 'guest',
  personPlural: 'guests',
  night: 'night',
  nightPlural: 'nights',
  portionHint: (cap, personsText, servingsText) => `Up to ${cap} — ${personsText} × ${servingsText}`,
  portionRefusal: (capText, personsText, basisText) => `${capText} at most for ${personsText} and ${basisText}.`,

  // English has no agreement to make; both branches are the same word on purpose, so the caller
  // never has to know which language it is in.
  offeredPerStay: (amountText) => `${amountText} included per stay`,
  offeredAgreement: () => 'included',

  computedForYourDates: 'Price calculated for your dates',

  errors: Object.freeze({
    devisNotFound: 'Quote not found.',
    propertyNotFound: 'Property not found.',
    termsNotFound: 'Version not found.',
    alreadyConfirmed: 'This booking is already confirmed.',
    datesUnavailable: 'These dates are no longer available.',
    overCapacity: 'The number of guests exceeds the property capacity.',
    clientInvalid: 'Invalid guest details.',
    requestInvalid: 'Invalid request data.',
    devisInvalid: 'Invalid quote data.',
    optionUnavailable: 'This option is not available for this property.',
    periodInvalid: 'Invalid period parameters.',
    resourceUnavailable: 'This resource is not available for this property.',
    paymentProviderError: 'Payment provider error.',
    termsNotConfigured: 'The terms and conditions have not been published yet.',
  }),
});

const MAPS = { fr: FR, en: EN };

/**
 * Normalise a language token coming off the wire.
 *
 * Deliberately more permissive than `emailTemplateLanguage.normaliseLang`, which only recognises an
 * exact `en`: a browser or a WordPress locale says `en_GB`, `en-GB` or `EN`, and a visitor must
 * never lose a booking funnel over a language token (spec rule 1). Anything unrecognised — and
 * anything absent — is French.
 */
function normalisePublicLang(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase().replace('_', '-');
  if (!raw) return 'fr';
  const base = raw.split('-')[0];
  return base === 'en' ? 'en' : 'fr';
}

/**
 * Whether the caller stated a language at all.
 *
 * Rule 12 hangs on this: a request that explicitly says `fr` may overwrite a stored preference, a
 * request that says nothing may not — and `normalisePublicLang` cannot tell those apart, because it
 * answers `fr` to both.
 */
function statesLang(value) {
  const raw = String(value == null ? '' : value).trim();
  return raw.length > 0;
}

function labels(language) {
  const map = MAPS[String(language || '').toLowerCase()];
  if (!map) {
    throw new Error(`publicLabels: unknown language "${language}" (supported: ${Object.keys(MAPS).join(', ')})`);
  }
  return map;
}

/**
 * An error message by meaning. Throws on an unknown key rather than returning the key — a code path
 * that shows `errors.optionUnavailable` to a visitor is a bug that must be caught in tests.
 */
function errorMessage(language, key) {
  const message = labels(language).errors[key];
  if (!message) {
    throw new Error(`publicLabels: unknown error key "${key}"`);
  }
  return message;
}

function supportedLanguages() {
  return Object.keys(MAPS);
}

module.exports = {
  labels,
  errorMessage,
  normalisePublicLang,
  statesLang,
  supportedLanguages,
  FR,
  EN,
};
