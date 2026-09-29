/**
 * Chart tooltips of the Suivi financier — specs/finance-dashboard-redesign.md rules 10, 22 and 23.
 * Recharts draws nothing in jsdom (no layout), so the tooltip contents are rendered directly with the
 * payload Recharts hands them.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

import { SeriesTooltip } from '../SmallMultiplesLineChart';
import { MonthTooltip } from '../MonthlyRevenueChart';
import { CurveTooltip } from '../FinanceHero';

const pct = (v) => `${Math.round(v * 100)} %`;
const eur = (v) => `${v} €`;

test('rule 23 — an occupancy tooltip speaks of its own logement only', () => {
  const point = { label: 'juillet 2026', current: 0.82, previous: 0.64 };
  render(<SeriesTooltip active payload={[{ payload: point }]} title="Gîte" previousLabel="2024-2025" formatValue={pct} />);
  expect(screen.getByText('Gîte')).toBeInTheDocument();
  expect(screen.getByText('juillet 2026 : 82 %')).toBeInTheDocument();
  expect(screen.getByText('2024-2025 : 64 %')).toBeInTheDocument();
});

test('rule 23 — a month without data reads as a gap, never 0 %', () => {
  render(<SeriesTooltip active payload={[{ payload: { label: 'mars 2026', current: null, previous: null } }]} title="Tente" previousLabel="2025" formatValue={pct} />);
  expect(screen.getByText('mars 2026 : —')).toBeInTheDocument();
});

test('rule 22 — the month tooltip gives one line per year, month and amount together', () => {
  const m = { label: 'juillet 2026', revenue: 11938, upcoming: 0, previous: 12257, previousLabel: 'juillet 2025' };
  render(<MonthTooltip active payload={[{ payload: m }]} formatAmount={eur} />);
  expect(screen.getByText('Juillet 2026 : 11938 €')).toBeInTheDocument();
  expect(screen.getByText('Juillet 2025 : 12257 €')).toBeInTheDocument();
});

test('rule 22 — no last-year line on a month that is not comparable', () => {
  render(<MonthTooltip active payload={[{ payload: { label: 'juillet 2026', revenue: 5265, upcoming: 0, previous: null, previousLabel: 'juillet 2025' } }]} formatAmount={eur} />);
  expect(screen.queryByText(/2025/)).toBeNull();
});

test('rule 10 — the curve tooltip shows the date, this year and last year', () => {
  const format = { date: (d) => d.split('-').reverse().join('/'), amount: eur };
  render(<CurveTooltip active payload={[{ payload: { day: '2026-07-15', current: 14000, previous: 12500 } }]} format={format} />);
  expect(screen.getByText('au 15/07/2026')).toBeInTheDocument();
  expect(screen.getByText('14000 € cette année')).toBeInTheDocument();
  expect(screen.getByText("12500 € l'an dernier")).toBeInTheDocument();
});
