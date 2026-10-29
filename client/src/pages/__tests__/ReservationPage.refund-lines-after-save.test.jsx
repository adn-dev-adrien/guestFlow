// specs/reservation-refunds.md rule 43 — audit R3 N4: « Enregistrer et rembourser » opens the refund dialog on the
// sold lines as they stand AFTER the save (re-read from the server), not on those of the loaded fiche.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

vi.setConfig({ testTimeout: 30000 });

const dialogs = { alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn() };

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
  useAppDialogs: () => dialogs,
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, roles: ['admin'] } }),
  useAuth: () => ({ user: { id: 1, roles: ['admin'] } }),
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false, usePlugins: () => ({ plugins: [], isActive: () => false }) }));

import api from '../../api';
import ReservationPage from '../ReservationPage';

const line = (billedTtc, refundableTtc) => ({ key: 'accommodation', label: 'Hébergement', bucket: 'accommodation', quantity: null, unitPrice: null, billedTtc, refundedTtc: 0, refundableTtc, vatRate: 10 });
const FICHE = {
  id: 22306, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2099-11-13', endDate: '2099-11-17',
  platform: 'direct', adults: 2, reservationNumber: '202622306', singleBeds: 0, doubleBeds: 0, babyBeds: 0,
  updatedAt: '2099-01-01 10:00:00', options: [], resources: [], ledger: { rows: [], closing: null, remaining: 0 },
  refundableLines: [line(2188, 2188)],
};

test('rule 43 — the refund dialog opened after « Enregistrer et rembourser » lists the sold lines as saved', async () => {
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getReservation.mockResolvedValueOnce(FICHE).mockResolvedValue({ ...FICHE, refundableLines: [line(2011.7, 2011.7)] });
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  const over = Object.assign(new Error('Trop-perçu'), { code: 'OVERPAID', status: 409, overpaymentTtc: 176.3, overpaymentLines: null });
  api.updateReservation.mockRejectedValueOnce(over).mockResolvedValue({});
  dialogs.confirm.mockResolvedValue(true);
  render(
    <MemoryRouter initialEntries={['/reservations/22306']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'x' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText(/Facturé 2\s011,70/)).toBeInTheDocument();
  expect(screen.queryByText(/Facturé 2\s188,00/)).not.toBeInTheDocument();
});
