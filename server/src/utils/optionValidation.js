/**
 * Authoritative validation of an option write (specs/options-resources-ux.md rule 16, and
 * specs/cancellation-insurance.md §3.1 rule 2 for the percentage bound).
 *
 * Returns `[{ field, message }]`, empty when the payload is acceptable. `field` is `title`, `price`
 * or `propertyPrices.<propertyId>`; the message is the French text the editor prints under the field.
 * The editor mirrors these checks as a UX hint, only this one can reject a write.
 */

const { NO_PROPERTY_PRICE } = require('./optionPayloadScope');
const { readNumber, usableNumber, numberRefused, nonNegative, wholeFrom, rowsOf } = require('./lineInputBounds');

const MESSAGES = Object.freeze({
  titleRequired: 'Nom requis',
  notText: 'Texte attendu',
  notANumber: 'Nombre attendu',
  negative: 'Positif ou nul',
  decimals: '2 décimales max',
  percentMax: '100 % max',
  unknownProperty: 'Logement inconnu',
  whole: 'Nombre entier attendu',
});

// A negative base price used to be refused with its own 400; the code now rides on the `price` detail.
const NEGATIVE_PRICE_CODE = 'NEGATIVE_OPTION_PRICE';

const TOWEL_COUNTS = ['towelLargePerPerson', 'towelMediumPerPerson', 'towelSmallPerPerson'];

const isBlank = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/**
 * The message a price value deserves, or '' when it is a fine price. Past the usable range it is not a
 * number, unless it is the `stored` value sent back unchanged (specs/options-resources-ux.md rule 31).
 */
function priceProblem(raw, { percent = false, stored } = {}) {
  const value = readNumber(raw);
  if (value === undefined) return '';
  const kept = stored !== undefined && stored !== null && Number(stored) === value;
  if (!kept && !usableNumber(value)) return MESSAGES.notANumber;
  if (value < 0) return MESSAGES.negative;
  if (Math.abs(Math.round(value * 100) - value * 100) > 1e-6) return MESSAGES.decimals;
  if (percent && value > 100) return MESSAGES.percentMax;
  return '';
}

/**
 * @param {object} payload
 * @param {{ knownPropertyIds?: number[], stored?: object }} [context]  the ids of the properties that exist:
 *   any property id the payload names (scope, prices, defaults, bath mats) must be one of them — an unknown
 *   one would otherwise reach a foreign key and answer 500. `stored` is the option being edited.
 */
function validateOptionPayload(payload, { knownPropertyIds, stored } = {}) {
  const body = payload || {};
  const details = [];
  const known = knownPropertyIds ? new Set(knownPropertyIds.map(Number)) : null;
  const unknown = (pid) => !/^[1-9]\d*$/.test(String(pid)) || (known !== null && !known.has(Number(pid)));
  if (Array.isArray(body.propertyIds) && body.propertyIds.some(unknown)) {
    details.push({ field: 'propertyIds', message: MESSAGES.unknownProperty });
  }
  for (const group of ['propertyDefaults', 'propertyBathMats']) {
    Object.keys(body[group] || {}).filter(unknown).forEach((pid) => {
      details.push({ field: `${group}.${pid}`, message: MESSAGES.unknownProperty });
    });
  }
  // Only a string is text: an object used to be stored as « [object Object] » (hosting-h2 rule 68).
  if (typeof body.title !== 'string' || !body.title.trim()) details.push({ field: 'title', message: MESSAGES.titleRequired });
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    details.push({ field: 'description', message: MESSAGES.notText });
  }

  const percent = body.priceType === 'percent_of_stay';
  if (!isBlank(body.price) && body.priceType !== 'free') {
    const message = priceProblem(body.price, { percent, stored: stored?.price });
    if (message) details.push({ field: 'price', message, ...(message === MESSAGES.negative ? { code: NEGATIVE_PRICE_CODE } : {}) });
  }

  if (!NO_PROPERTY_PRICE.includes(body.priceType)) {
    for (const [pid, raw] of Object.entries(body.propertyPrices || {})) {
      if (unknown(pid)) {
        details.push({ field: `propertyPrices.${pid}`, message: MESSAGES.unknownProperty });
        continue;
      }
      if (isBlank(raw)) continue;
      const message = priceProblem(raw, { percent, stored: stored?.propertyPrices?.[pid] });
      if (message) details.push({ field: `propertyPrices.${pid}`, message });
    }
  }
  for (const field of TOWEL_COUNTS) {
    if (numberRefused(body[field], wholeFrom(0), stored?.[field])) details.push({ field, message: MESSAGES.whole });
  }
  for (const [pid, raw] of Object.entries(body.propertyBathMats || {})) {
    if (numberRefused(raw, wholeFrom(0), stored?.propertyBathMats?.[pid])) details.push({ field: `propertyBathMats.${pid}`, message: MESSAGES.whole });
  }
  for (const tier of rowsOf(body.optionProgressiveTiers)) {
    const kept = rowsOf(stored?.optionProgressiveTiers).some((known) => Number(known.unitPrice) === Number(tier?.unitPrice));
    if (numberRefused(tier?.unitPrice, nonNegative, kept ? tier.unitPrice : undefined)) {
      details.push({ field: 'optionProgressiveTiers', message: MESSAGES.notANumber });
      break;
    }
  }
  return details;
}

module.exports = { validateOptionPayload, priceProblem, MESSAGES, NEGATIVE_PRICE_CODE };
