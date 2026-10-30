// specs/payment-link-lifecycle.md rule 50 (audit R8 client N1) — a request refused 409 LINK_ALREADY_PAID has
// just booked the payment on the server: the sender re-reads what it shows, so the fiche (or the devis) no
// longer offers a request for money already received.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

vi.setConfig({ testTimeout: 30000 });

const showError = vi.fn();
const showSuccess = vi.fn();
const dialogs = { alert: vi.fn(async () => {}), confirm: vi.fn(async () => false), prompt: vi.fn() };

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
  useToast: () => ({ showSuccess, showError }),
}));
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, roles: ['admin'] } }),
  useAuth: () => ({ user: { id: 1, roles: ['admin'] } }),
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false, usePlugins: () => ({ plugins: [], isActive: () => false }) }));

import api from '../../api';
import ReservationPage from '../ReservationPage';

const PAID_BOOKED = 'Le lien en cours vient d’être payé : paiement enregistré, aucun nouveau lien créé.';
const paidBooked = () => Object.assign(new Error(PAID_BOOKED), { code: 'LINK_ALREADY_PAID', status: 409 });

const NONE = { editable: false, mode: 'none', min: null, max: null, reason: null };
const LEDGER = {
  rows: [{
    key: 'balance', label: 'Solde', amount: 210, state: 'due', tone: 'due', stateLabel: 'À percevoir avant le 26/10',
    action: { kind: 'mark', label: 'Marquer perçu' }, amountEdit: NONE,
    detail: { link: { label: 'Lien expiré le 28/10 à 10:00', resend: { type: 'balance', label: 'Renvoyer la demande' } } },
  }],
  closing: { label: 'Reste à percevoir', amount: 210 },
  remaining: 210,
};
const FICHE = {
  id: 22303, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2099-11-13', endDate: '2099-11-17',
  platform: 'direct', adults: 2, reservationNumber: '209922303', options: [], resources: [],
  depositAmount: 90, depositPaid: 1, balanceAmount: 210, balancePaid: 0, finalPrice: 300,
  onlinePayment: { label: 'Qonto' }, ledger: LEDGER, updatedAt: '2099-01-01 10:00:00',
};
const DEVIS = {
  id: 77, clientId: 1, propertyId: 1, startDate: '2099-11-13', endDate: '2099-11-17', status: 'sent',
  adults: 2, platform: 'direct', notes: '', updatedAt: '2099-01-01 10:00:00', options: [], resources: [], customOptions: [],
  onlinePayment: { label: 'Qonto' },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [], balanceAmount: 210, ledger: LEDGER });
  api.getReservation.mockResolvedValue(FICHE);
  api.getDevisById.mockResolvedValue(DEVIS);
  api.updateDevis.mockResolvedValue(DEVIS);
  api.updateReservation.mockResolvedValue(FICHE);
});

function openAt(entry, path) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ThemeProvider theme={theme}>
        <Routes><Route path={path} element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

test('rule 50 — « Renvoyer la demande » refused as already paid re-reads the fiche finance', async () => {
  api.sendPaymentRequestOfType.mockRejectedValue(paidBooked());
  openAt('/reservations/22303', '/reservations/:reservationId');
  const resend = await screen.findByRole('button', { name: 'Renvoyer la demande' });
  const reads = api.getReservation.mock.calls.length;
  fireEvent.click(resend);
  await waitFor(() => expect(showError).toHaveBeenCalledWith(PAID_BOOKED));
  await waitFor(() => expect(api.getReservation.mock.calls.length).toBeGreaterThan(reads));
});

test('rule 50 — any other refusal of « Renvoyer la demande » re-reads nothing', async () => {
  api.sendPaymentRequestOfType.mockRejectedValue(Object.assign(new Error('Prestataire de paiement injoignable : réessayer.'), { code: 'PROVIDER_UNREACHABLE', status: 502 }));
  openAt('/reservations/22303', '/reservations/:reservationId');
  const resend = await screen.findByRole('button', { name: 'Renvoyer la demande' });
  const reads = api.getReservation.mock.calls.length;
  fireEvent.click(resend);
  await waitFor(() => expect(showError).toHaveBeenCalled());
  expect(api.getReservation.mock.calls.length).toBe(reads);
});

test('rule 50 — the solde request of the action bar refused as already paid re-reads the fiche finance', async () => {
  // The send saves the fiche first, which re-reads it: count the reads from the refusal on.
  let reads = null;
  api.sendBalanceRequestEmail.mockImplementation(async () => { reads = api.getReservation.mock.calls.length; throw paidBooked(); });
  openAt('/reservations/22303', '/reservations/:reservationId');
  fireEvent.click(await screen.findByRole('button', { name: 'Envoyer la demande de solde' }));
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalledWith(expect.objectContaining({ message: PAID_BOOKED })));
  await waitFor(() => expect(api.getReservation.mock.calls.length).toBeGreaterThan(reads));
});

test('rule 50 — the devis payment request refused as already paid re-reads the devis', async () => {
  let reads = null;
  api.sendPaymentRequestEmail.mockImplementation(async () => { reads = api.getDevisById.mock.calls.length; throw paidBooked(); });
  openAt('/reservations/new?mode=devis&devisId=77', '/reservations/new');
  fireEvent.click(await screen.findByRole('button', { name: 'Envoyer la demande de paiement' }));
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalledWith(expect.objectContaining({ message: PAID_BOOKED })));
  await waitFor(() => expect(api.getDevisById.mock.calls.length).toBeGreaterThan(reads));
});
