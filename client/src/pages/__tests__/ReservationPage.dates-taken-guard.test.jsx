// specs/payment-link-lifecycle.md rule 48 (reading of 2026-11-01, audit R11-C1) — « Dates prises » in the action bar
// opens the stay that took the nights through the fiche's unsaved-changes guard: a dirty devis asks first, and its
// draft stays as typed when the operator stays.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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

const DEVIS = {
  id: 77, clientId: 1, propertyId: 1, startDate: '2099-11-13', endDate: '2099-11-17', status: 'sent',
  adults: 2, platform: 'direct', notes: '', updatedAt: '2099-01-01 10:00:00', options: [], resources: [], customOptions: [],
};
const STAY = { id: 41, label: 'T41 · Ana Test · 14/11 → 16/11', url: '/reservations/41' };

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }

function openDevis() {
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getDevisById.mockResolvedValue({ ...DEVIS, datesTaken: { label: 'Dates prises', takenBy: STAY } });
  api.getReservation.mockResolvedValue({ ...DEVIS, id: 41, kind: 'reservation', notes: 'other stay' });
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.getOccupiedDates.mockResolvedValue([]);
  render(
    <MemoryRouter initialEntries={['/reservations/new?mode=devis&devisId=77']}>
      <ThemeProvider theme={theme}>
        <Where />
        <Routes>
          <Route path="/reservations/new" element={<ReservationPage />} />
          <Route path="/reservations/:reservationId" element={<ReservationPage />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

test('a dirty devis asks before « Dates prises » leaves it, and staying keeps the draft', async () => {
  openDevis();
  const chip = await screen.findByRole('link', { name: `Dates prises par ${STAY.label}` });
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'typed draft' } });
  await waitFor(() => expect(typeof window.__guestflowBeforeNavigate).toBe('function'));
  fireEvent.click(chip);
  const prompt = await screen.findByRole('dialog');
  expect(within(prompt).getByRole('button', { name: 'Quitter sans enregistrer' })).toBeInTheDocument();
  expect(screen.getByTestId('where').textContent).toBe('/reservations/new?mode=devis&devisId=77');
  fireEvent.click(within(prompt).getByRole('button', { name: /Rester/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByLabelText(/^Notes/i)).toHaveValue('typed draft');
  expect(api.getReservation).not.toHaveBeenCalled();
});

test('a clean devis opens the stay that took the dates at once', async () => {
  openDevis();
  const chip = await screen.findByRole('link', { name: `Dates prises par ${STAY.label}` });
  fireEvent.click(chip);
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/reservations/41'));
  expect(screen.queryByRole('dialog')).toBeNull();
});
