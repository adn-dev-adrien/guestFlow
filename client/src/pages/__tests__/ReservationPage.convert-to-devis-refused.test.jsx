// specs/payment-link-lifecycle.md rules 46 and 55, reading of 2026-11-01 (audit R11-2) — « Transformer en devis » on
// a stay whose nights are held (or closed) is refused DATES_HELD (CLOSED_DATES): the fiche shows the same refusal as
// the devis page, the server's message with the stays (the closure) each to open, and stays on the reservation.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
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

const FICHE = {
  id: 41, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2099-11-13', endDate: '2099-11-17',
  platform: 'direct', adults: 2, reservationNumber: '209900041', singleBeds: 0, doubleBeds: 0, babyBeds: 0, depositPaid: 1,
  updatedAt: '2099-01-01 10:00:00', options: [], resources: [], ledger: { rows: [], closing: null, remaining: 0 },
};
const STAY = { id: 41, label: 'T41 · Ana Test · 13/11 → 17/11', url: '/reservations/41' };

function Where() {
  const location = useLocation();
  return <span data-testid="where">{location.pathname}{location.search}</span>;
}

function openFiche() {
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getReservation.mockResolvedValue(FICHE);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  render(
    <MemoryRouter initialEntries={['/reservations/41']}>
      <ThemeProvider theme={theme}>
        <Routes>
          <Route path="/reservations/:reservationId" element={<><ReservationPage /><Where /></>} />
          <Route path="/reservations/new" element={<Where />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

async function convert() {
  fireEvent.click(await screen.findByRole('button', { name: 'Transformer en devis' }));
  await waitFor(() => expect(api.createDevisFromReservation).toHaveBeenCalledWith(41));
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalledTimes(1));
  return dialogs.alert.mock.calls[0][0];
}

beforeEach(() => {
  api.createDevisFromReservation.mockReset();
  dialogs.alert.mockReset().mockResolvedValue(undefined);
  dialogs.confirm.mockReset().mockResolvedValue(true);
});

test('DATES_HELD: the refusal names the stays that hold the nights, each to open, and the fiche stays', async () => {
  api.createDevisFromReservation.mockRejectedValue(Object.assign(new Error('Dates déjà réservées : devis non enregistré.'), { code: 'DATES_HELD', status: 409, stays: [STAY] }));
  openFiche();
  const shown = await convert();
  expect(shown).toMatchObject({ title: 'Devis non enregistré', message: 'Dates déjà réservées : devis non enregistré.' });
  expect(screen.getByTestId('where')).toHaveTextContent('/reservations/41');
  render(<MemoryRouter>{shown.details}</MemoryRouter>);
  expect(screen.getByRole('link', { name: `Ouvrir : ${STAY.label}` })).toHaveAttribute('href', '/reservations/41');
});

test('CLOSED_DATES: the refusal names the closure to open', async () => {
  const closure = { id: 3, label: 'Travaux · 14/11 → 16/11', url: '/establishment-closures' };
  api.createDevisFromReservation.mockRejectedValue(Object.assign(new Error('Logement fermé sur ces dates : devis non enregistré.'), { code: 'CLOSED_DATES', status: 409, closures: [closure] }));
  openFiche();
  const shown = await convert();
  expect(shown).toMatchObject({ title: 'Devis non enregistré', message: 'Logement fermé sur ces dates : devis non enregistré.' });
  render(<MemoryRouter>{shown.details}</MemoryRouter>);
  expect(screen.getByRole('link', { name: `Ouvrir : ${closure.label}` })).toHaveAttribute('href', '/establishment-closures');
});

test('any other failure keeps the plain error dialog', async () => {
  api.createDevisFromReservation.mockRejectedValue(new Error('Erreur serveur'));
  openFiche();
  const shown = await convert();
  expect(shown).toEqual({ title: 'Erreur', message: 'Erreur serveur' });
});

test('on success the fiche opens the new devis', async () => {
  api.createDevisFromReservation.mockResolvedValue({ id: 900 });
  openFiche();
  fireEvent.click(await screen.findByRole('button', { name: 'Transformer en devis' }));
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/reservations/new?mode=devis&devisId=900'));
  expect(dialogs.alert).not.toHaveBeenCalled();
});
