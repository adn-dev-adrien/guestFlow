// specs/finance-dashboard-redesign.md rule 47 — the finance badges and insight icons read their soft
// background and their text from the theme: `<semantic>.soft` under `<semantic>.text` (≥ 4.5:1),
// never a hex of their own, never `main` on a pale background.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import YearOverYearBadge from '../YearOverYearBadge';
import InsightCard from '../InsightCard';

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const withTheme = (node) => render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);

test.each([
  [12, 'success'],
  [-8, 'error'],
  [0.1, 'neutral'],
])('rule 47: a change of %s reads as %s text on its soft token', (change, tone) => {
  withTheme(<YearOverYearBadge change={change} />);
  const badge = screen.getByText(/vs N-1/);
  const style = getComputedStyle(badge);
  expect(style.color).toBe(rgb(theme.palette[tone].text));
  expect(style.backgroundColor).toBe(rgb(theme.palette[tone].soft));
});

test.each(['success', 'warning', 'error', 'info'])('rule 47: the %s insight icon sits on its soft token', (tone) => {
  withTheme(<InsightCard tone={tone} title="Titre" text="Texte" />);
  const icon = screen.getByText('Titre').closest('.MuiCardContent-root').firstChild;
  const style = getComputedStyle(icon);
  expect(style.backgroundColor).toBe(rgb(theme.palette[tone].soft));
  expect(style.color).toBe(rgb(theme.palette[tone].text));
});

test('rule 47: the « Canaux » dot is a chart token', () => {
  expect(theme.palette.chart.channels).toMatch(/^#[0-9A-F]{6}$/i);
});
