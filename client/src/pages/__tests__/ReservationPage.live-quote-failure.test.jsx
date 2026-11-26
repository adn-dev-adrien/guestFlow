// specs/reservations/reservation-save-keeps-pricing.md rule 21 (loop t24 S24-3; plugins-phase-1-sdk.md rule 54 reading of 2026-11-18) — the fiche's live quote that fails is no longer silent: the
// finance figures are dimmed as not up to date, with the reason and « Réessayer », which stays (with the focus) while it asks; a quote that
// lands ends it, and an edit of the fiche asks afresh without the older message. The save is unchanged: it quotes again before writing.
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
  id: 22308, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2099-11-13', endDate: '2099-11-17',
  platform: 'direct', adults: 2, reservationNumber: '209922308', singleBeds: 0, doubleBeds: 0, babyBeds: 0,
  options: [], resources: [],
};
const QUOTE = { optionLines: [], resourceLines: [] };
const offline = () => Object.assign(new Error('Service indisponible'), { status: 503 });
const ALERT = /Tarif non recalculé : les montants ci-dessous ne sont pas à jour\./;

function openFiche() {
  api.getReservation.mockResolvedValue(FICHE);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2, maxGuests: 6 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  render(
    <MemoryRouter initialEntries={['/reservations/22308']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}
const dimmed = () => screen.getByTestId('finance-figures').getAttribute('data-stale') === 'true' && window.getComputedStyle(screen.getByTestId('finance-figures')).opacity === '0.55';

beforeEach(() => { vi.clearAllMocks(); });

test('a failed live quote: reason + « Réessayer », figures dimmed; the retry keeps both (and the focus) until the quote lands', async () => {
  let release;
  api.calculatePrice
    .mockRejectedValueOnce(offline())
    .mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(QUOTE); }))
    .mockResolvedValue(QUOTE);
  openFiche();
  expect(await screen.findByText(ALERT)).toHaveTextContent('Service indisponible');
  expect(dimmed()).toBe(true);
  const retry = screen.getByRole('button', { name: 'Réessayer' });
  retry.focus();
  fireEvent.click(retry);
  await waitFor(() => expect(release).toBeTypeOf('function'));
  expect(screen.getByText(ALERT)).toBeInTheDocument();
  expect(document.activeElement).toBe(retry);
  release();
  await waitFor(() => expect(screen.queryByText(ALERT)).toBeNull());
  expect(dimmed()).toBe(false);
  expect(document.activeElement).not.toBe(document.body);
});

test('an edit after a failed live quote asks afresh without the older message, and its own failure shows again', async () => {
  let release;
  api.calculatePrice
    .mockRejectedValueOnce(offline())
    .mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(QUOTE); }))
    .mockRejectedValue(offline());
  openFiche();
  await screen.findByText(ALERT);
  fireEvent.change(screen.getByRole('spinbutton', { name: /Adultes/ }), { target: { value: '3' } });
  await waitFor(() => expect(screen.queryByText(ALERT)).toBeNull());
  await waitFor(() => expect(release).toBeTypeOf('function'));
  expect(screen.queryByText(ALERT)).toBeNull();
  release();
  await waitFor(() => expect(dimmed()).toBe(false));
  fireEvent.change(screen.getByRole('spinbutton', { name: /Adultes/ }), { target: { value: '4' } });
  expect(await screen.findByText(ALERT)).toBeInTheDocument();
  expect(dimmed()).toBe(true);
});

test('a fiche whose live quote failed can still be saved: the save quotes again before writing, as before', async () => {
  api.calculatePrice.mockRejectedValueOnce(offline()).mockResolvedValue(QUOTE);
  api.updateReservation.mockResolvedValue({ id: 22308 });
  openFiche();
  await screen.findByText(ALERT);
  fireEvent.change(screen.getByLabelText(/^Notes/i), { target: { value: 'Note' } });
  const save = await screen.findByRole('button', { name: 'Enregistrer' });
  await waitFor(() => expect(save).toBeEnabled());
  const quotesBefore = api.calculatePrice.mock.calls.length;
  fireEvent.click(save);
  await waitFor(() => expect(api.updateReservation).toHaveBeenCalled());
  expect(api.calculatePrice.mock.calls.length).toBeGreaterThan(quotesBefore);
});

test('a refused live quote (4xx) shows its reason without « Réessayer »; the next edit asks again', async () => {
  const refusal = Object.assign(new Error('Séjour trop long.'), { status: 400 });
  api.calculatePrice.mockRejectedValueOnce(refusal).mockResolvedValue(QUOTE);
  openFiche();
  expect(await screen.findByText(ALERT)).toHaveTextContent('Séjour trop long.');
  expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
  expect(dimmed()).toBe(true);
  fireEvent.change(screen.getByRole('spinbutton', { name: /Adultes/ }), { target: { value: '3' } });
  await waitFor(() => expect(screen.queryByText(ALERT)).toBeNull());
  await waitFor(() => expect(dimmed()).toBe(false));
});
