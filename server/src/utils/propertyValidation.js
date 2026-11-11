/**
 * Property form validation (specs/settings-rationalization.md rule 23a).
 *
 * Returns `{ [field]: message }` — empty when the payload is acceptable. Only the fields present
 * in the payload are checked (a partial update never trips on a field it does not carry). The
 * bed / capacity coherence is checked only when one of those three fields CHANGES against
 * `existing`, so a property already stored in a questionable state stays savable for an unrelated
 * edit — the operator is told the day they touch the capacity.
 *
 * Multipart forms send every value as a string: numbers are parsed here.
 */

const { validateMonthDay } = require('./settingsValidation');
const { PROPERTY_LIMITS, parseBoundedNumber } = require('./inputLimits');
const { MODES, poolSeasonModeOf } = require('./poolSeason');
const { isClockTime, isOptionalText, cleanedBody } = require('./bodyText');
const { MAX_STAY_NIGHTS } = require('./stayDates');
const { numberRefused, usableNumber, nonNegative, wholeFrom, rowsOf } = require('./lineInputBounds');

const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);
const asNumber = (value) => (value === '' || value === null || value === undefined || typeof value === 'object' ? NaN : Number(String(value).replace(',', '.')));
const isWhole = wholeFrom(0);
const isBlank = (value) => typeof value !== 'object' ? String(value ?? '').trim() === '' : value === null;
const isTrue = (value) => value === true || value === 1 || value === '1' || value === 'true';

// specs/guest-email-texts-made-simple.md rule 34, amended by specs/settings-input-guards.md rules 22-26
// and 46-47: the pair is judged on what the payload changes, a lone bound is completed from the stored
// season, and a legacy pair left as it is never blocks an unrelated save.
function validatePoolSeason(body, errors, existing) {
  const mode = has(body, 'poolSeasonMode') ? body.poolSeasonMode : null;
  if (mode !== null && !MODES.includes(mode)) {
    errors.poolSeasonMode = 'Choix invalide.';
    return;
  }
  if (mode === 'none' || mode === 'allYear') return;
  const hasStart = has(body, 'poolSeasonStart');
  const hasEnd = has(body, 'poolSeasonEnd');
  if (mode === null && !hasStart && !hasEnd) return;
  const storedStart = String((existing && existing.poolSeasonStart) || '').trim();
  const storedEnd = String((existing && existing.poolSeasonEnd) || '').trim();
  const start = hasStart ? String(body.poolSeasonStart || '').trim() : storedStart;
  const end = hasEnd ? String(body.poolSeasonEnd || '').trim() : storedEnd;
  if (hasStart) {
    const error = validateMonthDay(start);
    if (error) errors.poolSeasonStart = error;
  }
  if (hasEnd) {
    const error = validateMonthDay(end);
    if (error) errors.poolSeasonEnd = error;
  }
  if (errors.poolSeasonStart || errors.poolSeasonEnd) return;
  const becomesSeason = mode === 'season' && poolSeasonModeOf(storedStart, storedEnd) !== 'season';
  if (mode === null && !start && !end) return;
  if (start === storedStart && end === storedEnd && !becomesSeason) return;
  if (!start || !end) {
    if (!start) errors.poolSeasonStart = 'Les deux dates.';
    if (!end) errors.poolSeasonEnd = 'Les deux dates.';
    return;
  }
  if (end < start) errors.poolSeasonEnd = 'La fermeture suit l\'ouverture.';
}

// specs/hosting-h2-account-security.md rule 68 — a multipart form sends strings, the JSON API may send numbers; anything
// else stops here, before a validator reads it or the model stores it. A time is HH:MM or empty, a stored one exempt.
const TEXT_KEYS = ['name', 'nameArticle', 'photo', 'touristTaxMode', 'extraGuestPriceUnit', 'poolSeasonMode', 'poolSeasonStart', 'poolSeasonEnd'];
const TIME_KEYS = ['defaultCheckIn', 'defaultCheckOut'];
// Settings-input-guards rule 64 (audit R42-INJ-L1) — the e-mail facts are judged here too, before the first write: the
// hook as the e-mail hooks route judges it, a switch or a yes/no answer as one of its values (`options`: the options
// decide). They were judged by nobody and stored « [object Object] », or threw after the logement was already saved.
const EMAIL_HOOK_KEYS = ['emailHook', 'emailHookEn'];
const EMAIL_HOOK_MAX_LENGTH = 300;
const SWITCH_VALUES = [true, false, 1, 0, '1', '0', 'true', 'false'];
const SWITCH_KEYS = ['hasWifi', 'depositEnabled'];
const ANSWER_KEYS = ['cleaningIncluded', 'towelsProvided', 'bedLinenProvided'];
// utils/pricing.js computes these three: any other mode silently quotes no tax (settings-input-guards rule 56).
const TOURIST_TAX_MODES = ['per_day_per_person', 'percentage_accommodation', 'percentage_and_fixed'];
const NUMBER_KEYS = [
  'maxGuests', 'maxBabies', 'basePriceIncludedGuests', 'extraGuestPrice', 'welcomePackCost', 'doubleBeds', 'singleBeds',
  'depositPercent', 'depositDueDays', 'balanceDaysBefore', 'cancelAfterBalanceDueDays', 'cleaningHours', 'defaultCautionAmount',
  'touristTaxPerDayPerPerson', 'touristTaxPercentage', 'touristTaxDepartmentPercentage', 'touristTaxFixedAmount',
];

function shapeErrors(body, existing) {
  const errors = {};
  const sent = (key) => has(body, key) && body[key] !== undefined && body[key] !== null && body[key] !== '';
  for (const key of TEXT_KEYS) {
    if (sent(key) && typeof body[key] !== 'string') errors[key] = 'Valeur invalide.';
  }
  for (const key of NUMBER_KEYS) {
    if (sent(key) && typeof body[key] !== 'string' && typeof body[key] !== 'number') errors[key] = 'Valeur invalide.';
  }
  for (const key of TIME_KEYS) {
    if (sent(key) && !(existing && body[key] === existing[key]) && !isClockTime(body[key])) errors[key] = 'Heure invalide.';
  }
  for (const key of EMAIL_HOOK_KEYS) {
    if (!sent(key)) continue;
    if (typeof body[key] !== 'string') errors[key] = 'Valeur invalide.';
    else if (body[key].length > EMAIL_HOOK_MAX_LENGTH && !(existing && body[key] === existing[key])) {
      errors[key] = `Une accroche ne dépasse pas ${EMAIL_HOOK_MAX_LENGTH} caractères.`;
    }
  }
  for (const key of SWITCH_KEYS) {
    if (sent(key) && !SWITCH_VALUES.includes(body[key])) errors[key] = 'Valeur invalide.';
  }
  for (const key of ANSWER_KEYS) {
    if (sent(key) && !SWITCH_VALUES.includes(body[key]) && body[key] !== 'options') errors[key] = 'Valeur invalide.';
  }
  // Settings-input-guards rule 56.
  if (sent('touristTaxMode') && !errors.touristTaxMode && !TOURIST_TAX_MODES.includes(body.touristTaxMode)
    && !(existing && body.touristTaxMode === existing.touristTaxMode)) errors.touristTaxMode = 'Choix invalide.';
  // Rule 57 — the upload is the only way to set a photo: a deletion removes the file the row names.
  if (sent('photo') && !errors.photo && !(existing && body.photo === existing.photo)) errors.photo = 'Valeur invalide.';
  // Rule 55 — the first price of a new property; an update does not read this key.
  if (!existing && numberRefused(body.pricePerNight, nonNegative)) errors.pricePerNight = 'Un montant ≥ 0 €.';
  return errors;
}

/** Audit R23-I8 — NUL used to pass a required name: control characters out of it, a stored one left as it is. */
const cleanPropertyText = (body, stored = null) => cleanedBody(body || {}, { fields: ['name'], stored });

function validatePropertyInput(body = {}, existing = null) {
  const wrongShape = shapeErrors(body, existing);
  if (Object.keys(wrongShape).length) return wrongShape;
  const errors = {};
  const pick = (key) => (has(body, key) ? body[key] : existing && existing[key]);
  // A stored number sent back unchanged is not re-judged (specs/settings-input-guards.md rule 51).
  const unchanged = (key) => Boolean(existing) && asNumber(body[key]) === asNumber(existing[key]);

  if (has(body, 'name') && !String(body.name || '').trim()) errors.name = 'Le nom est obligatoire.';

  const maxGuests = asNumber(pick('maxGuests'));
  if (has(body, 'maxGuests') && !unchanged('maxGuests') && !wholeFrom(1)(maxGuests)) errors.maxGuests = 'Au moins 1 voyageur.';
  for (const key of ['maxBabies', 'doubleBeds', 'singleBeds']) {
    if (has(body, key) && !unchanged(key) && !isWhole(asNumber(body[key]))) errors[key] = 'Un nombre entier ≥ 0.';
  }

  const capacityTouched = ['maxGuests', 'doubleBeds', 'singleBeds'].some((key) => has(body, key)
    && (!existing || asNumber(body[key]) !== asNumber(existing[key])));
  if (capacityTouched && !errors.maxGuests && !errors.doubleBeds && !errors.singleBeds) {
    const doubles = asNumber(pick('doubleBeds')) || 0;
    const singles = asNumber(pick('singleBeds')) || 0;
    const sleeps = 2 * doubles + singles;
    if (doubles + singles < 1) errors.doubleBeds = 'Il faut au moins un lit.';
    else if (Number.isInteger(maxGuests) && sleeps < maxGuests) {
      errors.maxGuests = `Seulement ${sleeps} couchage${sleeps > 1 ? 's' : ''} pour ${maxGuests} voyageurs.`;
    }
  }

  if (has(body, 'basePriceIncludedGuests')) {
    const included = asNumber(body.basePriceIncludedGuests);
    if (!unchanged('basePriceIncludedGuests') && !isWhole(included)) errors.basePriceIncludedGuests = 'Un nombre entier ≥ 0.';
    else if (Number.isInteger(maxGuests) && included > maxGuests) {
      errors.basePriceIncludedGuests = `Pas plus que la capacité (${maxGuests}).`;
    }
  }
  if (has(body, 'extraGuestPrice')) {
    const price = asNumber(body.extraGuestPrice);
    if (!unchanged('extraGuestPrice') && (!usableNumber(price) || price < 0)) errors.extraGuestPrice = 'Un montant ≥ 0 €.';
  }

  if (isTrue(pick('depositEnabled')) && has(body, 'depositPercent')) {
    const pct = asNumber(body.depositPercent);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
      errors.depositPercent = 'Entre 1 et 99 %. Pour tout encaisser à la réservation, désactivez l\'acompte.';
    }
  } else if (has(body, 'depositPercent') && !isBlank(body.depositPercent) && !unchanged('depositPercent')) {
    const pct = asNumber(body.depositPercent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) errors.depositPercent = 'Entre 0 et 100 %.';
  }

  for (const key of ['touristTaxPercentage', 'touristTaxDepartmentPercentage']) {
    if (!has(body, key)) continue;
    const pct = asNumber(body[key]);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) errors[key] = 'Entre 0 et 100 %.';
  }
  for (const key of ['touristTaxPerDayPerPerson', 'touristTaxFixedAmount', 'defaultCautionAmount']) {
    if (!has(body, key)) continue;
    // An empty deposit keeps the stored one (specs/guest-email-texts-made-simple.md rule 28, 2026-10-18).
    if (key === 'defaultCautionAmount' && isBlank(body[key])) continue;
    if (unchanged(key)) continue;
    const amount = asNumber(body[key]);
    if (!usableNumber(amount) || amount < 0) errors[key] = 'Un montant ≥ 0 €.';
  }
  for (const [key, message] of [['welcomePackCost', 'Un montant ≥ 0 €.'], ['cleaningHours', 'Un nombre ≥ 0.'], ['parkingDistanceMeters', 'Un nombre ≥ 0.']]) {
    if (!has(body, key) || isBlank(body[key]) || unchanged(key)) continue;
    const value = asNumber(body[key]);
    if (!usableNumber(value) || value < 0) errors[key] = message;
  }

  // specs/settings-input-guards.md rules 9-11 — a delay is refused, never replaced, and only when it
  // is the field that changes: a stored value outside the bounds stays savable for an unrelated edit.
  const depositOn = isTrue(pick('depositEnabled'));
  for (const key of ['depositDueDays', 'balanceDaysBefore', 'cancelAfterBalanceDueDays']) {
    if (!has(body, key) || isBlank(body[key])) continue;
    if (key === 'depositDueDays' && !depositOn) continue;
    if (existing && asNumber(body[key]) === asNumber(existing[key])) continue;
    const parsed = parseBoundedNumber(body[key], PROPERTY_LIMITS[key]);
    if (parsed.error) errors[key] = parsed.error;
  }

  validatePoolSeason(body, errors, existing);

  return errors;
}

const SEASON_MODES = ['fixed', 'progressive'];
const sentValue = (value) => value !== undefined && value !== null && value !== '';
const SEASON_AMOUNTS = ['pricePerNight', 'netTargetPerNight', 'extraGuestPrice', 'extraGuestNetTarget'];
const TIER_NUMBERS = {
  progressiveTiers: [['extraNightPrice', nonNegative], ['nightNumber'], ['extraNightDiscountPct']],
  extraGuestTiers: [['price', nonNegative], ['netPrice', nonNegative], ['fromNight']],
};
const SEASON_REFUSALS = {
  amount: 'Tarif de saison : un montant ≥ 0 €.',
  minNights: 'Minimum de nuits : un nombre entier, au moins 1.',
  maxNights: 'Maximum de nuits : un nombre entier.',
  number: 'Saison : nombre invalide.',
  value: 'Saison : valeur invalide.',
};
const seasonRefusal = (field, kind) => ({ error: SEASON_REFUSALS[kind], code: 'INVALID_SEASON', field, status: 400 });

// Within a list a stored value passes wherever it is sent back: a row has no identity of its own.
const refusedInList = (row, field, valid, storedRows) => {
  const kept = storedRows.some((known) => known?.[field] != null && Number(known[field]) === Number(row?.[field]));
  return numberRefused(row?.[field], valid, kept ? row[field] : undefined);
};

function tierRefusal(body, stored) {
  for (const [list, numbers] of Object.entries(TIER_NUMBERS)) {
    const storedRows = rowsOf(stored?.[list]);
    for (const tier of rowsOf(body[list])) {
      for (const [field, valid] of numbers) {
        if (refusedInList(tier, field, valid, storedRows)) return seasonRefusal(list, valid ? 'amount' : 'number');
      }
    }
  }
  return null;
}

/**
 * What a season write carries (specs/settings-input-guards.md rule 52), judged on the requests that come
 * from outside: a recipe apply computes its own numbers and calls the model directly.
 * @param {object} body  the request's season fields
 * @param {object} [stored]  the `pricing_rules` row being edited
 * @returns {{error, code, field, status}|null}
 */
function seasonInputRefusal(body = {}, stored = null) {
  for (const field of ['label', 'color']) {
    if (!isOptionalText(body[field])) return seasonRefusal(field, 'value');
  }
  if (sentValue(body.pricingMode) && !SEASON_MODES.includes(body.pricingMode) && body.pricingMode !== stored?.pricingMode) {
    return seasonRefusal('pricingMode', 'value');
  }
  for (const field of SEASON_AMOUNTS) {
    if (numberRefused(body[field], nonNegative, stored?.[field])) return seasonRefusal(field, 'amount');
  }
  if (numberRefused(body.minNights, wholeFrom(1), stored?.minNights)) return seasonRefusal('minNights', 'minNights');
  if (numberRefused(body.maxNights, wholeFrom(0), stored?.maxNights)) return seasonRefusal('maxNights', 'maxNights');
  if (numberRefused(body.seasonRank, undefined, stored?.seasonRank)) return seasonRefusal('seasonRank', 'number');
  const storedRanges = rowsOf(stored?.dateRanges);
  for (const range of rowsOf(body.dateRanges)) {
    if (refusedInList(range, 'minNights', wholeFrom(1), storedRanges)) return seasonRefusal('minNights', 'minNights');
    if (refusedInList(range, 'maxNights', wholeFrom(0), storedRanges)) return seasonRefusal('maxNights', 'maxNights');
  }
  return tierRefusal(body, stored);
}

/** The progressive preview walks `maxNights` nights: a stay's worth at most (rule 53). */
function progressivePreviewRefusal(body = {}) {
  if (numberRefused(body.pricePerNight, nonNegative)) return seasonRefusal('pricePerNight', 'amount');
  const stayLength = (n) => wholeFrom(1)(n) && n <= MAX_STAY_NIGHTS;
  if (numberRefused(body.maxNights, stayLength)) {
    return { error: `Nuits : un nombre entier de 1 à ${MAX_STAY_NIGHTS}.`, code: 'INVALID_SEASON', field: 'maxNights', status: 400 };
  }
  return tierRefusal({ progressiveTiers: body.progressiveTiers });
}

// Settings-input-guards rule 63 (audit R42-DB-L1 / R42-INJ-L2) — a document's type is one the page offers, a name sent one
// text of at most 200 characters (rule 60's bound on the stored file name); none sent, the file's own name (rule 60).
const DOCUMENT_TYPES = ['contract', 'rules', 'other'];
const DOCUMENT_NAME_MAX_LENGTH = 200;
function documentFieldsRefusal(body = {}) {
  const refused = (field) => ({ error: 'Valeur invalide.', field, status: 400 });
  const type = body.type;
  if (type !== undefined && type !== null && type !== '' && !DOCUMENT_TYPES.includes(type)) return refused('type');
  const name = body.name;
  if (name !== undefined && name !== null && typeof name !== 'string') return refused('name');
  if (typeof name === 'string' && name.length > DOCUMENT_NAME_MAX_LENGTH) {
    return { error: `Un nom de ${DOCUMENT_NAME_MAX_LENGTH} caractères au plus.`, field: 'name', status: 400 };
  }
  return null;
}

// Rule 63 (verification R42 L1, L2) — the stored name: the one sent, trimmed; empty or blank, the file's own name, its
// base shortened so the whole stays within the 200 characters a sent name may have (the extension kept).
function documentDisplayName(sent, originalname) {
  const given = typeof sent === 'string' ? sent.trim() : '';
  if (given) return given;
  const own = String(originalname || '');
  if (own.length <= DOCUMENT_NAME_MAX_LENGTH) return own;
  const dot = own.lastIndexOf('.');
  const ext = dot > 0 && own.length - dot <= 16 ? own.slice(dot) : '';
  return own.slice(0, DOCUMENT_NAME_MAX_LENGTH - ext.length) + ext;
}

module.exports = {
  validatePropertyInput, cleanPropertyText, seasonInputRefusal, progressivePreviewRefusal, documentFieldsRefusal, documentDisplayName,
  EMAIL_HOOK_MAX_LENGTH,
};
