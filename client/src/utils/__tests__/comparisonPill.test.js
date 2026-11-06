// specs/finance-revpar-year-over-year.md §3 rules 16, 19 and 24 — a server metric becomes the pill's props: its
// change and unit as sent, last year's value formatted, « — vs N-1 » (change null) when it does not compare.
import { comparisonPill, rateOneDecimal, perNightAmount } from '../comparisonPill';

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

test('rule 19 — a partial comparison names its span after last year\'s value', () => {
  expect(comparisonPill({ previous: 76, change: -61.8, unit: 'percent', comparable: true }, String, { complete: false, months: 10 }))
    .toEqual({ change: -61.8, previous: '76 · sur 10 mois', unit: 'percent' });
  expect(comparisonPill({ previous: 76, change: 1, unit: 'percent', comparable: true }, String, { complete: true, months: 12 }).previous).toBe('76');
});

test('rule 24 — a per-night amount keeps its cents under 100 €', () => {
  expect(perNightAmount(5.26)).toMatch(/^5,26\s?€$/);
  expect(perNightAmount(167.4)).toMatch(/^167\s?€$/);
});
