/**
 * The number an operator types on a non-card option: people served, or nights
 * (specs/non-card-option-served-persons.md rules 8, 9 and 19). The client carries that number as it
 * is and never multiplies nor divides it (rule 11): what it bills comes back from the server.
 */
const PERSON_TYPES = new Set(['per_person', 'per_person_per_night']);

// 'persons', 'nights', or null when the option's quantity is a plain number of units.
export const typedCountKind = (option) => {
  if (option?.showsPlanningCard) return null;
  if (option?.isCancellationInsurance || option?.priceType === 'percent_of_stay') return null;
  if (PERSON_TYPES.has(option?.priceType)) return 'persons';
  return option?.priceType === 'per_night' ? 'nights' : null;
};

// What the field shows: the typed number, else the party or the stay. A line that drifted before the
// rule reads as what it bills, as the server computed it (rule 18).
export const typedCountValue = (selected, kind, current) => {
  const typed = kind === 'nights' ? selected?.cardNights : selected?.cardPersons;
  if (typed != null) return Number(typed);
  if (selected && Number(selected.quantity) !== 1) {
    const billed = kind === 'nights' ? selected.servedNights : selected.servedPersons;
    if (billed != null) return Number(billed);
  }
  return current;
};
