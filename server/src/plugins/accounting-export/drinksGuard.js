/**
 * The drinks account guard of the export (specs/outside-booking-sas.md rule 43). A drink sold outside a stay has no default account: the journal of a
 * period that holds one is refused until the accountant sets `drinksRevenueAccount`, never booked on a wrong account. A period with no drink is unaffected.
 */
const { csvJournal } = require('./accountingExport');

const REFUSAL = Object.freeze({
  status: 409,
  body: Object.freeze({
    error: "Compte des boissons à renseigner avant l'export.", code: 'DRINKS_ACCOUNT_REQUIRED', setting: 'drinksRevenueAccount', page: 'Plan comptable',
  }),
});

const hasDrinks = (entries) => (entries || []).some((entry) => entry.direction === 'standalone' && csvJournal.entryLines(entry).some((line) => line.role === 'revenue:drinks'));

/** `null` when the journal may be written, else `{ status: 409, body }`. */
function drinksAccountRefusal(entries, plan) {
  if (plan && String(plan.drinksRevenueAccount || '').trim()) return null;
  return hasDrinks(entries) ? REFUSAL : null;
}

module.exports = { drinksAccountRefusal };
