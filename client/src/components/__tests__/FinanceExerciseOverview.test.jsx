/**
 * FinanceExerciseOverview — the « vue de l'exercice » block of the Suivi financier.
 * specs/finance-exercise-overview-charts.md: the block renders the server payload as is.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { createTheme, hexToRgb } from '@mui/material/styles';
import FinanceExerciseOverview from '../FinanceExerciseOverview';

const month = (m, initial, revenue, upcoming = 0) => ({
  month: m, label: `mois ${m}`, initial, revenue, revenueHt: revenue * 0.9, past: revenue - upcoming, upcoming, nights: 3,
});

const OVERVIEW = {
  revenue: 48867,
  revenueHt: 43980,
  nights: 369,
  direct: { revenue: 18661, percent: 38 },
  months: [month('2026-01', 'J', 3409), month('2026-02', 'F', 4228, 1000)],
  properties: [
    { propertyId: 1, propertyName: 'Le Lodge des Prés', revenue: 16029, ratio: 1 },
    { propertyId: 2, propertyName: 'La Roulotte', revenue: 9550, ratio: 0.596 },
  ],
  channels: [
    { key: 'direct', label: 'Direct', platform: 'direct', revenue: 18661, reservations: 41, percent: 38 },
    { key: 'platform:airbnb', label: 'Airbnb', platform: 'Airbnb', revenue: 9077, reservations: 20, percent: 19 },
    { key: 'others', label: 'Autres', platform: null, revenue: 21129, reservations: 30, percent: 43 },
  ],
};

const EMPTY = {
  revenue: 0, revenueHt: 0, nights: 0, direct: { revenue: 0, percent: null },
  months: [month('2026-01', 'J', 0)], properties: [], channels: [],
};

test('rules 4-6 — two tiles show the server figures; the exercise revenue is not repeated', () => {
  render(<FinanceExerciseOverview overview={OVERVIEW} fiscalYearLabel="2026" onOpenBreakdown={() => {}} />);
  expect(screen.queryByText("Revenu de l'exercice")).not.toBeInTheDocument();
  expect(screen.getByText('369')).toBeInTheDocument();
  expect(screen.getByText('38 %')).toBeInTheDocument();
  expect(screen.getByText('2 logements')).toBeInTheDocument();
  expect(screen.getByText('TTC · exercice 2026')).toBeInTheDocument();
});

test('rule 5 — the nights tile opens the exercise breakdown; the direct share does not', () => {
  const onOpen = vi.fn();
  render(<FinanceExerciseOverview overview={OVERVIEW} fiscalYearLabel="2026" onOpenBreakdown={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Voir le détail : Nuits vendues' }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: /Part en direct/ })).not.toBeInTheDocument();
});

test('logements and channels are listed in the server order with their percentages', () => {
  render(<FinanceExerciseOverview overview={OVERVIEW} fiscalYearLabel="2026" onOpenBreakdown={() => {}} />);
  expect(screen.getByText('Le Lodge des Prés')).toBeInTheDocument();
  expect(screen.getByText('La Roulotte')).toBeInTheDocument();
  const legend = screen.getAllByRole('listitem').map((li) => li.textContent);
  expect(legend).toEqual(expect.arrayContaining(['Direct · 38 %', 'Airbnb · 19 %', 'Autres · 43 %']));
  expect(screen.getByText('Encaissé ou passé')).toBeInTheDocument();
  expect(screen.getByText('À venir')).toBeInTheDocument();
});

test('rule 15 — Direct is sapin, a platform keeps its colour, « Autres » is the default grey', () => {
  render(<FinanceExerciseOverview overview={OVERVIEW} fiscalYearLabel="2026" onOpenBreakdown={() => {}} />);
  const dot = (label) => getComputedStyle(screen.getByText(label, { exact: false }).closest('li').querySelector('span')).backgroundColor;
  const theme = createTheme();
  expect(dot('Airbnb ·')).toBe('rgb(255, 90, 95)');
  expect(dot('Autres ·')).toBe('rgb(117, 117, 117)');
  expect(dot('Direct ·')).toBe(hexToRgb(theme.palette.primary.main));
});

test('an empty exercise shows a dash and the empty states', () => {
  render(<FinanceExerciseOverview overview={EMPTY} fiscalYearLabel="2030" onOpenBreakdown={() => {}} />);
  expect(screen.getByText('—')).toBeInTheDocument();
  expect(screen.getAllByText('Aucun revenu sur cet exercice.')).toHaveLength(2);
});

test('nothing renders before the summary arrives', () => {
  const { container } = render(<FinanceExerciseOverview overview={undefined} fiscalYearLabel="" onOpenBreakdown={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});
