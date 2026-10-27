import { vi } from 'vitest';
/**
 * specs/email-language-fr-en.md rule 12 (adversarial review of the 2026-10-27 fixes) — a cancellation
 * whose notice to the guest could not leave says so after the cancellation, in the server's words
 * (`emailWarning`); `emailSent: false` used to be read by no screen.
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

// The home's subject this card draws (specs/shell-and-home-day-first.md rule 6 — server-made).
const ATTENTION = { key: 'payment-deadlines', severity: 'todo', count: 1, title: 'Échéances de paiement', detail: '1 en retard' };

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

const renderCard = () => render(<DialogProvider><PaymentDeadlinesAlert attention={ATTENTION} /></DialogProvider>);

beforeEach(() => vi.clearAllMocks());

test('rule 12 — a notice not sent is named after the cancellation', async () => {
  const warning = 'Mail d’annulation non envoyé : version anglaise manquante.';
  api.getPaymentDeadlines.mockResolvedValue({ rows: [ROW] });
  api.cancelReservation.mockResolvedValue({ ok: true, retainedDepositAmount: 0, emailSent: false, emailWarning: warning, paymentLinksWarning: null });
  renderCard();
  await userEvent.click(await screen.findByRole('button', { name: 'Annuler le séjour' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Annuler le séjour' }));
  await waitFor(() => expect(screen.getByText('Séjour annulé — les dates sont remises à la vente. Mail d’annulation non envoyé : version anglaise manquante.')).toBeInTheDocument());
});
