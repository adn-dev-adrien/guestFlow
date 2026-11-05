// specs/ui-review-2026-10-19-operations.md rules 26, 40 — the browser « Retour » of a dirty fiche, with a real
// BrowserRouter: the router's popstate listener runs before any component's, so the fiche holds the slot of the
// interceptor installed before the router mounts. Rule 41 — a reload or a closed tab warns on a dirty fiche.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import installBackGuard from '../../utils/backGuard';

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

installBackGuard();

const STAY = {
  id: 41, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2099-11-13', endDate: '2099-11-17', status: 'confirmed',
  adults: 2, platform: 'direct', notes: '', updatedAt: '2099-01-01 10:00:00', options: [], resources: [], customOptions: [],
};

async function openFiche() {
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getReservation.mockResolvedValue({ ...STAY });
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.getOccupiedDates.mockResolvedValue([]);
  window.history.replaceState(null, '', '/prev');
  render(
    <BrowserRouter>
      <ThemeProvider theme={theme}>
        <Link to="/reservations/41">vers la fiche</Link>
        <Routes>
          <Route path="/prev" element={<p>page précédente</p>} />
          <Route path="/reservations/:reservationId" element={<ReservationPage />} />
        </Routes>
      </ThemeProvider>
    </BrowserRouter>,
  );
  fireEvent.click(screen.getByText('vers la fiche'));
  return screen.findByLabelText(/^Notes/i);
}

async function openDirtyFiche() {
  const notes = await openFiche();
  await waitFor(() => expect(notes).toBeEnabled());
  fireEvent.change(notes, { target: { value: 'brouillon' } });
  await waitFor(() => expect(typeof window.__guestflowBeforeBack).toBe('function'));
  return notes;
}

afterEach(() => {
  delete window.__guestflowBeforeBack;
  window.history.replaceState(null, '', '/');
});

test('rule 40: Back on a dirty fiche asks, keeps the draft, the URL and the entry state', async () => {
  await openDirtyFiche();
  const { idx } = window.history.state;
  const length = window.history.length;
  window.history.back();
  expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/reservations/41');
  expect(screen.getByLabelText(/^Notes/i)).toHaveValue('brouillon');
  expect(screen.queryByText('page précédente')).not.toBeInTheDocument();
  expect(window.history.state.idx).toBe(idx);
  expect(window.history.length).toBe(length);
});

test('rule 40: « Rester » keeps editing, a second Back asks again', async () => {
  await openDirtyFiche();
  window.history.back();
  fireEvent.click(await screen.findByRole('button', { name: 'Rester sur la page' }));
  await waitFor(() => expect(screen.queryByText('Modifications non enregistrées')).toBeNull());
  window.history.back();
  expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/reservations/41');
});

test('rule 40: « Quitter sans enregistrer » performs the back, one prompt only', async () => {
  await openDirtyFiche();
  window.history.back();
  fireEvent.click(await screen.findByRole('button', { name: 'Quitter sans enregistrer' }));
  expect(await screen.findByText('page précédente')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/prev');
});

test('rule 40: a clean fiche holds no slot and goes straight back', async () => {
  await openFiche();
  expect(window.__guestflowBeforeBack).toBeUndefined();
  window.history.back();
  expect(await screen.findByText('page précédente')).toBeInTheDocument();
});

test('rule 41: a reload warns on a dirty fiche, not on a clean one', async () => {
  const notes = await openFiche();
  const unload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  await waitFor(() => expect(notes).toBeEnabled());
  expect(unload()).toBe(false);
  fireEvent.change(notes, { target: { value: 'brouillon' } });
  await waitFor(() => expect(unload()).toBe(true));
});
