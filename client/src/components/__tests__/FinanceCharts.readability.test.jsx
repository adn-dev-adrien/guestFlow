/**
 * Finance charts readability — specs/finance-dashboard-redesign.md rules 43, 44, 46 and
 * specs/booking-pace.md rules 14-15 (UI/UX review 2026-10-18, proposals 8, 9, 18, decisions 9-10).
 * Recharts draws nothing in jsdom: the ticks and labels are rendered directly inside an <svg>.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';

import theme from '../../theme';
import InsightCard from '../InsightCard';
import FinanceHero from '../FinanceHero';
import { MonthTick, TotalLabel } from '../MonthlyRevenueChart';
import { MonthTick as PaceTick, paceMonthLines, scrollTargetFor } from '../PaceMonthChart';
import SmallMultiplesLineChart from '../SmallMultiplesLineChart';
import { chart } from '../../utils/chartColors';

const inSvg = (ui) => render(<ThemeProvider theme={theme}><svg>{ui}</svg></ThemeProvider>);
const MONTHS = [
  { month: '2026-10', initial: 'O', short: 'oct.', isCurrent: true },
  { month: '2027-01', initial: 'J', short: 'janv.', isCurrent: false },
];

test('rule 44 — months abbreviated on a wide screen, initials on a phone; the current month marked', () => {
  const { container, rerender } = inSvg(<MonthTick x={0} y={0} payload={{ value: '2027-01', index: 1 }} months={MONTHS} compact={false} />);
  expect(screen.getByText('janv.')).toBeInTheDocument();
  expect(container.querySelector('[data-testid="current-month-mark"]')).toBeNull();
  rerender(<ThemeProvider theme={theme}><svg><MonthTick x={0} y={0} payload={{ value: '2026-10', index: 0 }} months={MONTHS} compact /></svg></ThemeProvider>);
  const tick = screen.getByText('O');
  expect(tick).toHaveAttribute('font-weight', '700');
  expect(tick).toHaveAttribute('fill', chart.current);
  expect(container.querySelector('[data-testid="current-month-mark"]')).not.toBeNull();
});

test('rule 44 — the total is written above its column, nothing for an empty month', () => {
  const { container, rerender } = inSvg(<TotalLabel x={10} y={50} width={20} value="8,2 k" />);
  expect(screen.getByText('8,2 k')).toHaveAttribute('y', '45');
  rerender(<ThemeProvider theme={theme}><svg><TotalLabel x={10} y={50} width={20} value="" /></svg></ThemeProvider>);
  expect(container.querySelector('text')).toBeNull();
});

test('rule 43 — an insight wraps inside a narrow column instead of being cut', () => {
  render(<ThemeProvider theme={theme}><InsightCard tone="success" title="Commissions évitées par le direct : 449 €" text="3 163 € réservés en direct." /></ThemeProvider>);
  const column = screen.getByText(/Commissions évitées/).parentElement;
  expect(getComputedStyle(column).minWidth).toBe('0px');
  expect(getComputedStyle(column).overflowWrap).toBe('anywhere');
});

const pace = (o) => ({ month: '2026-10', label: 'octobre 2026', tick: 'oct. 26', current: 5, delta: null, tone: 'neutral', isCurrent: true, ...o });

const unit = (v) => `${v} réservations`;

test('pace rules 14-15 — current month marked, écart row only with a comparison, Enter opens the month', () => {
  const onSelectMonth = vi.fn();
  const { rerender } = inSvg(<PaceTick x={0} y={0} payload={{ value: '2026-10', index: 0 }} months={[pace()]} formatShort={String} formatValue={unit} hasComparison={false} selected="2026-10" onSelectMonth={onSelectMonth} theme={theme} />);
  expect(screen.getByText('oct. 26')).toHaveAttribute('fill', chart.current);
  expect(screen.queryByText('—')).toBeNull();
  const label = screen.getByRole('button', { name: 'Octobre 2026 : 5 réservations' });
  expect(label).toHaveAttribute('aria-pressed', 'true');
  expect(label.querySelector('.pace-month-ring')).not.toBeNull();
  fireEvent.keyDown(label, { key: 'Enter' });
  expect(onSelectMonth).toHaveBeenCalledWith('2026-10');
  rerender(<ThemeProvider theme={theme}><svg><PaceTick x={0} y={0} payload={{ value: '2026-11', index: 0 }} months={[pace({ month: '2026-11', label: 'novembre 2026', isCurrent: false, delta: 2, tone: 'success' })]} formatShort={String} formatValue={unit} hasComparison selected={null} onSelectMonth={onSelectMonth} theme={theme} /></svg></ThemeProvider>);
  expect(screen.getByText('▲ +2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Novembre 2026/ })).toHaveAttribute('aria-pressed', 'false');
});

test('pace rule 14 — the scroll centres the current month, measured columns, clamped to the edges', () => {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `m${i}`, isCurrent: i === 3 }));
  // 4th month of 12 columns of 60 px in a 300 px box: its centre (210) in the middle → 60.
  expect(scrollTargetFor(months, 60, 300)).toBe(60);
  expect(scrollTargetFor(months.map((m, i) => ({ ...m, isCurrent: i === 0 })), 60, 300)).toBe(0);
  expect(scrollTargetFor(months.map((m, i) => ({ ...m, isCurrent: i === 11 })), 60, 300)).toBe(420);
  expect(scrollTargetFor(months.map((m) => ({ ...m, isCurrent: false })), 60, 300)).toBe(0);
});

test('pace rules 15 (M4) — a month\'s lines: no « à la même date » unless comparable', () => {
  const m = pace({ lastYearLabel: 'octobre 2025', comparable: false, sameTimeLastYear: null, lastYearFinal: 4, reachedPct: null, remaining: null });
  expect(paceMonthLines(m, unit)).toEqual(['À date : 5 réservations', 'Octobre 2025 au final : 4 réservations']);
  expect(paceMonthLines({ ...m, comparable: true, sameTimeLastYear: 3 }, unit)[1]).toBe('Octobre 2025 à la même date : 3 réservations');
});

test('rule 45 (M2) — a logement name is written in ink; only its dot wears the series colour', () => {
  render(<ThemeProvider theme={theme}><SmallMultiplesLineChart series={[{ key: '1', title: 'Aventura lodge', color: chart.series[1], points: [] }]} currentLabel="2026" previousLabel="2025" formatValue={String} /></ThemeProvider>);
  const title = screen.getByTestId('small-multiple-title-1');
  expect(getComputedStyle(title).color).toBe('rgb(39, 37, 31)');
  expect(getComputedStyle(title.querySelector('[aria-hidden="true"]')).color).toBe('rgb(176, 127, 46)');
});

const hero = (o) => ({
  revenue: 2120, revenueHt: 1914, stays: 10, nights: 29, occupancy: 0.05, revenuePerNight: 151, directShare: 0.31,
  yoy: null, goal: null, cumulative: [{ day: '2026-10-01', x: 0, current: 0, previous: null }, { day: '2026-10-19', x: 18, current: 2120, previous: null }],
  axis: [{ x: 0, label: 'oct.' }, { x: 31, label: 'nov.' }], curveCompact: false, ...o,
});
const format = { amount: (v) => `${v} €`, percent: (v) => `${v * 100} %`, date: (d) => d };
const curveHeight = (container) => container.querySelector('.recharts-responsive-container').style.height;

test('rule 46 — before the first month is over the curve stays, 56 px high; then 120 px', () => {
  const { container, rerender } = render(<ThemeProvider theme={theme}><FinanceHero hero={hero({ curveCompact: true })} windowLabel="Exercice 2026-2027" asOf="2026-10-19" fiscalYearLabel="2026-2027" format={format} /></ThemeProvider>);
  expect(curveHeight(container)).toBe('56px');
  expect(screen.getByText('Cumulé')).toBeInTheDocument();
  rerender(<ThemeProvider theme={theme}><FinanceHero hero={hero()} windowLabel="Exercice 2026-2027" asOf="2026-11-02" fiscalYearLabel="2026-2027" format={format} /></ThemeProvider>);
  expect(curveHeight(container)).toBe('120px');
});
