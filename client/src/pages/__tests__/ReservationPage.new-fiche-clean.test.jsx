// specs/ui-review-2026-10-19-operations.md rule 40, reading of 2026-11-05 — a blank new fiche is clean until the operator's
// first gesture: the logement's defaults, the welcome pack and the quote land on their own and none asks on leaving.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import installBackGuard from '../../utils/backGuard';

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

installBackGuard();

const dayAt = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const OPTION = { id: 8, title: 'Linge', price: 7, priceType: 'per_stay', autoEnabled: 0 };
const LANDED = {
  optionLines: [{ optionId: 8, quantity: 1, totalPrice: 0, originalTotalPrice: 7, offered: true }],
  resourceLines: [], totalPrice: 300, finalPrice: 300, nights: 3,
};

async function openNewFiche() {
  api.calculatePrice.mockResolvedValue(LANDED);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getProperty.mockResolvedValue({ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2, maxGuests: 4, options: [OPTION] });
  api.getPropertyOptionDefaults.mockResolvedValue([{ optionId: 8, offered: true }]);
  api.getWelcomePack.mockResolvedValue({ lines: [{ optionId: 8, quantity: 1 }] });
  api.getClients.mockResolvedValue([]);
  api.getReservations.mockResolvedValue([]);
  api.getOccupiedDates.mockResolvedValue([]);
  window.history.replaceState(null, '', '/prev');
  render(
    <BrowserRouter>
      <ThemeProvider theme={theme}>
        <Link to={`/reservations/new?propertyId=1&startDate=${dayAt(60)}&endDate=${dayAt(63)}`}>nouvelle fiche</Link>
        <Link to={`/reservations/new?propertyId=1&startDate=${dayAt(70)}&endDate=${dayAt(72)}`}>autre fiche</Link>
        <Routes>
          <Route path="/prev" element={<p>page précédente</p>} />
          <Route path="/reservations/new" element={<ReservationPage />} />
        </Routes>
      </ThemeProvider>
    </BrowserRouter>,
  );
  fireEvent.click(screen.getByText('nouvelle fiche'));
  const notes = await screen.findByLabelText(/^Notes/i);
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  await waitFor(() => expect(api.getWelcomePack).toHaveBeenCalled());
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  return notes;
}

const reloadWarns = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

afterEach(() => {
  delete window.__guestflowBeforeBack;
  window.history.replaceState(null, '', '/');
});

test('untouched: no slot, no warning on reload, Back goes straight', async () => {
  await openNewFiche();
  expect(window.__guestflowBeforeBack).toBeUndefined();
  expect(reloadWarns()).toBe(false);
  window.history.back();
  expect(await screen.findByText('page précédente')).toBeInTheDocument();
});

test('a real edit is an edit: Back asks', async () => {
  const notes = await openNewFiche();
  fireEvent.change(notes, { target: { value: 'brouillon' } });
  await waitFor(() => expect(typeof window.__guestflowBeforeBack).toBe('function'));
  expect(reloadWarns()).toBe(true);
  window.history.back();
  expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
  expect(screen.getByLabelText(/^Notes/i)).toHaveValue('brouillon');
});

// R24-1, rule 40 reading of 2026-11-05 — a client typed for a stay not saved yet is an edit: Save lights up, leaving asks.
test('a new client typed on the fiche is an edit: Save enabled, Back and reload ask', async () => {
  await openNewFiche();
  api.findDuplicateClient.mockResolvedValue(null);
  fireEvent.click(screen.getAllByText('+ Créer un nouveau client')[0]);
  fireEvent.change(await screen.findByLabelText(/^Nom/), { target: { value: 'Testeur' } });
  fireEvent.change(screen.getByLabelText(/^Prénom/), { target: { value: 'Alex' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(screen.queryByText('Créer un nouveau client', { selector: 'h2' })).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled());
  expect(api.createClient).not.toHaveBeenCalled();
  expect(typeof window.__guestflowBeforeBack).toBe('function');
  expect(reloadWarns()).toBe(true);
  window.history.back();
  expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
});

// R24 V1, rule 40 reading of 2026-11-05 — the same mounted page loading another fiche (« Retour » after an in-page devis
// creation) starts with no typed client: the earlier one is neither shown nor sent again.
test('a client typed on one fiche does not follow the page to the next fiche it loads', async () => {
  await openNewFiche();
  api.findDuplicateClient.mockResolvedValue(null);
  fireEvent.click(screen.getAllByText('+ Créer un nouveau client')[0]);
  fireEvent.change(await screen.findByLabelText(/^Nom/), { target: { value: 'Testeur' } });
  fireEvent.change(screen.getByLabelText(/^Prénom/), { target: { value: 'Alex' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled());
  expect(screen.getAllByText(/Testeur/).length).toBeGreaterThan(0);
  delete window.__guestflowBeforeBack;
  fireEvent.click(screen.getByText('autre fiche'));
  await waitFor(() => expect(api.getProperties.mock.calls.length).toBeGreaterThan(1));
  await waitFor(() => expect(screen.queryAllByText(/Testeur/)).toHaveLength(0));
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  expect(window.__guestflowBeforeBack).toBeUndefined();
});
