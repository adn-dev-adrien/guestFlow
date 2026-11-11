/**
 * The weekdays of the laundry schedule (specs/linen-laundry-days.md §3.4), Monday first as in a French
 * calendar. Values follow `Date.prototype.getDay()`: 0 = Sunday … 6 = Saturday. `letter` labels the day
 * toggles, `abbr` the cycle lines (« Mar. → jeu. »).
 */

export const WEEKDAYS = [
  { value: 1, letter: 'L', abbr: 'lun.', label: 'lundi' },
  { value: 2, letter: 'M', abbr: 'mar.', label: 'mardi' },
  { value: 3, letter: 'M', abbr: 'mer.', label: 'mercredi' },
  { value: 4, letter: 'J', abbr: 'jeu.', label: 'jeudi' },
  { value: 5, letter: 'V', abbr: 'ven.', label: 'vendredi' },
  { value: 6, letter: 'S', abbr: 'sam.', label: 'samedi' },
  { value: 0, letter: 'D', abbr: 'dim.', label: 'dimanche' },
];

const byValue = (value) => WEEKDAYS.find((w) => w.value === Number(value));

export const weekdayAbbr = (value) => byValue(value)?.abbr || '';

export const weekdayLabel = (value) => byValue(value)?.label || '';

/** « mardi », « mardi et jeudi », « lundi, mercredi et vendredi ». */
export function weekdaysSentence(values) {
  const ordered = WEEKDAYS.filter((w) => values.includes(w.value)).map((w) => w.label);
  return new Intl.ListFormat('fr', { style: 'long', type: 'conjunction' }).format(ordered);
}
