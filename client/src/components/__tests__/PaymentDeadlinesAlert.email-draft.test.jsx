// specs/plugins-phase-3a-online-payment.md rule 22 — without online payment, « Envoyer la demande »
// stays on a row « à demander » and opens the request as an email in the send dialog, for the
// operator to read before it leaves; the reason is said in one short line.
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

const ROW = {
  reservationId: 22270, state: 'balance_to_request', severity: 'warning', clientName: 'Marie Dupont', clientEmail: 'marie@example.com',
  propertyName: 'Gite', startDate: '2026-11-20', endDate: '2026-11-25', depositDue: 0, balanceDue: 640, totalDue: 640,
  dueDate: '2026-10-02', daysLate: 16, canCancel: false, canRemind: true, remindType: 'balance', requestSent: false,
  remindByEmail: true, remindTemplateId: 31, remindNote: 'Aucun paiement en ligne : demande par email.',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getPaymentDeadlines.mockResolvedValue({ rows: [ROW] });
  api.getEmailTemplates.mockResolvedValue([{ id: 31, name: 'Relance solde', dayOffset: 0, whenLabel: 'Échéance du solde', enabled: 1 }]);
  api.previewEmail.mockResolvedValue({ to: 'marie@example.com', subject: 'Votre solde', body: 'Contactez-nous pour le règlement.', missingVariables: [] });
  api.sendEmail.mockResolvedValue({ ok: true });
});

test('rule 22: « Envoyer la demande » opens the request email, not a payment link', async () => {
  const user = userEvent.setup();
  render(<DialogProvider><PaymentDeadlinesAlert /></DialogProvider>);
  expect(await screen.findByText('Aucun paiement en ligne : demande par email.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Envoyer la demande' }));
  expect(await screen.findByDisplayValue('Votre solde')).toBeInTheDocument();
  expect(api.previewEmail).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 22270, templateId: 31 }));
  expect(api.remindPaymentDeadline).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /^Envoyer$/ }));
  await waitFor(() => expect(api.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 22270, templateId: 31 })));
  await waitFor(() => expect(api.getPaymentDeadlines).toHaveBeenCalledTimes(2));
});
