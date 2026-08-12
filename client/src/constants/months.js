/**
 * French month labels for any "pick a month" Select in the app.
 * Values are 1-based (1 = January … 12 = December), matching how months are passed around the API
 * (`?month=`), NOT the 0-based `Date.getMonth()`.
 *
 * Consumed by MonthYearPicker and SettingsFiscalYearSection
 * (specs/fiscal-year-and-nights-sold.md §6.1).
 */

export const MONTH_LABELS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

export const MONTH_OPTIONS = MONTH_LABELS.map((label, index) => ({ value: index + 1, label }));

export function labelForMonth(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? MONTH_LABELS[n - 1] : '';
}
