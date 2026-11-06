// specs/accounting-synthesis.md §3 rules 37, 42 and 44 — review of 2026-11-06: a share the server cannot read prints
// « — » (R2-6); an empty breakdown says so; the folded « Autres » row; the refunds line names its unit (R2-10).
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import AccountingCollectionsTab from '../AccountingCollectionsTab';
import { synthesisPayload } from './synthesisFixtures';

const renderTab = (data) => render(<ThemeProvider theme={theme}><AccountingCollectionsTab data={data} /></ThemeProvider>);

test('rule 42 — unreadable shares print « — », never « 0,0 % »', () => {
  const data = synthesisPayload();
  data.collections.byMeans = data.collections.byMeans.map((r) => ({ ...r, share: null, ratio: null }));
  renderTab(data);
  const row = screen.getAllByRole('row').find((r) => within(r).queryByText('Lien de paiement'));
  expect(row).toHaveTextContent('—');
  expect(row).not.toHaveTextContent('0,0 %');
});

test('rule 42 — an empty window says it has no collection, in both panels', () => {
  const data = synthesisPayload();
  data.collections = { ...data.collections, total: 0, payments: 0, byMeans: [], byType: [] };
  renderTab(data);
  expect(screen.getAllByText('Aucun encaissement sur la période.')).toHaveLength(2);
});

test('rule 37 — the folded « Autres » row is drawn and listed like the others', () => {
  const data = synthesisPayload();
  data.collections.byType = [...data.collections.byType, { key: 'other', label: 'Autres', count: 2, amount: 10, share: 0, ratio: 0, parts: ['Pourboires', 'Échéances'] }];
  renderTab(data);
  expect(screen.getByTestId('share-row-other')).toHaveTextContent('Autres');
});

test('rule 44 — the refunds line names its unit', () => {
  renderTab(synthesisPayload());
  expect(screen.getByText(/^Remboursements sur la période, hors encaissements : 1 remboursement · 120,00\s€$/)).toBeInTheDocument();
});
