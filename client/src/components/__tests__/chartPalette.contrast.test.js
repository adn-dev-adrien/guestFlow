/**
 * Chart palette — specs/finance-dashboard-redesign.md rule 45 (UI/UX review 2026-10-18, proposal 9):
 * every chart colour is a theme token, and the ones that carry information hold their contrast on
 * white — 3:1 for a mark (WCAG 1.4.11), 4.5:1 for a tick or a written value (1.4.3).
 */
import theme from '../../theme';
import { chart } from '../../utils/chartColors';

const channel = (v) => {
  const x = v / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b = '#FFFFFF') => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('rule 45 — the palette lives in the theme, under palette.chart', () => {
  expect(theme.palette.chart).toBe(chart);
  expect(chart.current).toBe(theme.palette.primary.main);
});

test('rule 45 — marks reach 3:1 on white, ticks and values 4.5:1', () => {
  ['current', 'upcoming', 'lastYearEdge', 'today'].forEach((k) => expect(contrast(chart[k])).toBeGreaterThanOrEqual(3));
  chart.series.forEach((hex) => expect(contrast(hex)).toBeGreaterThanOrEqual(3));
  expect(contrast(chart.tick)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(chart.value)).toBeGreaterThanOrEqual(4.5);
  // The sand bar alone is too light (1.5:1): it is always drawn with its edge, which holds 3:1 on the
  // white around it.
  expect(contrast(chart.lastYear)).toBeLessThan(3);
  expect(contrast(chart.lastYearEdge)).toBeGreaterThanOrEqual(3);
});
