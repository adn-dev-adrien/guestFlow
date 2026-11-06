// specs/accounting-synthesis.md §3 rules 38, 39 and 44 — review of 2026-11-06: a cent per entry is a rounding gap in
// grey, red only beyond with its entries (D-HC12); the tourist tax of a window that goes past the server's month says
// up to when; outside the VAT the revenue tile reads « CA ».
import React from 'react';
import { render, screen, within } from '@testing-library/react';
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
const tile = (label) => screen.getAllByTestId('kpi-tile').find((t) => within(t).queryByText(label));

test('rule 38 — rounding cents read in grey, with no list to open', () => {
  const data = synthesisPayload();
  data.checks.vatCoherence = { source: 'collections', status: 'rounding', gap: 0, roundingCents: 3, entries: [], roundingEntries: [] };
  renderTab(data);
  const check = screen.getByTestId('check-vat');
  expect(check).toHaveTextContent('Écart d’arrondi : 3 ct');
  expect(within(check).queryByRole('button')).toBeNull();
});

test('rule 38 — beyond a cent, the gap in red names its entries', () => {
  renderTab(synthesisPayload());
  expect(screen.getByTestId('check-vat')).toHaveTextContent(/Écart de 0,01\s€ · voir l’écriture/);
});

test('rule 39 — a window past the server\'s month says up to when its tax is summed', () => {
  const data = synthesisPayload();
  data.kpis.touristTax = { ...data.kpis.touristTax, until: 'novembre 2099' };
  renderTab(data);
  expect(tile('Taxe de séjour')).toHaveTextContent('41 séjours · jusqu’à novembre 2099');
});

test('rule 44 — outside the VAT the revenue tile is « CA », its figure TTC', () => {
  const data = synthesisPayload();
  data.kpis.revenue = { ...data.kpis.revenue, showHt: false, ht: 100, ttc: 100 };
  renderTab(data);
  expect(screen.queryByText('CA HT')).toBeNull();
  expect(tile('CA')).toHaveTextContent(/100,00\s€/);
});
