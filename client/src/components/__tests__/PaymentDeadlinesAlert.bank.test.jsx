/**
 * specs/reconciliation-assisted-matching.md rule 22 — the « Échéances » card draws the `bank` line a plugin
 * decorated a row with (a transfer found + « Confirmer », or « Rien sur le compte »), and nothing when the
 * row carries none.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DialogProvider from '../DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getPaymentDeadlines: vi.fn(), confirmAllReconciliation: vi.fn(), snoozePaymentDeadline: vi.fn(), remindPaymentDeadline: vi.fn(), cancelReservation: vi.fn() },
}));
import api from '../../api';
import PaymentDeadlinesAlert from '../PaymentDeadlinesAlert';

const ATTENTION = { key: 'payment-deadlines', severity: 'todo', count: 1, title: 'Échéances de paiement', detail: '1 en retard' };
const ROW = {
  reservationId: 10, reservationNumber: null, state: 'balance_overdue', severity: 'warning', clientName: 'Marie Dupont', clientEmail: '', propertyName: 'Le Lodge',
  startDate: '2026-11-18', endDate: '2026-11-25', depositDue: 0, balanceDue: 596.58, totalDue: 596.58, dueDate: '2026-10-09', daysLate: 10,
  canCancel: false, canRemind: true, remindType: 'balance', requestSent: true,
};
const renderCard = () => render(<DialogProvider><PaymentDeadlinesAlert attention={ATTENTION} /></DialogProvider>);

beforeEach(() => { vi.clearAllMocks(); });

test('a transfer found is worded and confirmed from the card, then the card reloads', async () => {
  api.getPaymentDeadlines.mockResolvedValueOnce({ rows: [{ ...ROW, bank: { state: 'proposed', label: 'Virement trouvé : 596,58 € le 12/11', proposalId: 't1:10|balance', amountCents: 59658 } }] });
  api.getPaymentDeadlines.mockResolvedValueOnce({ rows: [] });
  api.confirmAllReconciliation.mockResolvedValue({ confirmed: [{ proposalId: 't1:10|balance' }], skipped: [], totalCents: 59658 });
  renderCard();
  expect(await screen.findByText('Virement trouvé : 596,58 € le 12/11')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
  await waitFor(() => expect(api.confirmAllReconciliation).toHaveBeenCalledWith({ proposalIds: ['t1:10|balance'], amounts: { 't1:10|balance': 59658 } }));
  await waitFor(() => expect(screen.queryByText('Marie Dupont', { exact: false })).toBeNull());
});

test('nothing on the account is said in words, without any action', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [{ ...ROW, bank: { state: 'nothing', label: 'Rien sur le compte', proposalId: null, amountCents: 0 } }] });
  renderCard();
  expect(await screen.findByText('Rien sur le compte')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Confirmer' })).toBeNull();
});

test('a row without a bank line is drawn as before', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [ROW] });
  renderCard();
  expect(await screen.findByText(/Marie Dupont/)).toBeTruthy();
  expect(screen.queryByText('Rien sur le compte')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Confirmer' })).toBeNull();
});

test('a refused confirmation shows the server\'s words and keeps the row', async () => {
  api.getPaymentDeadlines.mockResolvedValue({ rows: [{ ...ROW, bank: { state: 'proposed', label: 'Virement trouvé : 596,58 € le 12/11', proposalId: 'x', amountCents: 59658 } }] });
  api.confirmAllReconciliation.mockResolvedValue({ confirmed: [], skipped: [{ proposalId: 'x', reason: 'changed', message: 'Cette proposition a changé : elle reste dans la liste.' }], totalCents: 0 });
  renderCard();
  await userEvent.click(await screen.findByRole('button', { name: 'Confirmer' }));
  expect(await screen.findByText('Cette proposition a changé : elle reste dans la liste.')).toBeTruthy();
  expect(screen.getByText(/Marie Dupont/)).toBeTruthy();
});
