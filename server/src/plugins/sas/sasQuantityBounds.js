const sdk = require('../sdk');
const { roundMoneyStrict } = sdk.coreModule('money');
/**
 * What the SAS counts and sells, judged before planning so the preview and the commit answer alike:
 * refused, never clamped (specs/sas-departure-recap-server-side.md rule 29,
 * specs/sas-breakfast-and-catering-upsell.md rule 16). Same reading of a number as the fiche's guard,
 * `utils/lineInputBounds.js`. Each function returns the refusal's message, or null.
 */

const MAX_COUNT = 999;
// The stay cap: a per-night sale is stored as a typed number of nights.
const MAX_NIGHTS = 366;

const PIECES_MESSAGE = `Quantité invalide : un nombre entier de pièces, ${MAX_COUNT} au plus.`;
const UNITS_MESSAGE = `Quantité invalide : ${MAX_COUNT} au plus.`;
const NIGHTS_MESSAGE = `Nuits : un nombre entier de 1 à ${MAX_NIGHTS}.`;
const PERSONS_MESSAGE = `Personnes servies : un nombre entier de 1 à ${MAX_COUNT}.`;
const PRICE_MESSAGE = 'Prix : un montant ≥ 0 €.';
const BREAKFAST_MESSAGE = 'Petit-déjeuner : une quantité de 0 ou plus.';

const BREAKFAST_COUNTS = [
  'breakfastCoffee', 'breakfastTea', 'breakfastChocolate', 'breakfastMilk', 'breakfastPastries', 'breakfastCereals', 'breakfastBread',
];

const NUMERIC_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;

// undefined = not sent. NaN = sent, and not a number: a boolean, an array or text of spaces never counts as one.
function readNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  const text = value.trim();
  return NUMERIC_TEXT.test(text) ? Number(text) : NaN;
}

const usable = (n) => Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER;

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
 * @param {Array} storedLines  the stay's option lines: the units and people this SAS already sold are not
 *        re-judged when sent back unchanged, whatever a later rule would say of them.
 */
function soldOptionsMessage(sales, priceTypeOf, storedLines) {
  const soldHere = (storedLines || []).filter((line) => Number(line.sasArrivalOrigin || 0) === 1);
  const storedUnits = new Map(soldHere.map((line) => [Number(line.optionId), roundMoneyStrict(line.billedUnits)]));
  const storedPersons = new Map(soldHere.map((line) => [Number(line.optionId), line.cardPersons == null ? undefined : Number(line.cardPersons)]));
  for (const sale of Array.isArray(sales) ? sales : []) {
    const persons = readNumber(sale?.persons);
    if (persons !== undefined && persons !== storedPersons.get(Number(sale.optionId))
      && !(Number.isSafeInteger(persons) && persons >= 1 && persons <= MAX_COUNT)) return PERSONS_MESSAGE;
    const units = readNumber(sale?.units);
    if (units === undefined || units === storedUnits.get(Number(sale.optionId))) continue;
    if (!(Number.isFinite(units) && units >= 0 && units <= MAX_COUNT)) return UNITS_MESSAGE;
    const perNight = units > 0 && priceTypeOf(Number(sale.optionId)) === 'per_night';
    if (perNight && !(Number.isSafeInteger(units) && units <= MAX_NIGHTS)) return NIGHTS_MESSAGE;
  }
  return null;
}

// The breakfast composition is stored as sent, rounded (specs/sas-departure-recap-server-side.md rule 30).
function breakfastCountsMessage(body, stored) {
  const bad = BREAKFAST_COUNTS.some((field) => {
    const count = readNumber(body?.[field]);
    if (count === undefined || (stored?.[field] != null && Number(stored[field]) === count)) return false;
    return !(usable(count) && count >= 0);
  });
  return bad ? BREAKFAST_MESSAGE : null;
}

// A billable price (specs/settings-input-guards.md rule 54). A row with no label is dropped by the save, so it
// is not judged; a price already stored passes when sent back, the rows having no identity across a replace-all.
function billablePriceMessage(items, storedRows) {
  const kept = new Set((storedRows || []).map((row) => Number(row.price)));
  const bad = (Array.isArray(items) ? items : []).some((item) => {
    if (typeof item?.label !== 'string' ? item?.label == null : !item.label.trim()) return false;
    const price = readNumber(item.price);
    return price !== undefined && !kept.has(price) && !(usable(price) && price >= 0);
  });
  return bad ? PRICE_MESSAGE : null;
}

module.exports = { wholePiecesMessage, soldOptionsMessage, breakfastCountsMessage, billablePriceMessage };
