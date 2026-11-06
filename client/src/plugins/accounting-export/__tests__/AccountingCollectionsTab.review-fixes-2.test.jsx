// specs/accounting-synthesis.md §3 rules 47 and 51 (V2-2, V2-6) — the series gives way to a sentence when the server
// says the window collected nothing; « Autres » says what it holds, on its segment and under its table.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import AccountingCollectionsTab from '../AccountingCollectionsTab';
import { synthesisPayload } from './synthesisFixtures';

const renderTab = (data) => render(<ThemeProvider theme={theme}><AccountingCollectionsTab data={data} /></ThemeProvider>);

test('rule 47 — no collection: one sentence per panel, no chart', async () => {
  const data = synthesisPayload();
  data.collections = { ...data.collections, total: 0, payments: 0, byMeans: [], byType: [], series: { ...data.collections.series, empty: true, previousAvailable: false } };
  renderTab(data);
  // The chart arrives on first use (lazy SDK charts): its sentence with it.
  await waitFor(() => expect(screen.getAllByText('Aucun encaissement sur la période.')).toHaveLength(3), { timeout: 10000 });
  expect(screen.queryByText('Encaissé de la semaine')).toBeNull();
});

test('rule 51 — « Autres » names what it holds', () => {
  const data = synthesisPayload();
  data.collections.byType = [...data.collections.byType, { key: 'other', label: 'Autres', count: 2, amount: 10, share: 0, ratio: 0, parts: ['Pourboires', 'Indemnités d’annulation'] }];
  renderTab(data);
  expect(screen.getByText('Autres : Pourboires, Indemnités d’annulation')).toBeInTheDocument();
});
