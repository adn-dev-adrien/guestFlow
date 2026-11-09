/**
 * specs/report-grammar.md §3 rule 13 — the categories of a report chart take the theme's chart hues
 * minus the red (kept for alerts), each one a 3:1 mark on white; a series without its own colour gets
 * the n-th one, a dashed one the last-year edge.
 */
import { chart, categoricalColor } from '../../utils/chartColors';
import theme from '../../theme';
import { withColors } from '../TrendChart';

const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  .reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);

test('rule 13 — five hues, no alert red, all ≥ 3:1 on white', () => {
  expect(chart.categorical).toHaveLength(5);
  expect(chart.categorical).not.toContain(theme.palette.error.main);
  chart.categorical.forEach((hex) => {
    expect(chart.series).toContain(hex);
    expect(1.05 / (lum(hex) + 0.05)).toBeGreaterThanOrEqual(3);
  });
  expect(categoricalColor(6)).toBe(chart.categorical[1]);
});

test('rule 13 — default colours: palette order for solid series, last-year edge for dashed, own colour kept', () => {
  const out = withColors([{ key: 'a' }, { key: 'n1', dashed: true }, { key: 'b' }, { key: 'c', color: '#123456' }]);
  expect(out.map((s) => s.color)).toEqual([chart.categorical[0], chart.lastYearEdge, chart.categorical[1], '#123456']);
});
