/**
 * The one boundary guard of the numbers a reservation, devis or quote write carries on its lines and
 * party (specs/reservations-backend-mvc.md rule 15; specs/non-card-option-served-persons.md rule 27).
 * The SAS holds its intents to the same reading in `plugins/sas/sasQuantityBounds.js`.
 *
 * A bad number is refused, never clamped, before any pricing, so the preview and the save answer alike.
 * Only the request is judged: a typed count the line already stores passes when sent back unchanged.
 * Each function returns the refusal, or null when everything is acceptable.
 */
const { MAX_STAY_NIGHTS } = require('./stayDates');

// Not a business ceiling: past this, a finite number overflows to Infinity once priced and summed.
const MAX_MAGNITUDE = Number.MAX_SAFE_INTEGER;

const NUMERIC_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;

// undefined = not sent. NaN = sent, and not a number: a boolean or an array never counts as one.
function readNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && NUMERIC_TEXT.test(value.trim())) return Number(value);
  return NaN;
}

const usableNumber = (value) => Number.isFinite(value) && Math.abs(value) <= MAX_MAGNITUDE;

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
const INVALID_AMOUNT = { error: 'Montant invalide.', code: 'INVALID_AMOUNT' };

const LINE_LISTS = ['options', 'selectedOptions', 'customOptions', 'resources', 'selectedResources'];
const PARTY_FIELDS = ['adults', 'children', 'teens', 'babies', 'babyBeds', 'singleBeds', 'doubleBeds'];
const LINE_AMOUNTS = ['acompteContribTtc', 'soldeContribTtc'];

const sent = (value) => value !== undefined && value !== null;
const unusable = (value) => {
  const n = readNumber(value);
  return n !== undefined && !usableNumber(n);
};

/**
 * @param {object} body  the request: `options` / `selectedOptions`, `customOptions`, `resources` /
 *                       `selectedResources`, the party numbers
 * @param {object} [storedCounts]  see `refuseInvalidServedPersons`
 * @returns {{error, code, field?, optionId?}|null}
 */
function lineInputRefusal(body, storedCounts = {}) {
  for (const field of LINE_LISTS) {
    if (sent(body[field]) && !isLineList(body[field])) return { ...INVALID_LINES, field };
  }
  if (sent(body.offeredOptionIds) && !Array.isArray(body.offeredOptionIds)) return { ...INVALID_LINES, field: 'offeredOptionIds' };
  for (const field of PARTY_FIELDS) {
    if (unusable(body[field])) return { ...INVALID_QUANTITY, field };
  }
  for (const field of LINE_LISTS) {
    for (const line of body[field] || []) {
      if (unusable(line.quantity)) return { ...INVALID_QUANTITY, field: 'quantity' };
      for (const amount of LINE_AMOUNTS) {
        if (unusable(line[amount])) return { ...INVALID_AMOUNT, field: amount };
      }
    }
  }
  for (const line of body.customOptions || []) {
    if (unusable(line.amount)) return { ...INVALID_AMOUNT, field: 'amount' };
  }
  return refuseInvalidServedPersons(body.options, storedCounts)
    || refuseInvalidServedPersons(body.selectedOptions, storedCounts);
}

module.exports = { refuseInvalidServedPersons, lineInputRefusal };
