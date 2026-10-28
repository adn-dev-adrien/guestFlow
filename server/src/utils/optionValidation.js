/**
 * Authoritative validation of an option write (specs/options-resources-ux.md rule 16, and
 * specs/cancellation-insurance.md §3.1 rule 2 for the percentage bound).
 *
 * Returns `[{ field, message }]`, empty when the payload is acceptable. `field` is `title`, `price`
 * or `propertyPrices.<propertyId>`; the message is the French text the editor prints under the field.
 * The editor mirrors these checks as a UX hint, only this one can reject a write.
 */

const MESSAGES = Object.freeze({
  titleRequired: 'Nom requis',
  notANumber: 'Nombre attendu',
  negative: 'Positif ou nul',
  decimals: '2 décimales max',
  percentMax: '100 % max',
});

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

const NO_PROPERTY_PRICE = ['free', 'per_participant_progressive'];

function validateOptionPayload(payload) {
  const body = payload || {};
  const details = [];
  if (!String(body.title || '').trim()) details.push({ field: 'title', message: MESSAGES.titleRequired });

  const percent = body.priceType === 'percent_of_stay';
  if (!isBlank(body.price) && body.priceType !== 'free') {
    const message = priceProblem(body.price, { percent });
    if (message) details.push({ field: 'price', message });
  }

  if (!NO_PROPERTY_PRICE.includes(body.priceType)) {
    for (const [pid, raw] of Object.entries(body.propertyPrices || {})) {
      if (isBlank(raw)) continue;
      const message = priceProblem(raw, { percent });
      if (message) details.push({ field: `propertyPrices.${pid}`, message });
    }
  }
  return details;
}

module.exports = { validateOptionPayload, priceProblem, MESSAGES };
