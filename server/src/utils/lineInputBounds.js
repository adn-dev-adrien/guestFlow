/**
 * The one reading of a number at a write boundary (`readNumber`, `usableNumber`, `numberRefused`), and the
 * guard of what a reservation, devis or quote write carries on its lines and party
 * (specs/reservations-backend-mvc.md rules 15-16; specs/non-card-option-served-persons.md rule 34). The
 * money fields (`financeValidation.js`), the catalogue and the billable prices reuse the reading; the SAS
 * holds its intents to the same one in `plugins/sas/sasQuantityBounds.js`.
 *
 * A bad number is refused, never clamped, before any pricing, so the preview and the save answer alike.
 * Only the request is judged: a typed count the line already stores passes when sent back unchanged.
 * Each function returns the refusal, or null when everything is acceptable.
 */
const { MAX_STAY_NIGHTS } = require('./stayDates');

// Not a business ceiling: past this, a finite number overflows to Infinity once priced and summed.
const MAX_MAGNITUDE = Number.MAX_SAFE_INTEGER;

const NUMERIC_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;

// undefined = not sent. NaN = sent, and not a number: a boolean, an array or text of spaces never counts as one.
function readNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  const text = value.trim();
  return NUMERIC_TEXT.test(text) ? Number(text) : NaN;
}

const usableNumber = (value) => Number.isFinite(value) && Math.abs(value) <= MAX_MAGNITUDE;

const nonNegative = (n) => n >= 0;
const wholeFrom = (min) => (n) => Number.isSafeInteger(n) && n >= min;

/**
 * Whether a sent value is refused: not a usable number, or one `valid` rejects. Not sent is never refused,
 * and neither is the value the row already stores, sent back unchanged.
 */
function numberRefused(value, valid = () => true, stored = undefined) {
  const n = readNumber(value);
  if (n === undefined) return false;
  if (stored !== undefined && stored !== null && Number(stored) === n) return false;
  return !usableNumber(n) || !valid(n);
}

// A tier table or a date-range list: an array, or the JSON a stored row or an older form holds it in.
function rowsOf(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const isLineList = (value) => Array.isArray(value)
  && value.every((line) => line && typeof line === 'object' && !Array.isArray(line));

const TYPED_COUNTS = [
  {
    field: 'cardPersons',
    code: 'INVALID_CARD_PERSONS',
    error: 'Personnes servies : un nombre entier, au moins 1. Pour retirer la prestation, la désactiver.',
    valid: (n) => Number.isSafeInteger(n) && n >= 1,
  },
  {
    field: 'cardNights',
    code: 'INVALID_CARD_NIGHTS',
    error: `Nuits : un nombre entier de 1 à ${MAX_STAY_NIGHTS}.`,
    valid: (n) => Number.isSafeInteger(n) && n >= 1 && n <= MAX_STAY_NIGHTS,
  },
];

/**
 * @param {Array} lines  the option lines of the request
 * @param {object} [stored]  `{ [optionId]: { cardPersons, cardNights } }`, what the booking stores
 */
function refuseInvalidServedPersons(lines, stored = {}) {
  for (const line of Array.isArray(lines) ? lines : []) {
    for (const { field, code, error, valid } of TYPED_COUNTS) {
      const count = readNumber(line?.[field]);
      if (count === undefined || valid(count)) continue;
      const kept = stored[Number(line.optionId)]?.[field];
      if (kept != null && Number(kept) === count) continue;
      return { error, code, optionId: line.optionId ?? null };
    }
  }
  return null;
}

const INVALID_LINES = { error: 'Lignes invalides.', code: 'INVALID_LINES' };
const INVALID_QUANTITY = { error: 'Quantité invalide.', code: 'INVALID_QUANTITY' };
const INVALID_PARTY = { error: 'Voyageurs et lits : un nombre entier, 0 ou plus.', code: 'INVALID_QUANTITY' };
const INVALID_AMOUNT = { error: 'Montant invalide.', code: 'INVALID_AMOUNT' };

const LINE_LISTS = ['options', 'selectedOptions', 'customOptions', 'resources', 'selectedResources'];
const PARTY_FIELDS = ['adults', 'children', 'teens', 'babies', 'babyBeds', 'singleBeds', 'doubleBeds'];
const LINE_AMOUNTS = ['acompteContribTtc', 'soldeContribTtc'];
const LINE_IDS = { options: 'optionId', selectedOptions: 'optionId', resources: 'resourceId', selectedResources: 'resourceId' };

const sent = (value) => value !== undefined && value !== null;

function repeatedLineList(body) {
  for (const [field, key] of Object.entries(LINE_IDS)) {
    const seen = new Set();
    for (const line of body[field] || []) {
      const id = readNumber(line[key]);
      if (!id) continue;
      if (seen.has(id)) return field;
      seen.add(id);
    }
  }
  return null;
}

/**
 * @param {object} body  the request: `options` / `selectedOptions`, `customOptions`, `resources` /
 *                       `selectedResources`, the party numbers
 * @param {object} [storedCounts]  see `refuseInvalidServedPersons`
 * @param {object} [storedRow]  the row being saved or quoted: a party number it stores is not re-judged
 * @returns {{error, code, field?, optionId?}|null}
 */
function lineInputRefusal(body, storedCounts = {}, storedRow = null) {
  for (const field of LINE_LISTS) {
    if (sent(body[field]) && !isLineList(body[field])) return { ...INVALID_LINES, field };
  }
  if (sent(body.offeredOptionIds) && !Array.isArray(body.offeredOptionIds)) return { ...INVALID_LINES, field: 'offeredOptionIds' };
  const repeated = repeatedLineList(body);
  if (repeated) return { ...INVALID_LINES, field: repeated };
  for (const field of PARTY_FIELDS) {
    if (numberRefused(body[field], wholeFrom(0), storedRow?.[field])) return { ...INVALID_PARTY, field };
  }
  for (const field of LINE_LISTS) {
    for (const line of body[field] || []) {
      if (numberRefused(line.quantity)) return { ...INVALID_QUANTITY, field: 'quantity' };
      for (const amount of LINE_AMOUNTS) {
        if (numberRefused(line[amount])) return { ...INVALID_AMOUNT, field: amount };
      }
    }
  }
  for (const line of body.customOptions || []) {
    if (numberRefused(line.amount)) return { ...INVALID_AMOUNT, field: 'amount' };
  }
  return refuseInvalidServedPersons(body.options, storedCounts)
    || refuseInvalidServedPersons(body.selectedOptions, storedCounts);
}

module.exports = {
  readNumber, usableNumber, numberRefused, nonNegative, wholeFrom, rowsOf, refuseInvalidServedPersons, lineInputRefusal,
};
