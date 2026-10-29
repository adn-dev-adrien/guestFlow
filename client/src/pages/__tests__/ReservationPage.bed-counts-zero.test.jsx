// specs/bed-config-in-linen-card.md rule 13 — an explicit bed count of 0 is a value, not an empty field: opening a fiche
// and saving it sends 0 back (it used to become null through `|| ''`).
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

vi.setConfig({ testTimeout: 30000 });


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

const FICHE = {
  id: 22308, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2026-11-13', endDate: '2026-11-17',
  platform: 'direct', adults: 2, reservationNumber: '202622308', singleBeds: 0, doubleBeds: 0, babyBeds: 0,
  options: [], resources: [],
};

function open(fiche) {
  api.getReservation.mockResolvedValue(fiche);
  return render(
    <MemoryRouter initialEntries={[`/reservations/${fiche.id}`]}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

// Enregistrer is disabled on a clean fiche (specs/reservation-save-keeps-pricing.md rule 7): touch a note first,
// as a user would, as soon as the field is there.
async function makeDirty() {
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'Arrivée tardive' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.updateReservation.mockResolvedValue({ id: 22308 });
});

test('rule 13 — saving a fiche whose bed counts are 0 sends 0, never null', async () => {
  open(FICHE);
  await makeDirty();
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateReservation).toHaveBeenCalled());
  const payload = api.updateReservation.mock.calls[0][1];
  expect(payload.singleBeds).toBe(0);
  expect(payload.doubleBeds).toBe(0);
  expect(payload.babyBeds).toBe(0);
});

test('rule 13 — a bed count the server never stored (null) stays empty, so it is still sent as null', async () => {
  open({ ...FICHE, singleBeds: null, doubleBeds: null, babyBeds: null });
  await makeDirty();
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateReservation).toHaveBeenCalled());
  const payload = api.updateReservation.mock.calls[0][1];
  expect(payload.singleBeds).toBeNull();
  expect(payload.babyBeds).toBeNull();
});

test('rule 13 — a fiche loaded with bed counts at 0 is clean: leaving it shows no unsaved-changes dialog', async () => {
  api.getReservation.mockResolvedValue(FICHE);
  render(
    <MemoryRouter initialEntries={['/planning', '/reservations/22308']} initialIndex={1}>
      <ThemeProvider theme={theme}>
        <Routes>
          <Route path="/reservations/:reservationId" element={<ReservationPage />} />
          <Route path="/planning" element={<div>PLANNING</div>} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }));
  expect(await screen.findByText('PLANNING')).toBeInTheDocument();
  expect(screen.queryByText('Modifications non enregistrées')).toBeNull();
});
