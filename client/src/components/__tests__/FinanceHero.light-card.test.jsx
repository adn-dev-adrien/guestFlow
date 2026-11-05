// specs/finance-dashboard-redesign.md rule 52 — the banner is a light card on theme tokens: white with
// a divider border and a fir rule on top, the figures' pills in their light-surface style, the « i » in
// its light variant, and no ink token left in the theme.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import FinanceHero from '../FinanceHero';

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

const HERO = {
  revenue: 30655, revenueHt: 27868, stays: 54, nights: 184, occupancy: 0.32, revenuePerNight: 167, directShare: 0.52,
  revPar: 53, openNights: 579, occupiedNights: 184,
  yoy: { current: 30655, previous: 21069, change: 45.5, months: 12, totalMonths: 12 }, goal: null,
  cumulative: [{ day: '2026-01-01', x: 0, current: 0, previous: 0 }, { day: '2026-12-31', x: 364, current: 30655, previous: 21069 }],
  axis: [{ x: 0, label: 'janv.' }], curveCompact: false,
};
const FORMAT = { amount: (n) => `${n} €`, percent: (x) => `${Math.round(x * 100)} %`, date: (d) => d };

const renderHero = () => render(
  <ThemeProvider theme={theme}>
    <FinanceHero
      hero={HERO} windowLabel="Exercice 2026" fiscalYearLabel="2026" format={FORMAT}
      comparisons={{ occupancy: { change: 10.9, previous: '20,9 %', unit: 'points' }, revenuePerNight: { change: -4.3, previous: '174 €', unit: 'percent' } }}
      definitions={{ occupancy: 'Nuits vendues ÷ nuits ouvertes.' }}
    />
  </ThemeProvider>,
);

test('rule 52 — a white card with a divider border and a fir rule on top', () => {
  renderHero();
  const card = getComputedStyle(screen.getByRole('region', { name: "Chiffre d'affaires" }));
  expect(card.backgroundColor).toBe(rgb(theme.palette.background.paper));
  expect(card.boxShadow.toLowerCase()).toContain(`inset 0 3px 0 ${theme.palette.primary.main}`.toLowerCase());
  expect(card.color).toBe(rgb(theme.palette.text.primary));
});

test('rule 52 — the kicker in fir, the revenue in ink', () => {
  renderHero();
  expect(getComputedStyle(screen.getByText(/^Chiffre d'affaires · Exercice 2026/)).color).toBe(rgb(theme.palette.primary.main));
  expect(getComputedStyle(screen.getByText('30655 €')).color).not.toBe('rgb(255, 255, 255)');
});

test('rule 52 — the pills keep their light-surface style, the « i » its light variant', () => {
  renderHero();
  const good = screen.getByText('↑ +10,9 pt').parentElement;
  expect(good).toHaveAttribute('data-tone', 'good');
  expect(getComputedStyle(good).color).toBe(rgb(theme.palette.success.text));
  expect(getComputedStyle(good).backgroundColor).toBe(rgb(theme.palette.success.soft));
  const bad = screen.getByText('↓ −4,3 %').parentElement;
  expect(getComputedStyle(bad).color).toBe(rgb(theme.palette.error.text));
  expect(getComputedStyle(screen.getByRole('button', { name: "Définition : taux d'occupation" })).backgroundColor).toBe(rgb(theme.palette.neutral.soft));
});

test('rule 52 — no ink token is left in the theme', () => {
  expect(theme.palette.chart.onInk).toBeUndefined();
});
