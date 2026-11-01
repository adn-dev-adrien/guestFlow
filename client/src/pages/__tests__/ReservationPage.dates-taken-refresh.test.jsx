// specs/payment-link-lifecycle.md rule 48 (reading of 2026-11-01, audit R11-C3) — the marker is live: a save that
// leaves the fiche open shows the server's fresh « Dates prises » (gone once the devis moved onto free nights).
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

const STAY = { id: 41, label: 'T41 · Ana Test · 14/11 → 16/11', url: '/reservations/41' };
const MARKER = { label: 'Dates prises', takenBy: STAY };
const chipName = `Dates prises par ${STAY.label}`;

function lookups() {
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.getOccupiedDates.mockResolvedValue([]);
}

function renderAt(path, route) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider theme={theme}>
        <Routes><Route path={route} element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

test('a devis saved without the marker drops « Dates prises »', async () => {
  const DEVIS = {
    id: 77, clientId: 1, propertyId: 1, startDate: '2099-11-13', endDate: '2099-11-17', status: 'sent',
    adults: 2, platform: 'direct', notes: '', updatedAt: '2099-01-01 10:00:00', options: [], resources: [], customOptions: [],
  };
  lookups();
  api.getDevisById.mockResolvedValue({ ...DEVIS, datesTaken: MARKER });
  api.updateDevis.mockResolvedValue({ ...DEVIS, datesTaken: null, updatedAt: '2099-01-01 10:05:00' });
  renderAt('/reservations/new?mode=devis&devisId=77', '/reservations/new');
  await screen.findByRole('link', { name: chipName });
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'typed' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer le devis' }));
  await waitFor(() => expect(api.updateDevis).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole('link', { name: chipName })).toBeNull());
});

test('a reservation saved in place re-reads the marker with its money', async () => {
  const FICHE = {
    id: 22306, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2099-11-13', endDate: '2099-11-17',
    platform: 'direct', adults: 2, reservationNumber: '202622306', singleBeds: 0, doubleBeds: 0, babyBeds: 0,
    updatedAt: '2099-01-01 10:00:00', options: [], resources: [], ledger: { rows: [], closing: null, remaining: 0 },
    refundableLines: [],
  };
  lookups();
  api.getReservation.mockResolvedValueOnce({ ...FICHE, datesTaken: MARKER }).mockResolvedValue({ ...FICHE, datesTaken: null });
  const over = Object.assign(new Error('Trop-perçu'), { code: 'OVERPAID', status: 409, overpaymentTtc: 10, overpaymentLines: null });
  api.updateReservation.mockRejectedValueOnce(over).mockResolvedValue({});
  dialogs.confirm.mockResolvedValue(true);
  renderAt('/reservations/22306', '/reservations/:reservationId');
  await screen.findByRole('link', { name: chipName });
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'x' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateReservation).toHaveBeenCalledTimes(2));
  // The refund dialog opens after this save and hides the page from the accessibility tree: read through it.
  await waitFor(() => expect(api.getReservation).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(screen.queryByRole('link', { name: chipName, hidden: true })).toBeNull());
});
