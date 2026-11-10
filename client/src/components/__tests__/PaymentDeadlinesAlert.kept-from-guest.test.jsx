// specs/payment-schedule-and-cancellation.md rule 60, reading of 2026-11-10 (audit R45-C-L1) — the dashboard cancel_due
// row said « acompte conservé si annulation » from the books only: on a caisse-interne acompte it said nothing, while
// the notice tells the guest the acompte is kept. The row now names the sum the notice states when it differs.
import { vi } from 'vitest';
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
    getCancellationPreview: vi.fn(),
  },
}));

import api from '../../api';
import PaymentDeadlinesAlert from '../PaymentDeadlinesAlert';

const ATTENTION = { key: 'payment-deadlines', severity: 'todo', count: 1, title: 'Échéances de paiement', detail: '1 en retard' };

const ROW = {
  reservationId: 10,
  reservationNumber: '2026-09-004',
  state: 'cancel_due',
  severity: 'error',
  clientName: 'Camille Test',
  clientEmail: 'camille@example.invalid',
  propertyName: 'Gîte Test',
  startDate: '2026-09-18', // date-literal-ok: displayed only, never compared with today
  endDate: '2026-09-25', // date-literal-ok: displayed only, never compared with today
  depositDue: 0,
  balanceDue: 640,
  totalDue: 640,
  dueDate: '2026-08-09', // date-literal-ok: displayed only, never compared with today
  daysLate: 10,
  cancelOn: '2026-08-16', // date-literal-ok: displayed only, never compared with today
  canCancel: true,
  retainedDepositAmount: 0,
  keptFromGuest: 180,
  canRemind: true,
  remindType: 'balance',
  requestSent: true,
};

const renderCard = () => render(<DialogProvider><PaymentDeadlinesAlert attention={ATTENTION} /></DialogProvider>);

beforeEach(() => vi.clearAllMocks());

test('rule 60 reading — a caisse acompte: the row names the 180,00 € the notice states', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [ROW] });
  renderCard();
  expect(await screen.findByText(/somme conservée si annulation \(indiquée au client\)/)).toBeInTheDocument();
  expect(screen.getByText('180,00 €')).toBeInTheDocument();
});

test('rule 60 reading — the same sum as the acompte kept: one figure, never twice', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [{ ...ROW, retainedDepositAmount: 274, keptFromGuest: 274 }] });
  renderCard();
  expect(await screen.findByText('274,00 €')).toBeInTheDocument();
  expect(screen.queryByText(/indiquée au client/)).not.toBeInTheDocument();
});

test('rule 60 reading — after the cancel, the toast names the sum kept beside the indemnity', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [ROW] });
  api.getCancellationPreview.mockResolvedValue({ cancellationReason: 'unpaid_balance', retainedDepositAmount: 0, indemnityAmount: 0, keptFromGuest: 180, writtenOffBalance: 640 });
  api.cancelReservation.mockResolvedValue({ ok: true, indemnityAmount: 0, keptFromGuest: 180, emailSent: true });
  renderCard();
  await userEvent.click(await screen.findByRole('button', { name: 'Annuler le séjour' }));
  const dialog = await screen.findByRole('dialog');
  const confirm = await within(dialog).findByRole('button', { name: 'Annuler le séjour' });
  await waitFor(() => expect(confirm).toBeEnabled());
  await userEvent.click(confirm);
  expect(await screen.findByText(/Séjour annulé — les dates sont remises à la vente\. Somme conservée : 180,00 €\./)).toBeInTheDocument();
});
