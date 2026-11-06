// specs/ui-review-2026-10-19-operations.md rules 50, 51 and 52 (audit R25-C1, R25-C2, verification N1) — « Créer un devis » on a stay fiche not
// saved yet carries the typed client with the form, and the devis it opens is an edit: Enregistrer is lit, leaving asks.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter, Link, Route, Routes, useNavigate } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import installBackGuard from '../../utils/backGuard';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';
import { navigateThroughGuard } from '../../utils/guardedNavigation';

// A sidebar link: it leaves through the unsaved-changes guard.
function SideLink() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigateThroughGuard(navigate, '/devis')}>side-devis</button>;
}

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

const dayIn = (n) => addIsoDays(localIsoToday(), n);
const QUOTE = { optionLines: [], resourceLines: [], totalPrice: 300, finalPrice: 300, nights: 3, depositAmount: 90, balanceAmount: 210 };

async function openStayFiche() {
  vi.clearAllMocks();
  api.calculatePrice.mockResolvedValue(QUOTE);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getProperty.mockResolvedValue({ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2, maxGuests: 4, options: [] });
  api.getPropertyOptionDefaults.mockResolvedValue([]);
  api.getWelcomePack.mockResolvedValue({ lines: [] });
  api.getClients.mockResolvedValue([]);
  api.getReservations.mockResolvedValue([]);
  api.getOccupiedDates.mockResolvedValue([]);
  api.findDuplicateClient.mockResolvedValue(null);
  api.createDevis.mockResolvedValue({});
  window.history.replaceState(null, '', '/prev');
  render(
    <BrowserRouter>
      <ThemeProvider theme={theme}>
        <Link to={`/reservations/new?propertyId=1&startDate=${dayIn(60)}&endDate=${dayIn(63)}`}>séjour</Link>
        <SideLink />
        <Routes>
          <Route path="/prev" element={<p>page précédente</p>} />
          <Route path="/reservations/new" element={<ReservationPage />} />
          <Route path="/devis" element={<p>liste des devis</p>} />
        </Routes>
      </ThemeProvider>
    </BrowserRouter>,
  );
  fireEvent.click(screen.getByText('séjour'));
  const notes = await screen.findByLabelText(/^Notes/i);
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  return notes;
}

async function typeClient() {
  fireEvent.click(screen.getAllByText('+ Créer un nouveau client')[0]);
  fireEvent.change(await screen.findByLabelText(/^Nom/), { target: { value: 'Testeur' } });
  fireEvent.change(screen.getByLabelText(/^Prénom/), { target: { value: 'Alex' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(screen.queryByText('Créer un nouveau client', { selector: 'h2' })).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getAllByText(/Testeur/).length).toBeGreaterThan(0));
}

async function createDevis() {
  delete window.__guestflowBeforeBack;
  fireEvent.click(screen.getByRole('button', { name: 'Créer un devis' }));
  await waitFor(() => expect(window.location.search).toBe('?mode=devis'));
  await waitFor(() => expect(api.getProperties.mock.calls.length).toBeGreaterThan(1));
  await screen.findByLabelText(/^Notes/i);
  await new Promise((resolve) => { setTimeout(resolve, 300); });
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

test('R25-C1 — the client typed on the stay is still on the devis, and the devis save sends it', async () => {
  await openStayFiche();
  await typeClient();
  await createDevis();
  expect(screen.getAllByText(/Testeur/).length).toBeGreaterThan(0);
  expect(api.createClient).not.toHaveBeenCalled();
  const save = screen.getByRole('button', { name: 'Enregistrer le devis' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(api.createDevis).toHaveBeenCalledTimes(1));
  expect(api.createDevis.mock.calls[0][0].newClient).toMatchObject({ lastName: 'Testeur', firstName: 'Alex' });
});

test('R25-C2 — a devis prefilled from the stay is an edit: Enregistrer lit, a reload warns, Back asks', async () => {
  const notes = await openStayFiche();
  fireEvent.change(notes, { target: { value: 'brouillon' } });
  await createDevis();
  expect(screen.getByLabelText(/^Notes/i)).toHaveValue('brouillon');
  expect(screen.getByRole('button', { name: 'Enregistrer le devis' })).toBeEnabled();
  fireEvent.click(document.body);
  expect(screen.getByRole('button', { name: 'Enregistrer le devis' })).toBeEnabled();
  await waitFor(() => expect(typeof window.__guestflowBeforeBack).toBe('function'));
  expect(reloadWarns()).toBe(true);
  window.history.back();
  expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
  expect(screen.getByLabelText(/^Notes/i)).toHaveValue('brouillon');
});

test('R25-C2 — the bar « Retour » on the prefilled devis asks too', async () => {
  const notes = await openStayFiche();
  fireEvent.change(notes, { target: { value: 'brouillon' } });
  await createDevis();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
});

test('R25 N1 (rule 52) — after the first save, Back lands on the stay fiche, blank, not on the saved draft', async () => {
  await openStayFiche();
  await typeClient();
  await createDevis();
  api.createDevis.mockResolvedValue({ id: 77 });
  api.getDevisById.mockResolvedValue({ id: 77, status: 'draft', propertyId: 1, startDate: dayIn(60), endDate: dayIn(63), adults: 2, notes: '' });
  const depth = window.history.length;
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le devis' }));
  await waitFor(() => expect(window.location.search).toBe('?mode=devis&devisId=77'));
  expect(window.history.length).toBe(depth);
  delete window.__guestflowBeforeBack;
  window.history.back();
  await waitFor(() => expect(window.location.search).toBe(`?propertyId=1&startDate=${dayIn(60)}&endDate=${dayIn(63)}`));
  await screen.findByLabelText(/^Notes/i);
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  expect(screen.queryByText(/Testeur/)).not.toBeInTheDocument();
  expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
  expect(api.createDevis).toHaveBeenCalledTimes(1);
});

test('R25 D1 (rule 52) — « Enregistrer et quitter » on the prefilled devis: Back opens the saved devis, never the draft again', async () => {
  await openStayFiche();
  await typeClient();
  await createDevis();
  api.createDevis.mockResolvedValue({ id: 77 });
  api.getDevisById.mockResolvedValue({ id: 77, status: 'draft', propertyId: 1, startDate: dayIn(60), endDate: dayIn(63), adults: 2, notes: '' });
  fireEvent.click(screen.getByText('side-devis'));
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer et quitter' }));
  await waitFor(() => expect(window.location.pathname).toBe('/devis'));
  expect(api.createDevis).toHaveBeenCalledTimes(1);
  delete window.__guestflowBeforeBack;
  window.history.back();
  await waitFor(() => expect(window.location.search).toBe('?mode=devis&devisId=77'));
  await screen.findByLabelText(/^Notes/i);
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  expect(screen.queryByText(/Testeur/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le devis' }));
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  expect(api.createDevis).toHaveBeenCalledTimes(1);
});
