// specs/reservation-refunds.md rule 42 — a refund made from the fiche re-reads the stored ledger (and the delete
// does too), so the trop-perçu row cannot be refunded a second time from a stale screen.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

// The fiche is a big page: its first import is slow on a cold run.
vi.setConfig({ testTimeout: 30000 });

const showError = vi.fn();
const showSuccess = vi.fn();
let role = 'admin';

vi.mock('../../api', () => {
  const calls = {};
  const handler = {
    get(_t, name) {
      if (name === '__esModule') return false;
      if (!calls[name]) calls[name] = vi.fn(async () => ([]));
      return calls[name];
    },
  };
  return { __esModule: true, default: new Proxy({}, handler) };
});
vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => ({ alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn() }),
  useToast: () => ({ showSuccess, showError }),
}));
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, roles: [role] } }),
  useAuth: () => ({ user: { id: 1, roles: [role] } }),
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false, usePlugins: () => ({ plugins: [], isActive: () => false }) }));

import api from '../../api';
import ReservationPage from '../ReservationPage';

const FICHE = {
  id: 22303, kind: 'cancelled', cancelledAt: '2026-10-01', clientId: 1, propertyId: 1, startDate: '2026-11-13', endDate: '2026-11-17',
  platform: 'direct', adults: 2, reservationNumber: '202622303', options: [], resources: [],
  refundableLines: [{ key: 'accommodation', label: 'Hébergement', bucket: 'accommodation', quantity: null, unitPrice: null, billedTtc: 100, refundedTtc: 0, refundableTtc: 100, vatRate: 10 }],
  refunds: [{ id: 5, refundDate: '2026-10-02', method: 'transfer', totalTtc: 20, reason: '', lines: [] }],
  refundTotals: { book: 20, withCash: 20 }, collectedTtc: 100,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getReservation.mockResolvedValue(FICHE);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja' }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.createReservationRefund.mockResolvedValue({ refunds: [], refundableLines: FICHE.refundableLines, refundTotals: { book: 0, withCash: 0 }, collectedTtc: 100 });
  api.deleteReservationRefund.mockResolvedValue({ refunds: [], refundableLines: FICHE.refundableLines, refundTotals: { book: 0, withCash: 0 }, collectedTtc: 100 });
});

function open() {
  render(
    <MemoryRouter initialEntries={['/reservations/22303']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

test('rule 42 — creating a refund re-reads the fiche finance', async () => {
  open();
  fireEvent.click(await screen.findByRole('button', { name: '+ Nouveau remboursement' }));
  fireEvent.click(await screen.findByRole('checkbox'));
  const reads = api.getReservation.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));
  await waitFor(() => expect(api.createReservationRefund).toHaveBeenCalled());
  await waitFor(() => expect(api.getReservation.mock.calls.length).toBeGreaterThan(reads));
});
