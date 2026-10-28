// specs/calendar-property-parity.md rule 22 — the fiche of a duplicate set aside opens read-only with a banner
// « Doublon de la réservation … » (a link to the kept stay) and, for an admin only, « Rétablir »; a refusal
// of the server (the dates were booked since) is shown and the stay stays set aside.
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
  id: 22279, kind: 'superseded', clientId: 1, propertyId: 1, startDate: '2026-04-13', endDate: '2026-04-17',
  platform: 'Lodgify', adults: 2, reservationNumber: '202622279', supersededByReservationId: 14, supersededByReservationNumber: '202600014',
  options: [], resources: [],
};

function open() {
  return render(
    <MemoryRouter initialEntries={['/reservations/22279']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  role = 'admin';
  api.getReservation.mockResolvedValue(FICHE);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja' }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
});

test('rule 29 — the banner names the kept stay and links to it; there is no Save, no extra action, the fields are read-only', async () => {
  open();
  expect(await screen.findByText(/Doublon de la réservation/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'n° 202600014' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Annuler le séjour' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Envoyer un email' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Transformer en devis' })).toBeNull();
  // « + Nouvelle note » lives in the form: disabled with its fieldset.
  expect(screen.getByRole('button', { name: /Nouvelle note/ })).toBeDisabled();
  expect(document.querySelector('fieldset').disabled).toBe(true);
  expect(screen.queryByText('Ce logement est déjà réservé pour ces dates.')).toBeNull();
});

test('« Rétablir » is offered to an admin, restores, and surfaces the 409 message', async () => {
  api.restoreSupersededReservation.mockRejectedValueOnce(new Error('Ces dates sont déjà prises.'));
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Rétablir' }));
  await waitFor(() => expect(showError).toHaveBeenCalledWith('Ces dates sont déjà prises.'));
  expect(showSuccess).not.toHaveBeenCalled();
  api.restoreSupersededReservation.mockResolvedValueOnce({});
  fireEvent.click(screen.getByRole('button', { name: 'Rétablir' }));
  await waitFor(() => expect(showSuccess).toHaveBeenCalledWith('Réservation rétablie.'));
});

test('« Rétablir » is not offered to a non-admin', async () => {
  role = 'reception';
  open();
  await screen.findByText(/Doublon de la réservation/);
  expect(screen.queryByRole('button', { name: 'Rétablir' })).toBeNull();
});
