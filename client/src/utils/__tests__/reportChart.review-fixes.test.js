/**
 * specs/report-grammar.md §3 rules 21, 22 and 26 — review round R5 / R3: y ticks on nice steps or
 * a fixed domain, end names kept inside the plot and fitted to their margin, long category labels
 * thinned by their measured width.
 */
import { axisTicks, niceStep, layoutEndLabels, endLabelMargin, fitEndLabel, endLabelWidth, xInterval } from '../reportChart';

test('rule 21 — nice steps are 1, 2, 2,5 or 5 times a power of ten', () => {
  expect([0.9, 1.6, 2.2, 4, 7, 45, 1300].map(niceStep)).toEqual([1, 2, 2.5, 5, 10, 50, 2000]);
});

test('rule 21 — an occupancy of 0–18 % no longer reads 0 / 4,5 / 9 / 13,5 / 18: nice ticks from 0', () => {
  expect(axisTicks([0.02, 0.18, null])).toEqual({ domain: [0, 0.2], ticks: [0, 0.05, 0.1, 0.15, 0.2] });
  expect(axisTicks([6200, 25800]).ticks).toEqual([0, 10000, 20000, 30000]);
});

test('rule 21 — a fixed domain gives five even ticks across it (0, 25, 50, 75, 100 %)', () => {
  expect(axisTicks([0.16], { domain: [0, 1] })).toEqual({ domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1] });
});

test('rule 21 — a negative value takes the axis below 0; all zeros still draws an axis', () => {
  expect(axisTicks([-120, 380]).ticks).toEqual([-200, 0, 200, 400]);
  expect(axisTicks([0, 0]).domain).toEqual([0, 0.25]);
});

test('rule 22 — a name ending on the baseline climbs above the axis labels and pushes the one above', () => {
  const out = layoutEndLabels([{ key: 'a', y: 196 }, { key: 'b', y: 200 }], 15, 4, { top: 20, bottom: 196 });
  expect(out.map((e) => [e.key, e.labelY])).toEqual([['a', 181], ['b', 196]]);
  expect(layoutEndLabels([{ key: 'top', y: 2 }], 15, 4, { top: 20, bottom: 196 })[0].labelY).toBe(20);
});

test('rules 22 — the right margin holds the longest name, within its cap; past it the name is cut with « … »', () => {
  expect(endLabelMargin(['2025-26', 'N-1'], 150)).toBe(endLabelWidth('2025-26'));
  expect(endLabelMargin(['Exercice 2025-2026'], 96)).toBe(96);
  expect(endLabelMargin(['a'], 150)).toBe(40);
  expect(fitEndLabel('Exercice 2025-2026', 96)).toBe('Exercice 2…');
  expect(fitEndLabel('2026-2027', 96)).toBe('2026-2027');
});

test('rules 26 and 35 — short labels keep the regular thinning; long ones every Nth from the first, evenly spaced', () => {
  const short = Array.from({ length: 12 }, (_, i) => ({ key: String(i), label: 'oct.' }));
  expect(xInterval(short, false)).toBe(1);
  expect(xInterval([{ key: 'a', label: 'oct. 2025' }], false)).toBe('equidistantPreserveStart');
});
