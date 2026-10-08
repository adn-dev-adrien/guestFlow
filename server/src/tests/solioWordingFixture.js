/**
 * Solio's wording on in-memory stay facts — what `productisation_v1` writes into Solio's database
 * (specs/plugins-phase-p-productisation.md rule 24), built from the same constants. Not a test file:
 * the suites that check Solio's sentences import it instead of a database.
 */

const {
  SOLIO_TEXTS, HOUSE_WITH_FILTER_COFFEE, solioMentionsFor, confirmationOrderFor,
} = require('../utils/productisationMigration');

/**
 * @param {object} facts  stay facts as `loadStayFacts` returns them (optionMeta + available).
 * @param {{ filterCoffee?: boolean }} property  the « cafetière familiale » variant for this property.
 */
function withSolioWording(facts = {}, { filterCoffee = false } = {}) {
  const byId = new Map();
  for (const o of Object.values(facts.optionMeta || {})) byId.set(Number(o.id), o);
  for (const o of facts.available || []) byId.set(Number(o.id), { ...(byId.get(Number(o.id)) || {}), ...o });
  const mentions = solioMentionsFor([...byId.values()]).map((m, index) => ({ ...m, id: index + 1 }));
  const idByRole = Object.fromEntries(mentions.map((m) => [m.role, m.id]));
  return {
    ...facts,
    texts: { global: SOLIO_TEXTS, property: filterCoffee ? { house: HOUSE_WITH_FILTER_COFFEE } : {} },
    mentions,
    confirmationOrder: confirmationOrderFor(idByRole),
  };
}

module.exports = { withSolioWording };
