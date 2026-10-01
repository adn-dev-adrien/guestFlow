/**
 * Weekday options of the « Jour de blanchisserie » Select (specs/weekly-bed-linen-tracking.md).
 * Values follow `Date.prototype.getDay()` convention: 0 = Sunday … 6 = Saturday.
 */

export const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Lundi' },
  { value: 2, label: 'Mardi' },
  { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' },
  { value: 5, label: 'Vendredi' },
  { value: 6, label: 'Samedi' },
  { value: 0, label: 'Dimanche' },
];

export function labelForWeekday(value) {
  const entry = WEEKDAY_OPTIONS.find((w) => w.value === Number(value));
  return entry ? entry.label : '';
}
