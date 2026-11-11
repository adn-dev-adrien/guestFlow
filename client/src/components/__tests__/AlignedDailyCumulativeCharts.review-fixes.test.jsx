/**
 * specs/report-grammar.md §3 rules 28 and 30 — review round R5: an empty period says so instead of
 * two flat charts on a « 0 / 1 / 2 € » axis; the charts are a figure the keyboard passes over.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import AlignedDailyCumulativeCharts from '../AlignedDailyCumulativeCharts';
import { DAYS, DAILY, CUMULATIVE } from '../../pages/reportGrammarFixtures';
import { formatCurrencyRounded } from '../../utils/formatters';

const r = (props) => render(
  <ThemeProvider theme={theme}>
    <AlignedDailyCumulativeCharts categories={DAYS} daily={DAILY} cumulative={CUMULATIVE} formatValue={formatCurrencyRounded} ariaLabel="Encaissements" {...props} />
  </ThemeProvider>,
);

test('rule 28 — empty: the sentence, no chart, no menu', () => {
  r({ emptyText: 'Aucun encaissement sur la période.' });
  expect(screen.getByText('Aucun encaissement sur la période.')).toBeInTheDocument();
  expect(screen.queryByRole('figure')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Options du graphique' })).toBeNull();
});

test('rule 30 — a named figure with nothing focusable inside', () => {
  r({});
  expect(screen.getByRole('figure', { name: 'Encaissements' }).querySelector('[tabindex]')).toBeNull();
});
