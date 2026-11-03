/**
 * What the SAS counts and sells, judged before planning so the preview and the commit answer alike:
 * refused, never clamped (specs/sas-departure-recap-server-side.md rule 29,
 * specs/sas-breakfast-and-catering-upsell.md rule 15). Same reading of a number as the fiche's guard,
 * `utils/lineInputBounds.js`. Each function returns the refusal's message, or null.
 */

const MAX_COUNT = 999;
// The stay cap: a per-night sale is stored as a typed number of nights.
const MAX_NIGHTS = 366;

const PIECES_MESSAGE = `Quantité invalide : un nombre entier de pièces, ${MAX_COUNT} au plus.`;
const UNITS_MESSAGE = `Quantité invalide : ${MAX_COUNT} au plus.`;
const NIGHTS_MESSAGE = `Nuits : un nombre entier de 1 à ${MAX_NIGHTS}.`;

const NUMERIC_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;

// undefined = not sent. NaN = sent, and not a number: a boolean or an array never counts as one.
function readNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && NUMERIC_TEXT.test(value.trim())) return Number(value);
  return NaN;
}

// A line without a count is refused; a null or empty one counts nothing, and the pricing drops it.
function wholePiecesMessage(lines) {
  const bad = (Array.isArray(lines) ? lines : []).some((line) => {
    if (line && line.qty === undefined) return true;
    const qty = readNumber(line && line.qty);
    return qty !== undefined && !(Number.isSafeInteger(qty) && qty >= 0 && qty <= MAX_COUNT);
  });
  return bad ? PIECES_MESSAGE : null;
}

/**
 * @param {Array} sales  the draft's `soldOptions`
 * @param {(optionId: number) => string|undefined} priceTypeOf
 * @param {Array} storedLines  the stay's option lines: what this SAS already sold is not re-judged
 *        when sent back unchanged, whatever a later rule would say of it.
 */
function soldOptionsMessage(sales, priceTypeOf, storedLines) {
  const storedUnits = new Map((storedLines || [])
    .filter((line) => Number(line.sasArrivalOrigin || 0) === 1)
    .map((line) => [Number(line.optionId), Math.round(Number(line.billedUnits) * 100) / 100]));
  for (const sale of Array.isArray(sales) ? sales : []) {
    const persons = readNumber(sale?.persons);
    if (persons !== undefined && !(Number.isFinite(persons) && persons <= MAX_COUNT)) return UNITS_MESSAGE;
    const units = readNumber(sale?.units);
    if (units === undefined || units === storedUnits.get(Number(sale.optionId))) continue;
    if (!(Number.isFinite(units) && units >= 0 && units <= MAX_COUNT)) return UNITS_MESSAGE;
    const perNight = units > 0 && priceTypeOf(Number(sale.optionId)) === 'per_night';
    if (perNight && !(Number.isSafeInteger(units) && units <= MAX_NIGHTS)) return NIGHTS_MESSAGE;
  }
  return null;
}

module.exports = { wholePiecesMessage, soldOptionsMessage };
