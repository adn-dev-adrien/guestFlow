import {
  formatCurrency, formatCurrencyRounded,
  displayDate, displayDateShort, displayDateLong, displayDateTime,
} from '../formatters';

// specs/design-system.md §3.7 — the only client-side money/date display formatters. Amounts use
// REGULAR spaces (grouping + before €), matching the app's historical output, not Intl narrow NBSP.

describe('formatCurrency', () => {
  test('formats with 2 decimals, comma, grouped thousands, regular spaces', () => {
    expect(formatCurrency(1234.5)).toBe('1 234,50 €');
    expect(formatCurrency(12.5)).toBe('12,50 €');
    expect(formatCurrency(0)).toBe('0,00 €');
    expect(formatCurrency(1234567.891)).toBe('1 234 567,89 €');
  });
  test('negative amounts keep the sign before the grouped figure', () => {
    expect(formatCurrency(-1234.5)).toBe('-1 234,50 €');
  });
  test('null / undefined / empty / NaN render as « — »', () => {
    expect(formatCurrency(null)).toBe('—');
    expect(formatCurrency(undefined)).toBe('—');
    expect(formatCurrency('')).toBe('—');
    expect(formatCurrency('abc')).toBe('—');
  });
  test('string numbers are accepted', () => {
    expect(formatCurrency('85')).toBe('85,00 €');
  });
});

describe('formatCurrencyRounded', () => {
  test('rounds to whole euros (KPI / chart style)', () => {
    expect(formatCurrencyRounded(1234.5)).toBe('1 235 €');
    expect(formatCurrencyRounded(999.49)).toBe('999 €');
    expect(formatCurrencyRounded(0)).toBe('0 €');
  });
  test('null renders as « — »', () => {
    expect(formatCurrencyRounded(null)).toBe('—');
  });
});

describe('date display roles', () => {
  test('displayDate → dd/mm/yyyy, « — » when empty', () => {
    expect(displayDate('2026-07-10')).toBe('10/07/2026');
    expect(displayDate('')).toBe('—');
  });
  test('displayDateShort → compact French month', () => {
    expect(displayDateShort('2026-07-10')).toBe('10 juil. 2026');
    expect(displayDateShort('')).toBe('');
    expect(displayDateShort('not-a-date')).toBe('not-a-date');
  });
  test('displayDateLong → full French month', () => {
    expect(displayDateLong('2026-07-10')).toBe('10 juillet 2026');
  });
  test('displayDateTime → short date + time, accepts SQLite "YYYY-MM-DD HH:MM" shape', () => {
    expect(displayDateTime('2026-07-10 14:35')).toBe('10/07/2026 14:35');
    expect(displayDateTime('')).toBe('');
  });
});
