// specs/accounting-synthesis.md §3 rule 46 (V2-1) — an axis label says its own value: one decimal in k€ when needed,
// never two equal labels on the nice steps the charts pick.
import { axisEuro } from '../synthesisCopy';

const nbsp = (s) => s.replace(/\s/g, ' ');

test('rule 46 — k€ with one decimal when needed, euros below', () => {
  expect(nbsp(axisEuro(1500))).toBe('1,5 k€');
  expect(nbsp(axisEuro(2000))).toBe('2 k€');
  expect(nbsp(axisEuro(2500))).toBe('2,5 k€');
  expect(nbsp(axisEuro(12500))).toBe('12,5 k€');
  expect(nbsp(axisEuro(500))).toBe('500 €');
  expect(nbsp(axisEuro(0))).toBe('0 €');
  expect(nbsp(axisEuro(0.5))).toBe('0,5 €');
});

test('rule 46 — no two equal labels on 500, 2 500 or 0,25 steps', () => {
  for (const [step, n] of [[500, 6], [2500, 6], [0.25, 5], [250, 6], [5000, 6]]) {
    const labels = Array.from({ length: n }, (_, i) => axisEuro(i * step));
    expect(new Set(labels).size).toBe(n);
  }
});
