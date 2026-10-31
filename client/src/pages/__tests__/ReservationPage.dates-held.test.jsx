// specs/payment-link-lifecycle.md rule 46 — a devis saved onto held nights is refused DATES_HELD: the fiche shows
// the server's message and the stays that hold the nights, each to open (ConflictList). Rule 48: a devis whose nights
// another stay took shows « Dates prises » in its action bar.
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

const DEVIS = {
  id: 77, clientId: 1, propertyId: 1, startDate: '2099-11-13', endDate: '2099-11-17', status: 'sent',
  adults: 2, platform: 'direct', notes: '', updatedAt: '2099-01-01 10:00:00', options: [], resources: [], customOptions: [],
};
const STAY = { id: 41, label: 'T41 · Ana Test · 14/11 → 16/11', url: '/reservations/41' };

function openDevis(devis = DEVIS, reservations = []) {
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getDevisById.mockResolvedValue(devis);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue(reservations);
  api.getOccupiedDates.mockResolvedValue(reservations.length ? ['2099-11-14', '2099-11-15'] : []);
  render(
    <MemoryRouter initialEntries={['/reservations/new?mode=devis&devisId=77']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/new" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => { api.updateDevis.mockReset(); dialogs.alert.mockReset().mockResolvedValue(undefined); });

test('DATES_HELD shows the refusal with the stays that hold the nights', async () => {
  api.updateDevis.mockRejectedValue(Object.assign(new Error('Dates déjà réservées : devis non enregistré.'), { code: 'DATES_HELD', status: 409, stays: [STAY] }));
  openDevis();
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'typed' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer le devis' }));
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalledTimes(1));
  const shown = dialogs.alert.mock.calls[0][0];
  expect(shown).toMatchObject({ title: 'Dates déjà réservées', message: 'Dates déjà réservées : devis non enregistré.' });
  render(<MemoryRouter>{shown.details}</MemoryRouter>);
  expect(screen.getByRole('link', { name: `Ouvrir : ${STAY.label}` })).toHaveAttribute('href', '/reservations/41');
  expect(screen.getByLabelText(/^Notes/i)).toHaveValue('typed');
});

test('a devis whose nights were taken shows « Dates prises » in its action bar', async () => {
  openDevis({ ...DEVIS, datesTaken: { label: 'Dates prises', takenBy: STAY } });
  expect(await screen.findByRole('link', { name: `Dates prises par ${STAY.label}` })).toHaveAttribute('href', '/reservations/41');
});

test('a devis on the nights of another reservation goes to the server, which judges (an unpaid one refuses nothing)', async () => {
  api.updateDevis.mockResolvedValue({ ...DEVIS });
  openDevis(DEVIS, [{ id: 5, propertyId: 1, startDate: '2099-11-14', endDate: '2099-11-16', checkInTime: '16:00', checkOutTime: '10:00' }]);
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'typed' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer le devis' }));
  await waitFor(() => expect(api.updateDevis).toHaveBeenCalledTimes(1));
  expect(dialogs.alert).not.toHaveBeenCalled();
});
