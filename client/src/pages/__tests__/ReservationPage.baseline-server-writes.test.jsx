// specs/reservation-save-keeps-pricing.md rule 7 — what the server writes (a payment mark, its undo) moves the
// CURRENT clean baseline, before the first quote as well as after: the fiche stays clean (Enregistrer disabled).
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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
  useAppDialogs: () => ({ alert: vi.fn(), confirm: vi.fn(async () => true), prompt: vi.fn() }),
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

const NONE = { editable: false, mode: 'none', min: null, max: null, reason: null };
const DUE = { key: 'deposit', label: 'Acompte', amount: 90, state: 'due', tone: 'due', stateLabel: 'À percevoir', action: { kind: 'mark', label: 'Marquer perçu' }, amountEdit: NONE, detail: null };
const PAID = { key: 'deposit', label: 'Acompte', amount: 90, state: 'paid', tone: 'done', stateLabel: 'Perçu le 12/10', action: { kind: 'undo', label: 'Annuler', confirm: 'Annuler la perception ?' }, amountEdit: NONE, detail: null };
const fiche = (paid) => ({
  id: 22303, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2099-11-13', endDate: '2099-11-17',
  platform: 'direct', adults: 2, reservationNumber: '202622303', singleBeds: 0, doubleBeds: 0, babyBeds: 0,
  depositAmount: 90, depositPaid: paid ? 1 : 0, depositPaidDate: paid ? '2026-10-12' : null, options: [], resources: [],
  ledger: { rows: [paid ? PAID : DUE], closing: null, remaining: 0 },
});

function open(first) {
  let resolveQuote;
  api.calculatePrice.mockImplementationOnce(() => new Promise((resolve) => { resolveQuote = resolve; }));
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getReservation.mockResolvedValueOnce(first);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.markPayment.mockResolvedValue({});
  render(
    <MemoryRouter initialEntries={['/reservations/22303']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  return { resolveQuote: () => resolveQuote({ optionLines: [], resourceLines: [] }), isResolvable: () => typeof resolveQuote === 'function' };
}

const saveButton = () => screen.getByRole('button', { name: 'Enregistrer' });

test('a payment marked before the first quote resolves leaves the fiche clean, before and after the quote', async () => {
  const page = open(fiche(false));
  fireEvent.click(await screen.findByRole('button', { name: /^Marquer perçu/ }));
  fireEvent.change(await screen.findByLabelText('Perçu le'), { target: { value: '2026-10-12' } });
  api.getReservation.mockResolvedValueOnce(fiche(true));
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  await waitFor(() => expect(api.markPayment).toHaveBeenCalled());
  await waitFor(() => expect(api.getReservation).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(saveButton()).toBeDisabled();
  await waitFor(() => expect(page.isResolvable()).toBe(true));
  page.resolveQuote();
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(saveButton()).toBeDisabled();
});

test('a payment undone before the first quote resolves leaves the fiche clean, before and after the quote', async () => {
  const page = open(fiche(true));
  await screen.findByText('Perçu le 12/10');
  api.getReservation.mockResolvedValueOnce(fiche(false));
  fireEvent.click(within(document.querySelector('[data-row="deposit"]')).getByRole('button', { name: /Annuler/ }));
  await waitFor(() => expect(api.markPayment).toHaveBeenCalled());
  await waitFor(() => expect(api.getReservation).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(saveButton()).toBeDisabled();
  await waitFor(() => expect(page.isResolvable()).toBe(true));
  page.resolveQuote();
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(saveButton()).toBeDisabled();
});
