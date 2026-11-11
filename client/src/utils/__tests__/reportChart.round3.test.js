/**
 * specs/report-grammar.md §3 rules 38, 39 and 40 — verification round 2 (V3-8, V3-4, V3-7): the axis
 * hugs a negative minimum as it hugs the maximum, an end name that fits a narrow chart is never cut on
 * a wider one, and the hero's months are evenly spaced.
 */
import { axisTicks, endLabelCap, endLabelWidth, fitEndLabel, everyNth, xInterval } from '../reportChart';

test('rule 38 — a −300 € day on a 2 000 € axis: −1 000 … 2 000, not −2 000 … 2 000', () => {
  expect(axisTicks([-300, 2000], { count: 2 }).ticks).toEqual([-1000, 0, 1000, 2000]);
});

test('rule 38 — at most one step beyond each end, and 0 stays a tick when the range crosses it', () => {
  for (const values of [[-300, 2000], [-50, 800], [-120, 380], [-900, 150], [-25823, 25823], [-0.04, 0.18]]) {
    const { ticks } = axisTicks(values, { count: 2 });
    const step = ticks[1] - ticks[0];
    const lo = Math.min(0, ...values);
    const hi = Math.max(0, ...values);
    expect(lo - ticks[0]).toBeLessThan(step);
    expect(ticks[ticks.length - 1] - hi).toBeLessThan(step);
    expect(ticks.some((t) => Math.abs(t) < 1e-9)).toBe(true);
  }
  expect(axisTicks([-50, 800], { count: 2 }).ticks[0]).toBeGreaterThanOrEqual(-250);
});

test('rule 39 — « Exercice 2025-2026 » is whole in a 434 px chart, as in a 542 px one', () => {
  const name = 'Exercice 2025-2026';
  expect(fitEndLabel(name, endLabelCap(false, 434))).toBe(name);
  expect(fitEndLabel(name, endLabelCap(false, 542))).toBe(name);
  expect(endLabelCap(false, 434)).toBeGreaterThanOrEqual(endLabelWidth(name));
});

test('rule 39 — the cap only grows with the chart: a name that fits never gets cut on a wider chart', () => {
  let previous = 0;
  for (let w = 120; w <= 1600; w += 10) {
    const cap = endLabelCap(false, w);
    expect(cap).toBeGreaterThanOrEqual(previous);
    previous = cap;
  }
});

test('rule 40 — the hero months: every Nth from the first, no month dropped unevenly', () => {
  const months = ['oct.', 'nov.', 'déc.', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.'];
  const cats = months.map((label, i) => ({ key: i, label }));
  expect(xInterval(cats, false, 1000, { thin: false })).toBe(0);
  const at900 = xInterval(cats, false, 300, { thin: false });
  expect(at900).toBe(1);
  expect(everyNth(months, at900)).toEqual(['oct.', 'déc.', 'févr.', 'avr.', 'juin', 'août']);
  expect(everyNth(months, 2)).toEqual(['oct.', 'janv.', 'avr.', 'juil.']);
});
