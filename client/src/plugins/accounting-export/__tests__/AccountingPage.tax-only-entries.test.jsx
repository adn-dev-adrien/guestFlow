import { vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import DialogProvider from '../../../components/DialogProvider';
// specs/reservation-payment-ledger.md rule 43 — an entry whose credits are all on the tourist-tax
// account (no revenue, no VAT) is announced above the journal; the export itself is unchanged.

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getAccountingPlatforms: vi.fn(() => Promise.resolve({ rows: [], totalCommission: 0 })),
    getAccountingSales: vi.fn(),
    downloadAccountingSalesCsv: vi.fn(),
    getCancellationCompensations: vi.fn(() => Promise.resolve({ pending: [], received: [], totals: { pendingExpected: 0, receivedInMonth: 0 } })),
  },
}));
vi.mock('../../../hooks/useAuth', () => ({ __esModule: true, useAuth: vi.fn(() => ({ user: { id: 1, roles: ['admin'] } })) }));

import api from '../../../api';
import AccountingPage from '../AccountingPage';

const sales = (taxOnlyEntries) => ({
  totals: { entriesCount: 0, allBalanced: true, totalDebits: 0, taxOnlyEntries },
  entries: [],
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/comptabilite?month=6&year=2026']}>
      <ThemeProvider theme={theme}><DialogProvider><AccountingPage /></DialogProvider></ThemeProvider>
    </MemoryRouter>,
  );
}

test('rule 43 — a tax-only entry is announced with its client and amount', async () => {
  api.getAccountingSales.mockResolvedValue(sales([{ reservationId: 22224, kind: 'balance', libelle: 'PSI BRAVO', paidDate: '2026-06-19', amount: 67.13 }]));
  renderPage();
  expect(await screen.findByText(/Une écriture porte tout leur montant sur la taxe de séjour/)).toHaveTextContent('PSI BRAVO (67,13 €)');
});

test('rule 43 — nothing is announced when every entry carries revenue', async () => {
  api.getAccountingSales.mockResolvedValue(sales([]));
  renderPage();
  await waitFor(() => expect(api.getAccountingSales).toHaveBeenCalled());
  expect(screen.queryByText(/sur la taxe de séjour/)).toBeNull();
});
