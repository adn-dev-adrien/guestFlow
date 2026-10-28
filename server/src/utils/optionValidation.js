/**
 * Authoritative validation of an option write (specs/options-resources-ux.md rule 16, and
 * specs/cancellation-insurance.md §3.1 rule 2 for the percentage bound).
 *
 * Returns `[{ field, message }]`, empty when the payload is acceptable. `field` is `title`, `price`
 * or `propertyPrices.<propertyId>`; the message is the French text the editor prints under the field.
 * The editor mirrors these checks as a UX hint, only this one can reject a write.
 */

const { NO_PROPERTY_PRICE } = require('./optionPayloadScope');

const MESSAGES = Object.freeze({
  titleRequired: 'Nom requis',
  notANumber: 'Nombre attendu',
  negative: 'Positif ou nul',
  decimals: '2 décimales max',
  percentMax: '100 % max',
  unknownProperty: 'Logement inconnu',
});

// A negative base price used to be refused with its own 400; the code now rides on the `price` detail.
const NEGATIVE_PRICE_CODE = 'NEGATIVE_OPTION_PRICE';

const isBlank = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/** The message a price value deserves, or '' when it is a fine price. */
function priceProblem(raw, { percent = false } = {}) {
  const value = typeof raw === 'string' ? Number(raw) : Number(raw);
  if (typeof raw === 'boolean' || !Number.isFinite(value)) return MESSAGES.notANumber;
  if (value < 0) return MESSAGES.negative;
  if (Math.abs(Math.round(value * 100) - value * 100) > 1e-6) return MESSAGES.decimals;
  if (percent && value > 100) return MESSAGES.percentMax;
  return '';
}

/**
 * @param {object} payload
 * @param {{ knownPropertyIds?: number[] }} [context]  the ids of the properties that exist: any property
 *   id the payload names (scope, prices, defaults, bath mats) must be one of them — an unknown one would
 *   otherwise reach a foreign key and answer 500.
 */
function validateOptionPayload(payload, { knownPropertyIds } = {}) {
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
  if (!String(body.title || '').trim()) details.push({ field: 'title', message: MESSAGES.titleRequired });

  const percent = body.priceType === 'percent_of_stay';
  if (!isBlank(body.price) && body.priceType !== 'free') {
    const message = priceProblem(body.price, { percent });
    if (message) details.push({ field: 'price', message, ...(message === MESSAGES.negative ? { code: NEGATIVE_PRICE_CODE } : {}) });
  }

  if (!NO_PROPERTY_PRICE.includes(body.priceType)) {
    for (const [pid, raw] of Object.entries(body.propertyPrices || {})) {
      if (unknown(pid)) {
        details.push({ field: `propertyPrices.${pid}`, message: MESSAGES.unknownProperty });
        continue;
      }
      if (isBlank(raw)) continue;
      const message = priceProblem(raw, { percent });
      if (message) details.push({ field: `propertyPrices.${pid}`, message });
    }
  }
  return details;
}

module.exports = { validateOptionPayload, priceProblem, MESSAGES, NEGATIVE_PRICE_CODE };
