/**
 * specs/report-grammar.md §3 rules 22, 34 and 35 — verification round V5: the top tick hugs the largest
 * value (a 25,8 k€ cumul reads 0 / 10 / 20 / 30 k€, not 0 / 20 / 40 k€), and long category labels are
 * evenly spaced.
 */
import { axisTicks, endLabelCap, xInterval } from '../reportChart';

test('rule 34 — at most a quarter of the axis empty above the largest value', () => {
  expect(axisTicks([25823], { count: 2 }).ticks).toEqual([0, 10000, 20000, 30000]);
  const { domain: [, end] } = axisTicks([25823], { count: 2 });
  expect((end - 25823) / end).toBeLessThanOrEqual(0.25);
});

test('rule 34 — a value already on a nice step keeps the requested count', () => {
  expect(axisTicks([400], { count: 2 }).ticks).toEqual([0, 200, 400]);
  expect(axisTicks([0.18]).ticks).toEqual([0, 0.05, 0.1, 0.15, 0.2]);
});

test('rule 35 — long labels: every Nth from the first, never a forced last one', () => {
  const months = ['oct. 25', 'nov. 25', 'déc. 25'].map((label) => ({ key: label, label }));
  expect(xInterval(months, false)).toBe('equidistantPreserveStart');
});

test('rule 35 — measured: one evenly spaced N, never thinner than rule 12, enough for the longest label', () => {
  const months = ['oct. 26', 'nov. 26', 'déc. 26', 'janv. 27', 'févr. 27', 'mars 27', 'avr. 27', 'mai 27', 'juin 27', 'juil. 27', 'août 27', 'sept. 27']
    .map((label) => ({ key: label, label }));
  expect(xInterval(months, false, 900)).toBe(1);
  expect(xInterval(months, false, 300)).toBe(2);
  const short = months.map((m, i) => ({ key: m.key, label: ['oct.', 'nov.'][i % 2] }));
  expect(xInterval(short, false, 1200)).toBe(1);
});

test('rule 22 — the end names never take more than 30 % of a narrow chart', () => {
  expect(endLabelCap(false, 1000)).toBe(150);
  expect(endLabelCap(false, 300)).toBe(90);
  expect(endLabelCap(true, null)).toBe(96);
});
