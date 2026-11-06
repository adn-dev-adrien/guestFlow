/**
 * specs/report-grammar.md §3 rules 11 and 14 — two charts on one time axis: the keys name the bars,
 * the cumulative line and (only when sent) last year's dashed cumulative; the table view lists the
 * three figures per day; the shared tooltip (named export, Recharts draws nothing in jsdom) gives them.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import AlignedDailyCumulativeCharts, { DailyTooltip } from '../AlignedDailyCumulativeCharts';
import { DAYS, DAILY, CUMULATIVE, PREVIOUS_CUMULATIVE } from '../../pages/reportGrammarFixtures';
import { formatCurrencyRounded } from '../../utils/formatters';

const LABELS = { daily: 'Encaissé du jour', cumulative: 'Cumul', previous: "Cumul l'an dernier" };
const renderCharts = (previous) => render(
  <ThemeProvider theme={theme}>
    <AlignedDailyCumulativeCharts categories={DAYS} daily={DAILY} cumulative={CUMULATIVE} previousCumulative={previous} formatValue={formatCurrencyRounded} ariaLabel="Encaissements d'octobre" />
  </ThemeProvider>,
);

test('rule 14 — the keys name both charts; last year only when the server sent it', () => {
  const { unmount } = renderCharts(PREVIOUS_CUMULATIVE);
  expect(screen.getByText("Cumul l'an dernier")).toBeInTheDocument();
  expect(screen.getByRole('figure', { name: "Encaissements d'octobre" })).toBeInTheDocument();
  unmount();
  renderCharts(undefined);
  expect(screen.getByText('Encaissé du jour')).toBeInTheDocument();
  expect(screen.queryByText("Cumul l'an dernier")).toBeNull();
});

test('rules 11 and 14 — the table view lists the day, its amount, the running total and last year', async () => {
  renderCharts(PREVIOUS_CUMULATIVE);
  await userEvent.click(screen.getByRole('button', { name: 'Options du graphique' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Voir en tableau' }));
  const table = screen.getByRole('table', { name: "Encaissements d'octobre" });
  expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Jour', 'Encaissé du jour', 'Cumul', "Cumul l'an dernier"]);
  const day2 = within(table).getByRole('row', { name: /^2\/10/ });
  expect(within(day2).getAllByRole('cell').map((c) => c.textContent)).toEqual(['335 €', '498 €', '0 €']);
});

test('rule 14 — the shared tooltip gives the three figures of the hovered day', () => {
  render(<DailyTooltip active payload={[{ payload: { label: '16/10', daily: 1, cumulative: 1103, previous: 108 } }]} labels={LABELS} formatValue={formatCurrencyRounded} hasPrevious />);
  expect(screen.getByText('16/10')).toBeInTheDocument();
  expect(screen.getByText('Encaissé du jour : 1 €')).toBeInTheDocument();
  expect(screen.getByText('Cumul : 1 103 €')).toBeInTheDocument();
  expect(screen.getByText("Cumul l'an dernier : 108 €")).toBeInTheDocument();
});
