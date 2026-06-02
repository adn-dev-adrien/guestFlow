/**
 * Weekday options for any "pick a day of week" Select in the app.
 * Values follow `Date.prototype.getDay()` convention: 0 = Sunday … 6 = Saturday.
 *
 * Currently consumed by SettingsLaundrySection (specs/weekly-bed-linen-tracking.md). Extract on
 * first reuse — future cleaning-day / reporting-day pickers should consume this constant.
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
