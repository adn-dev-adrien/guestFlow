// specs/accounting-synthesis.md §3 rules 27 and 34 — the checks strip: four checks, a gap opens what it names, an
// entry leads to its month in « Écritures », a stay to its fiche for an admin only, the last export with its month.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import AccountingSynthesisTab from '../AccountingSynthesisTab';
import { synthesisPayload } from './synthesisFixtures';

const renderTab = (data, { canOpenReservation = true, onOpenEntriesMonth = () => {} } = {}) => render(
  <ThemeProvider theme={theme}><MemoryRouter>
    <AccountingSynthesisTab data={data} canOpenReservation={canOpenReservation} onOpenEntriesMonth={onOpenEntriesMonth} />
  </MemoryRouter></ThemeProvider>,
);

test('rule 27 — the four checks, each with its state', () => {
  renderTab(synthesisPayload());
  expect(screen.getByTestId('check-balanced')).toHaveTextContent(/Débits = crédits : 24\s310,50\s€/);
  expect(screen.getByTestId('check-vat')).toHaveTextContent(/Écart de 0,01\s€/);
  expect(screen.getByTestId('check-settled')).toHaveTextContent('1 séjour terminé non soldé');
  expect(screen.getByTestId('check-export')).toHaveTextContent('02/10/2099 à 09:14 · septembre 2099');
});

test('rule 27 — the VAT gap opens its entries; « Écritures du mois » leads to the entry\'s month', async () => {
  const onOpenEntriesMonth = vi.fn();
  renderTab(synthesisPayload(), { onOpenEntriesMonth });
  await userEvent.click(within(screen.getByTestId('check-vat')).getByRole('button', { name: 'voir l’écriture' }));
  const table = screen.getByRole('table', { name: 'Écritures avec un écart de TVA' });
  expect(table).toHaveTextContent('ANNA LIMA · 10 %');
  expect(table).toHaveTextContent(/11,73\s€/);
  await userEvent.click(within(table).getByRole('button', { name: 'Écritures du mois' }));
  expect(onOpenEntriesMonth).toHaveBeenCalledWith({ month: 8, year: 2099 });
});

test('rules 27 and 34 — an unsettled stay links to its fiche for an admin, reads as text for the accountant', async () => {
  const { unmount } = renderTab(synthesisPayload());
  await userEvent.click(within(screen.getByTestId('check-settled')).getByRole('button', { name: 'voir' }));
  expect(screen.getByRole('link', { name: 'Paul Martin' })).toHaveAttribute('href', '/reservations/22290');
  unmount();
  renderTab(synthesisPayload(), { canOpenReservation: false });
  await userEvent.click(within(screen.getByTestId('check-settled')).getByRole('button', { name: 'voir' }));
  expect(screen.getByText(/Paul Martin/)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Paul Martin' })).toBeNull();
  expect(screen.getByText(/reste 412,50\s€/)).toBeInTheDocument();
});

test('rule 27 — all clear, and no export yet', () => {
  const data = synthesisPayload();
  data.checks = {
    ...data.checks,
    vatCoherence: { source: 'collections', status: 'ok', gap: 0, entries: [] },
    settled: { source: 'stays', status: 'ok', count: 0, stays: [] },
    lastExport: null,
  };
  renderTab(data);
  expect(screen.getByTestId('check-vat')).toHaveTextContent('Aucun écart avec les écritures');
  expect(screen.getByTestId('check-settled')).toHaveTextContent('Tous les séjours terminés sont soldés');
  expect(screen.getByTestId('check-export')).toHaveTextContent('Aucun export');
});
