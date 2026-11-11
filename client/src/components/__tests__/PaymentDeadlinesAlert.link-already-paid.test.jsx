// specs/payment-link-lifecycle.md rule 50 (audit R9-C1) — the home « Échéances de paiement » card is a sender too:
// a « Relancer » refused 409 LINK_ALREADY_PAID has booked the payment, so the card re-reads its rows after the
// refusal is shown; a request that left re-reads them as well (« Relancer » replaces « Envoyer la demande »). Its
// e-mail draft dialog hands `onMoneyChanged` the same re-read. Any other refusal re-reads nothing.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DialogProvider from '../DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getPaymentDeadlines: vi.fn(), snoozePaymentDeadline: vi.fn(), remindPaymentDeadline: vi.fn(), cancelReservation: vi.fn(),
    getEmailTemplates: vi.fn(), previewEmail: vi.fn(), sendEmail: vi.fn(),
  },
}));

import api from '../../api';
import PaymentDeadlinesAlert from '../PaymentDeadlinesAlert';

const ATTENTION = { key: 'payment-deadlines', severity: 'todo', count: 1, title: 'Échéances de paiement', detail: '1 en retard' };
const PAID_BOOKED = 'Le lien en cours vient d’être payé : paiement enregistré, aucun nouveau lien créé.';

const ROW = {
  reservationId: 22306, state: 'deposit_overdue', severity: 'warning', clientName: 'Client Test', propertyName: 'Gite',
  startDate: '2027-07-10', endDate: '2027-07-14', depositDue: 90, balanceDue: 0, totalDue: 90, dueDate: '2027-06-01', // date-literal-ok: display-only fixture
  daysLate: 3, canCancel: false, canRemind: true, remindType: 'deposit', requestSent: true, remindByEmail: false,
};

const refusal = (code, message, status) => Object.assign(new Error(message), { error: code, message, status });

beforeEach(() => {
  vi.clearAllMocks();
  api.getPaymentDeadlines.mockResolvedValue({ rows: [ROW] });
});

async function clickRemind() {
  render(<DialogProvider><PaymentDeadlinesAlert attention={ATTENTION} /></DialogProvider>);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Relancer' }));
}

test('rule 50 — « Relancer » refused as already paid: the toast shows and the card re-reads its rows', async () => {
  api.remindPaymentDeadline.mockRejectedValue(refusal('LINK_ALREADY_PAID', PAID_BOOKED, 409));
  await clickRemind();
  expect(await screen.findByText(PAID_BOOKED)).toBeInTheDocument();
  api.getPaymentDeadlines.mockResolvedValue({ rows: [] });
  await waitFor(() => expect(api.getPaymentDeadlines).toHaveBeenCalledTimes(2));
});

test('rule 50 — a request that left re-reads the rows too', async () => {
  api.remindPaymentDeadline.mockResolvedValue({ sent: true });
  await clickRemind();
  await waitFor(() => expect(api.getPaymentDeadlines).toHaveBeenCalledTimes(2));
});

test('rule 50 — another refusal re-reads nothing', async () => {
  api.remindPaymentDeadline.mockRejectedValue(refusal('PROVIDER_UNREACHABLE', 'Prestataire de paiement injoignable : réessayer.', 502));
  await clickRemind();
  expect(await screen.findByText('Prestataire de paiement injoignable : réessayer.')).toBeInTheDocument();
  expect(api.getPaymentDeadlines).toHaveBeenCalledTimes(1);
});

test('rule 50 — the e-mail draft refused as already paid re-reads the rows', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [{ ...ROW, requestSent: false, remindByEmail: true, remindTemplateId: 31 }] });
  api.getEmailTemplates.mockResolvedValue([{ id: 31, name: 'Relance acompte', enabled: 1 }]);
  api.previewEmail.mockResolvedValue({ to: 'guest@example.test', subject: 'Votre acompte', body: 'Bonjour', missingVariables: [] });
  api.sendEmail.mockRejectedValue(refusal('LINK_ALREADY_PAID', PAID_BOOKED, 409));
  const user = userEvent.setup();
  render(<DialogProvider><PaymentDeadlinesAlert attention={ATTENTION} /></DialogProvider>);
  await user.click(await screen.findByRole('button', { name: 'Envoyer la demande' }));
  await screen.findByDisplayValue('Votre acompte');
  await user.click(screen.getByRole('button', { name: /^Envoyer$/ }));
  await waitFor(() => expect(api.getPaymentDeadlines).toHaveBeenCalledTimes(2));
});
