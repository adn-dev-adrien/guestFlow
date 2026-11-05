// specs/finance-revpar-year-over-year.md §3 rule 16 — a server metric becomes the pill's props: its
// change and unit as sent, last year's value formatted, « — vs N-1 » (change null) when it does not compare.
import { comparisonPill, rateOneDecimal } from '../comparisonPill';

test('rule 16 — a comparable metric keeps the server\'s change and unit, last year formatted', () => {
  expect(comparisonPill({ current: 0.32, previous: 0.2094, change: 10.9, unit: 'points', comparable: true }, rateOneDecimal))
    .toEqual({ change: 10.9, previous: '20,9 %', unit: 'points' });
});

test('rule 16 — not comparable → change null, no last-year value; no metric → no pill', () => {
  expect(comparisonPill({ current: 500, previous: 0, change: null, unit: 'percent', comparable: false, reason: 'noPreviousValue' }, String))
    .toEqual({ change: null, unit: 'percent' });
  expect(comparisonPill(undefined, String)).toBeUndefined();
});

test('rule 16 — a rate is written with one decimal and a comma', () => {
  expect(rateOneDecimal(0.5)).toBe('50,0 %');
  expect(rateOneDecimal(0.12345)).toBe('12,3 %');
});
