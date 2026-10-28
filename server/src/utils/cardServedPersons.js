/**
 * specs/card-option-served-persons.md §3 rule 3 — « A value ≤ 0 is refused ». The engine still reads
 * a missing count as the party; an explicit count of 0 or less (or one that is not a number) is a
 * request error, answered before any pricing, never silently priced as the whole party.
 * Returns the 400 body, or null when every line is acceptable.
 */
function refuseInvalidServedPersons(selectedOptions) {
  const lines = Array.isArray(selectedOptions) ? selectedOptions : [];
  const bad = lines.find((line) => line && line.cardPersons !== undefined && line.cardPersons !== null
    && line.cardPersons !== '' && !(Number.isFinite(Number(line.cardPersons)) && Number(line.cardPersons) > 0));
  if (!bad) return null;
  return {
    error: 'Personnes servies : au moins 1. Pour retirer la prestation, la désactiver.',
    code: 'INVALID_CARD_PERSONS',
    optionId: bad.optionId ?? null,
  };
}

module.exports = { refuseInvalidServedPersons };
