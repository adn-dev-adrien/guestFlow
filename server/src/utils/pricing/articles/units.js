/**
 * Billed units of an article line (specs/pricing-components.md §3 rules 10, 47) — the unit arithmetic the families share,
 * moved unchanged from the engine. `resolveNonCardUnits` reads the typed counts (« 3 personnes », « 2 nuits ») of a
 * non-card line; the per-person and per-night families call it with their own price type.
 *
 * Internal to `articles/`: the rest of the code reaches these through the head (`articles/index.js`).
 */
const { roundMoney } = require('../money');

function getTypeMultiplier(priceType, persons, nights) {
  if (priceType === 'per_person') return persons;
  if (priceType === 'per_night') return nights;
  if (priceType === 'per_person_per_night') return persons * nights;
  return 1;
}

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
 * Billed units of a non-card option (specs/non-card-option-served-persons.md rules 2-5 and 19). What
 * the operator typed is a count of people or of nights and stays that count: it is never derived from
 * the party or the stay again. NULL follows them. `quantity` remains the base of the other dimensions
 * (normally 1); a line that drifted before this rule keeps it and reads as what it bills (rule 18).
 *
 * @param {{priceType: string, quantity: number, persons: number, nights: number,
 *          cardPersons?: number|null, cardNights?: number|null, maxGuests?: number}} params
 * @returns {{billedUnits: number, cardPersons: number|null, cardNights: number|null,
 *            servedPersons?: number, servedNights?: number}}
 */
function resolveNonCardUnits({
  priceType, quantity, persons, nights, cardPersons, cardNights, maxGuests,
}) {
  if (priceType === 'per_person' || priceType === 'per_person_per_night') {
    const wanted = Number(cardPersons) > 0 ? Math.floor(Number(cardPersons)) : null;
    const covers = resolveServedPersons({ cardPersons: wanted, persons, maxGuests });
    return {
      billedUnits: roundMoney(quantity * covers.served * (priceType === 'per_person' ? 1 : nights)),
      cardPersons: covers.stored,
      cardNights: null,
      servedPersons: roundMoney(quantity * covers.served),
    };
  }
  if (priceType === 'per_night') {
    const wanted = Number(cardNights) > 0 ? Math.floor(Number(cardNights)) : null;
    const counted = wanted != null ? wanted : nights;
    return {
      billedUnits: roundMoney(quantity * counted),
      cardPersons: null,
      cardNights: counted === nights ? null : counted,
      servedNights: roundMoney(quantity * counted),
    };
  }
  return {
    billedUnits: roundMoney(quantity * getTypeMultiplier(priceType, persons, nights)),
    cardPersons: null,
    cardNights: null,
  };
}

module.exports = { getTypeMultiplier, resolveServedPersons, resolveNonCardUnits };
