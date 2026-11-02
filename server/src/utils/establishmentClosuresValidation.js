/**
 * Establishment closures validation — pure helpers, French errors.
 *
 * Overlap detection involves DB queries and lives in the model layer.
 * Only stateless range validation is here.
 */

const { isRealIsoDay, dateBeyondHorizon, HORIZON_MESSAGE } = require('./stayDates');

// specs/establishment-closures.md rule 18 — two years, a leap day included. A recipe closure spans
// a few weeks; a closure ending in 9999 was a typo every availability read then paid for.
const MAX_CLOSURE_DAYS = 731;
const DAY_MS = 86400000;

const MESSAGES = {
  missing: 'Les dates de début et de fin sont obligatoires.',
  invalidDate: 'Date invalide.',
  reversed: 'La date de fin doit être postérieure à la date de début.',
  tooLong: 'Fermeture trop longue : 2 ans au plus.',
  tooFar: HORIZON_MESSAGE,
};

/**
 * The refusal message of a closure's range, `null` when it can be saved. `stored` is the closure being
 * edited: rule 18 (reading of 2026-11-02) holds only a date that differs from it to the horizon, so a closure a tariff recipe
 * wrote past it still saves with its dates untouched.
 */
function validateRange(startDate, endDate, { stored = null } = {}) {
  if (!startDate || !endDate) return MESSAGES.missing;
  if (!isRealIsoDay(startDate) || !isRealIsoDay(endDate)) return MESSAGES.invalidDate;
  if (startDate >= endDate) return MESSAGES.reversed;
  if ((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS > MAX_CLOSURE_DAYS) return MESSAGES.tooLong;
  for (const [field, value] of [['startDate', startDate], ['endDate', endDate]]) {
    if (!(stored && stored[field] === value) && dateBeyondHorizon(value)) return MESSAGES.tooFar;
  }
  return null;
}

module.exports = { validateRange, MAX_CLOSURE_DAYS, MESSAGES };
