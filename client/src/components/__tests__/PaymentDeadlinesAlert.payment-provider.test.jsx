import { vi } from 'vitest';
/**
 * specs/plugins-phase-3a-online-payment.md rules 5, 9, 19 — the dashboard card follows the server:
 * no « Relancer » without a payment provider (`remindType: null`), and a cancellation whose payment
 * link could not be deactivated says so, in the server's words.
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

const ROW = {
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
  requestSent: true,
};

const renderCard = () => render(<DialogProvider><PaymentDeadlinesAlert /></DialogProvider>);

beforeEach(() => vi.clearAllMocks());

test('rule 5 — without a payment provider the row keeps « Reporter » and loses « Relancer »', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [{ ...ROW, remindType: null }] });
  renderCard();
  expect(await screen.findByRole('button', { name: 'Reporter' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Relancer' })).not.toBeInTheDocument();
});

test('rule 9 — a link the provider still accepts is named after the cancellation', async () => {
  const warning = 'Le lien de paiement n’a pas pu être désactivé chez Qonto. GuestFlow réessaie à chaque vérification ; tu peux aussi le désactiver depuis Qonto.';
  api.getPaymentDeadlines.mockResolvedValue({ rows: [ROW] });
  api.cancelReservation.mockResolvedValue({ ok: true, retainedDepositAmount: 0, paymentLinksNotDeactivated: 1, paymentLinksWarning: warning });
  renderCard();
  await userEvent.click(await screen.findByRole('button', { name: 'Annuler le séjour' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Annuler le séjour' }));
  await waitFor(() => expect(screen.getByText(`Séjour annulé. ${warning}`)).toBeInTheDocument());
});
