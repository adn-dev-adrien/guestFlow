import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import SplitSharesDialog from '../SplitSharesDialog';
import { previewPayload } from './reconciliationFixtures';

// specs/reconciliation-assisted-matching.md rules 18–19 — the shares of a grouped payout are typed, previewed
// by the server, and refused until they make the credit to the cent.

vi.mock('../../../api', () => ({ __esModule: true, default: { previewReconciliationAllocation: vi.fn() } }));
import api from '../../../api';

const PROPOSAL = {
  id: 'p:7|balance,8|balance', bank: { transactionId: 'p', amountCents: 70000, dateLabel: '15/10' },
  pairs: [
    { transactionId: 'p', reservationId: 7, ledgerKey: 'balance', amountCents: 41800 },
    { transactionId: 'p', reservationId: 8, ledgerKey: 'balance', amountCents: 25100 },
  ],
};
const LABELS = { '7|balance': 'Luca Rossi · Versement Booking', '8|balance': 'Camille Lefevre · Versement Booking' };
const renderDialog = (props = {}) => render(<SplitSharesDialog open onClose={vi.fn()} onSubmit={vi.fn()} proposal={PROPOSAL} labels={LABELS} {...props} />);

beforeEach(() => { vi.clearAllMocks(); });

test('rule 18 — one field per stay, prefilled with the estimate, with the server\'s sum check shown', async () => {
  api.previewReconciliationAllocation.mockResolvedValue(previewPayload({
    valid: false, errors: [{ code: 'SHARES_DO_NOT_SUM', field: 'shares', message: 'Il manque 9,00 € : les parts doivent faire 700,00 €.' }],
  }));
  renderDialog();
  expect(screen.getByLabelText('Luca Rossi · Versement Booking (€)').value).toBe('418,00');
  expect(screen.getByLabelText('Camille Lefevre · Versement Booking (€)').value).toBe('251,00');
  expect(await screen.findByText(/Il manque 9,00 €/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Répartir et confirmer' }).disabled).toBe(true);
  expect(api.previewReconciliationAllocation).toHaveBeenCalledWith({
    pairs: PROPOSAL.pairs.map((p) => ({ ...p })), proposalId: PROPOSAL.id,
  });
});

test('rule 18 — once the preview is valid, « Répartir et confirmer » sends the typed shares with the proposal id', async () => {
  api.previewReconciliationAllocation.mockResolvedValue(previewPayload());
  const onSubmit = vi.fn();
  renderDialog({ onSubmit });
  const field = screen.getByLabelText('Luca Rossi · Versement Booking (€)');
  fireEvent.change(field, { target: { value: '419,00' } });
  fireEvent.change(screen.getByLabelText('Camille Lefevre · Versement Booking (€)'), { target: { value: '250,00' } });
  await waitFor(() => expect(api.previewReconciliationAllocation).toHaveBeenLastCalledWith({
    pairs: [{ transactionId: 'p', reservationId: 7, ledgerKey: 'balance', amountCents: 41900 }, { transactionId: 'p', reservationId: 8, ledgerKey: 'balance', amountCents: 25000 }],
    proposalId: PROPOSAL.id,
  }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Répartir et confirmer' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Répartir et confirmer' }));
  expect(onSubmit).toHaveBeenCalledWith({
    pairs: [{ transactionId: 'p', reservationId: 7, ledgerKey: 'balance', amountCents: 41900 }, { transactionId: 'p', reservationId: 8, ledgerKey: 'balance', amountCents: 25000 }],
    proposalId: PROPOSAL.id,
  });
});

test('rule 18 — a typed share that is not an amount is refused inline with no request', async () => {
  api.previewReconciliationAllocation.mockResolvedValue(previewPayload());
  renderDialog();
  await waitFor(() => expect(api.previewReconciliationAllocation).toHaveBeenCalled());
  api.previewReconciliationAllocation.mockClear();
  fireEvent.change(screen.getByLabelText('Luca Rossi · Versement Booking (€)'), { target: { value: 'abc' } });
  expect(await screen.findByText(/deux décimales au plus/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Répartir et confirmer' }).disabled).toBe(true);
  expect(api.previewReconciliationAllocation).not.toHaveBeenCalled();
});
