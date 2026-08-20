import { vi } from 'vitest';
/**
 * « Échéances de paiement » dashboard card (specs/payment-schedule-and-cancellation.md §3.4 / §6).
 * Pins what the card renders per state, and that the three actions call the right endpoints — the
 * card decides nothing itself, so what is tested here is faithful rendering and wiring.
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DialogProvider from '../DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getPaymentDeadlines: vi.fn(),
    snoozePaymentDeadline: vi.fn(),
    remindPaymentDeadline: vi.fn(),
    cancelReservation: vi.fn(),
  },
}));

import api from '../../api';
import PaymentDeadlinesAlert from '../PaymentDeadlinesAlert';

const CANCEL_DUE = {
  reservationId: 10,
  reservationNumber: '2026-09-004',
  state: 'cancel_due',
  severity: 'error',
  clientName: 'Marie Dupont',
  clientEmail: 'marie@example.com',
  propertyName: 'Le Lodge',
  startDate: '2026-09-18',
  endDate: '2026-09-25',
  depositDue: 0,
  balanceDue: 640,
  totalDue: 640,
  dueDate: '2026-08-09',
  daysLate: 10,
  cancelOn: '2026-08-16',
  canCancel: true,
  retainedDepositAmount: 274,
  canRemind: true,
  remindType: 'balance',
  // Late implies asked: since the 2026-08-20 amendment a row whose money was never claimed is a
  // `*_to_request` to-do, and its button reads « Envoyer la demande » instead.
  requestSent: true,
};

const DEPOSIT_OVERDUE = {
  ...CANCEL_DUE,
  reservationId: 11,
  reservationNumber: '2026-10-001',
  state: 'deposit_overdue',
  severity: 'warning',
  clientName: 'Luc Martin',
  depositDue: 240,
  balanceDue: 0,
  totalDue: 240,
  dueDate: '2026-08-15',
  daysLate: 4,
  canCancel: false,
  retainedDepositAmount: 0,
  remindType: 'deposit',
};

// specs/platform-payout-due-date.md §3.2 — the platform's transfer is late.
const PLATFORM_PAYOUT = {
  ...CANCEL_DUE,
  reservationId: 12,
  reservationNumber: '2026-07-018',
  state: 'platform_payout_overdue',
  severity: 'warning',
  clientName: 'Sophie Bernard',
  platformLabel: 'Airbnb',
  startDate: '2026-07-15',
  endDate: '2026-07-22',
  depositDue: 0,
  balanceDue: 612,
  totalDue: 612,
  dueDate: '2026-08-01',
  daysLate: 18,
  cancelOn: null,
  canCancel: false,
  retainedDepositAmount: 0,
  canRemind: false,
  remindType: null,
};

// specs/platform-payout-due-date.md §3.2bis — imported from a platform, amount never entered.
const AMOUNT_MISSING = {
  ...PLATFORM_PAYOUT,
  reservationId: 13,
  reservationNumber: '2026-07-021',
  state: 'platform_amount_missing',
  clientName: 'Karim Belaid',
  platformLabel: 'Abracadaroom',
  depositDue: 0,
  balanceDue: 0,
  totalDue: 0,
};

const renderCard = () => render(
  <DialogProvider>
    <PaymentDeadlinesAlert />
  </DialogProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  api.getPaymentDeadlines.mockResolvedValue({ rows: [] });
});

test('renders nothing when no deadline is missed', async () => {
  const { container } = renderCard();
  await waitFor(() => expect(api.getPaymentDeadlines).toHaveBeenCalled());
  expect(container.textContent).toBe('');
});

test('shows what is late, and what cancelling would keep', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [CANCEL_DUE] });
  renderCard();
  expect(await screen.findByText(/Échéances de paiement/)).toBeInTheDocument();
  expect(screen.getByText(/Marie Dupont/)).toBeInTheDocument();
  expect(screen.getByText(/10 jours de retard, annulation possible/)).toBeInTheDocument();
  expect(screen.getByText(/acompte conservé si annulation/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Annuler le séjour' })).toBeInTheDocument();
});

test('a late acompte offers no cancellation', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [DEPOSIT_OVERDUE] });
  renderCard();
  expect(await screen.findByText(/Acompte en retard — 4 jours de retard/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Annuler le séjour' })).not.toBeInTheDocument();
});

test('« Relancer » re-sends the request the server asked for', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [DEPOSIT_OVERDUE] });
  api.remindPaymentDeadline.mockResolvedValue({ sent: true });
  renderCard();
  await userEvent.click(await screen.findByRole('button', { name: 'Relancer' }));
  await waitFor(() => expect(api.remindPaymentDeadline).toHaveBeenCalledWith(11, 'deposit'));
});

test('a client without an email cannot be reminded', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [{ ...DEPOSIT_OVERDUE, canRemind: false }] });
  renderCard();
  expect(await screen.findByRole('button', { name: 'Relancer' })).toBeDisabled();
});

test('« Reporter » snoozes for a week and reloads', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [CANCEL_DUE] });
  api.snoozePaymentDeadline.mockResolvedValue({ ok: true, snoozedUntil: '2026-08-26' });
  renderCard();
  await userEvent.click(await screen.findByRole('button', { name: 'Reporter' }));
  await waitFor(() => expect(api.snoozePaymentDeadline).toHaveBeenCalledWith(10, 7));
  expect(api.getPaymentDeadlines).toHaveBeenCalledTimes(2);
});

test('cancelling goes through the confirmation dialog and its recap', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [CANCEL_DUE] });
  api.cancelReservation.mockResolvedValue({ ok: true, retainedDepositAmount: 274 });
  renderCard();
  await userEvent.click(await screen.findByRole('button', { name: 'Annuler le séjour' }));

  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/Acompte conservé/)).toBeInTheDocument();
  expect(within(dialog).getByText(/Solde abandonné/)).toBeInTheDocument();
  expect(within(dialog).getByText(/remises à la vente/)).toBeInTheDocument();

  await userEvent.type(within(dialog).getByLabelText('Motif'), 'Sans nouvelles');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Annuler le séjour' }));
  await waitFor(() => expect(api.cancelReservation).toHaveBeenCalledWith(10, {
    reason: 'Sans nouvelles', notifyClient: true,
  }));
});

test('a late platform payout names the platform and offers no dunning, no cancellation', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [PLATFORM_PAYOUT] });
  renderCard();
  expect(await screen.findByText(/Virement plateforme en retard de 18 jours/)).toBeInTheDocument();
  expect(screen.getByText(/Sophie Bernard · Le Lodge · Airbnb/)).toBeInTheDocument();
  expect(screen.getByText(/612,00/)).toBeInTheDocument();
  // Never a « Relancer » towards an OTA guest: they already paid the platform.
  expect(screen.queryByRole('button', { name: 'Relancer' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Annuler le séjour' })).not.toBeInTheDocument();
  // Reporting it for a week is the one action that makes sense.
  expect(screen.getByRole('button', { name: 'Reporter' })).toBeInTheDocument();
});

test('a direct row keeps its « Relancer » button alongside a platform one', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [DEPOSIT_OVERDUE, PLATFORM_PAYOUT] });
  renderCard();
  await screen.findByText(/Virement plateforme en retard/);
  expect(screen.getAllByRole('button', { name: 'Relancer' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Reporter' })).toHaveLength(2);
});

test('a booking whose amount was never entered asks for the data, and prints no figure', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [AMOUNT_MISSING] });
  renderCard();
  expect(await screen.findByText(/Montant de la plateforme jamais saisi/)).toBeInTheDocument();
  expect(screen.getByText(/Karim Belaid · Le Lodge · Abracadaroom/)).toBeInTheDocument();
  // No amount exists, so no amount line is rendered — not « Solde 0,00 € ».
  expect(screen.queryByText(/Solde/)).not.toBeInTheDocument();
  expect(screen.queryByText(/0,00/)).not.toBeInTheDocument();
  // Nothing to chase, nothing to cancel; « Reporter » remains.
  expect(screen.queryByRole('button', { name: 'Relancer' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Annuler le séjour' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reporter' })).toBeInTheDocument();
});

// ── 2026-08-20 amendment: the card is the to-do list, since no cron sends money any more ──────────

const DEPOSIT_TO_REQUEST = {
  ...DEPOSIT_OVERDUE,
  reservationId: 12,
  reservationNumber: '2026-11-007',
  state: 'deposit_to_request',
  severity: 'info',
  clientName: 'Alice Bernard',
  dueDate: '2026-08-26',
  daysLate: 0,
  remindType: 'deposit',
  requestSent: false,
};

test('a never-requested acompte reads as a to-do and offers « Envoyer la demande »', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [DEPOSIT_TO_REQUEST] });
  renderCard();

  expect(await screen.findByText('Acompte à demander')).toBeInTheDocument();
  expect(screen.getByText(/Acompte jamais demandé/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Envoyer la demande' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Relancer' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Annuler le séjour' })).not.toBeInTheDocument();
});

test('« Envoyer la demande » posts the type the server named', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [DEPOSIT_TO_REQUEST] });
  api.remindPaymentDeadline.mockResolvedValue({ sent: true });
  renderCard();

  await userEvent.click(await screen.findByRole('button', { name: 'Envoyer la demande' }));

  await waitFor(() => expect(api.remindPaymentDeadline).toHaveBeenCalledWith(12, 'deposit'));
});

test('a to-do past its deadline says how long the asking has waited, not that the guest is late', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [{ ...DEPOSIT_TO_REQUEST, daysLate: 4 }] });
  renderCard();

  expect(await screen.findByText(/Acompte jamais demandé — échéance dépassée de 4 jours/)).toBeInTheDocument();
});

test('the title counts the late rows and the to-dos separately', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [CANCEL_DUE, DEPOSIT_TO_REQUEST] });
  renderCard();

  expect(await screen.findByText(/Échéances de paiement — 1 en retard · 1 à demander/)).toBeInTheDocument();
});
