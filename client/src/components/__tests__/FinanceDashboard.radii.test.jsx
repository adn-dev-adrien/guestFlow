/**
 * Finance dashboard radii — specs/finance-dashboard-redesign.md rule 32: cards at the theme's 14 px,
 * inner frames at 10 px. A plain number in sx.borderRadius is multiplied by 14, which gave 49 px
 * tiles and a 63 px banner in 3.7.0.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';

import theme from '../../theme';
import SelectableTile from '../SelectableTile';
import ChoiceCardStrip from '../ChoiceCardStrip';
import FinanceHero from '../FinanceHero';

const withTheme = (ui) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
const radius = (el) => getComputedStyle(el).borderRadius;

test('rule 32 — a tile is a 14 px card', () => {
  withTheme(<SelectableTile label="Encaissé" value="18 227 €" selected={false} onClick={() => {}} />);
  expect(radius(screen.getByRole('button', { name: 'Encaissé : afficher le détail' }))).toBe('14px');
});

test('rule 32 — a logement card is a 10 px inner frame', () => {
  withTheme(<ChoiceCardStrip items={[{ value: null, label: 'Tous les logements', figure: '22 630 €' }]} selected={null} onSelect={() => {}} ariaLabel="Logements" />);
  expect(radius(screen.getByRole('radio', { name: /Tous les logements/ }))).toBe('10px');
});

test('rule 32 — the banner is a 14 px card', () => {
  const hero = {
    revenue: 1000, revenueHt: 900, stays: 2, nights: 4, occupancy: 0.5, revenuePerNight: 250, directShare: 0.1,
    yoy: null, goal: null, cumulative: [{ day: '2026-06-01', x: 0, current: 0, previous: null }], axis: [{ x: 0, label: 'juin' }],
  };
  const format = { amount: (v) => `${v} €`, percent: (v) => `${v * 100} %`, date: (d) => d };
  withTheme(<FinanceHero hero={hero} windowLabel="juin 2026" asOf={null} fiscalYearLabel="2026" format={format} />);
  expect(radius(screen.getByRole('region', { name: "Chiffre d'affaires" }))).toBe('14px');
});
