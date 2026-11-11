/**
 * What the per-person families share (specs/pricing-components.md §3 rules 10, 47): how many people a line serves. The
 * per-type arithmetic (multiplier, typed counts) belongs to each family; the head dispatches by family id only.
 *
 * Internal to `articles/`: the rest of the code reaches these through the head (`articles/index.js`).
 */

/**
 * How many people a per-person card option serves, and what to store for it
 * (specs/card-option-served-persons.md §3.1). A meal or a breakfast is not always taken by the whole
 * party — the children often skip it — so the operator can lower (or raise, up to the property's
 * capacity) the number of covers of one prestation.
 *
 * `served` is what the money is computed from; `stored` is what goes to
 * `reservation_options.cardPersons`, and it is NULL whenever the number equals the current party:
 * such a line keeps FOLLOWING the party, so editing « adultes / enfants » still re-prices it (rule 4).
 * A deliberately different number is persisted and then stays put.
 *
 * @param {{cardPersons?: number|null, persons?: number, maxGuests?: number}} params
 * @returns {{served: number, stored: number|null}}
 */
function resolveServedPersons({ cardPersons, persons, maxGuests } = {}) {
  const party = Math.max(0, Number(persons) || 0);
  // Never below the party actually staying: everyone present can always be served, whatever the
  // configured capacity says.
  const ceiling = Math.max(1, party, Number(maxGuests) > 0 ? Math.floor(Number(maxGuests)) : 0);
  const wanted = Number(cardPersons);
  // Absent / unparsable / ≤ 0 → the party. Serving 0 person is not how a prestation is removed, and
  // neither is unticking its moments (specs/unscheduled-card-option.md rule 5): switch it off.
  const served = Number.isFinite(wanted) && wanted > 0
    ? Math.min(Math.max(1, wanted), ceiling)
    : party;
  return { served, stored: served === party ? null : served };
}

/**
 * The covers a non-card per-person line serves: the operator's typed count (floored) or the party, capped like a card
 * (specs/non-card-option-served-persons.md rules 2-5).
 */
function resolveCoveredPersons({ cardPersons, persons, maxGuests }) {
  const wanted = Number(cardPersons) > 0 ? Math.floor(Number(cardPersons)) : null;
  return resolveServedPersons({ cardPersons: wanted, persons, maxGuests });
}

module.exports = { resolveServedPersons, resolveCoveredPersons };
