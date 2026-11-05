// specs/accounting-synthesis.md §3 rules 31 and 32 — « Encaissements »: by means and by type, the server's counts,
// amounts, totals and one-decimal shares; the amount per week with its running totals, named by the granularity.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import AccountingCollectionsTab from '../AccountingCollectionsTab';
import { synthesisPayload } from './synthesisFixtures';

const renderTab = (data) => render(<ThemeProvider theme={theme}><AccountingCollectionsTab data={data} /></ThemeProvider>);
const rowOf = (name) => screen.getAllByRole('row').find((r) => within(r).queryByText(name));

test('rule 31 — means and types with the server\'s figures, shares to one decimal', () => {
  renderTab(synthesisPayload());
  expect(screen.getByText('Encaissements par moyen de paiement')).toBeInTheDocument();
  expect(screen.getByText('Répartition par type de règlement')).toBeInTheDocument();
  const link = rowOf('Lien de paiement');
  expect(link).toHaveTextContent('21');
  expect(link).toHaveTextContent(/5\s310,60\s€/);
  expect(link).toHaveTextContent(/24,2\s%/);
  expect(rowOf('Compléments à l’arrivée')).toHaveTextContent(/8,2\s%/);
  expect(screen.getAllByText('96')).toHaveLength(2);
  expect(screen.getByText(/^Remboursements sur la période, hors encaissements : 1 · 120,00\s€$/)).toBeInTheDocument();
});

test('rule 32 — the series is named by its granularity; last year only when sent', () => {
  const { unmount } = renderTab(synthesisPayload());
  expect(screen.getByText('Encaissements hebdomadaires et cumul')).toBeInTheDocument();
  expect(screen.getByText('Encaissé de la semaine')).toBeInTheDocument();
  expect(screen.getByText('Cumul N-1')).toBeInTheDocument();
  unmount();
  const data = synthesisPayload();
  data.collections.series = { ...data.collections.series, granularity: 'day', previousAvailable: false };
  renderTab(data);
  expect(screen.getByText('Encaissements journaliers et cumul')).toBeInTheDocument();
  expect(screen.queryByText('Cumul N-1')).toBeNull();
});
