// specs/accounting-synthesis.md §3 rules 28, 29 and 30 — the VAT to declare by rate or by account with the server's
// totals, the deductible VAT apart, and the collected running total against last year; each panel names its source.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import AccountingSynthesisTab from '../AccountingSynthesisTab';
import { synthesisPayload } from './synthesisFixtures';

const renderTab = (data) => render(
  <ThemeProvider theme={theme}><MemoryRouter>
    <AccountingSynthesisTab data={data} canOpenReservation onOpenEntriesMonth={() => {}} />
  </MemoryRouter></ThemeProvider>,
);

test('rule 28 — by rate, then by account, the same server total', async () => {
  renderTab(synthesisPayload());
  const table = screen.getByRole('table', { name: 'Récapitulatif TVA à déclarer' });
  expect(within(table).getAllByRole('row').map((r) => r.textContent.replace(/\s/g, ' '))).toEqual([
    'TauxBase HTTVA', '20 %708,33 €141,67 €', '10 %17 410,30 €1 741,03 €', 'Total18 118,63 €1 882,70 €',
  ].map((t) => t.replace(/\s/g, ' ')));
  await userEvent.click(screen.getByRole('button', { name: 'Par compte' }));
  const byAccount = screen.getByRole('table', { name: 'Récapitulatif TVA à déclarer' });
  expect(byAccount).toHaveTextContent('70600000 · Location gîte');
  expect(within(byAccount).getAllByRole('row')).toHaveLength(5);
  expect(byAccount).toHaveTextContent(/Total.*1\s882,70\s€/);
  expect(screen.getByText(/TVA déductible sur les commissions, non déduite ici : 212,40\s€/)).toBeInTheDocument();
});

test('rule 29 — the running total, last year dashed beside it only when the server sends it', async () => {
  const { unmount } = renderTab(synthesisPayload());
  // The SDK hands the charts out lazily (specs/report-grammar.md rule 20): wait for the figure.
  expect(await screen.findByRole('figure', { name: 'Encaissements cumulés, T3 2099' }, { timeout: 10000 })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'N-1' })).toBeInTheDocument();
  unmount();
  const data = synthesisPayload();
  data.collections.series = { ...data.collections.series, previousAvailable: false };
  renderTab(data);
  await screen.findByRole('figure', { name: 'Encaissements cumulés, T3 2099' }, { timeout: 10000 });
  expect(screen.queryByRole('button', { name: 'N-1' })).toBeNull();
}, 20000);

test('rule 30 — both panels say they read the collections', () => {
  renderTab(synthesisPayload());
  expect(screen.getAllByText('Sur les encaissements')).toHaveLength(2);
});
