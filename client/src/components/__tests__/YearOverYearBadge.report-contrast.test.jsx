// specs/report-grammar.md §3 rule 19 — in report mode the pill writes in its tone's `text` shade on its
// `soft` background, ≥ 4.5:1 for small text; `main` would fall short (success: 4.2:1).
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import YearOverYearBadge from '../YearOverYearBadge';

const channel = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };

test.each([
  ['success', { change: 44.4, previous: '20 534 €' }],
  ['error', { change: -4.3, previous: '174 €' }],
  ['neutral', { change: 0.01, previous: '45' }],
  ['neutral', { change: null, showEmpty: true }],
])('rule 19 — a %s pill reads its text shade on its soft background, ≥ 4.5:1', (tone, props) => {
  render(<ThemeProvider theme={theme}><YearOverYearBadge {...props} /></ThemeProvider>);
  const pill = document.querySelector('[data-tone]');
  const style = getComputedStyle(pill);
  expect(style.color).toBe(rgb(theme.palette[tone].text));
  expect(style.backgroundColor).toBe(rgb(theme.palette[tone].soft));
  expect(contrast(theme.palette[tone].text, theme.palette[tone].soft)).toBeGreaterThanOrEqual(4.5);
  expect(screen.getByText(/N-1/)).toBeInTheDocument();
});

test('rule 19 — why not `main`: the success main falls short on its soft background', () => {
  expect(contrast(theme.palette.success.main, theme.palette.success.soft)).toBeLessThan(4.5);
});
