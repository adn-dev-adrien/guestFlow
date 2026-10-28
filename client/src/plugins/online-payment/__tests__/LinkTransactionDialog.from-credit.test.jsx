import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import LinkTransactionDialog from '../LinkTransactionDialog';
import { previewPayload } from './reconciliationFixtures';

// specs/reconciliation-assisted-matching.md rule 14 — « Rattacher à des fiches » from a credit: plausible
// receipts first, all open receipts folded, the same search, several receipts ticked.

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getReconciliationCandidates: vi.fn(), previewReconciliationAllocation: vi.fn() },
}));
import api from '../../../api';

const receipt = (over = {}) => ({
  key: '7|balance', reservationId: 7, ledgerKey: 'balance', label: 'Solde', expectedCents: 40000, openCents: 40000, anchorDateLabel: 'avant le 18/10', unbounded: false,
  reservation: { id: 7, clientName: 'Luca Rossi', propertyName: 'Estiva', platform: 'direct' }, ...over,
});
const payload = (over = {}) => ({
  likely: [receipt(), receipt({ key: '8|balance', reservationId: 8, label: 'Solde', openCents: 30000, reservation: { id: 8, clientName: 'Camille Lefevre', propertyName: 'Gîte', platform: 'direct' } })],
  others: { total: 1, offset: 0, items: [receipt({ key: '9|balance', reservationId: 9, reservation: { id: 9, clientName: 'Ana Martin', propertyName: 'Gîte', platform: 'direct' } })] },
  query: { tokens: [] }, ...over,
});
const CREDIT = { transactionId: 'tx-9', remainingCents: 70000, dateLabel: '20/10', counterparty: 'ACME' };
const renderDialog = (props = {}) => render(<LinkTransactionDialog open onClose={vi.fn()} onSubmit={vi.fn()} credit={CREDIT} {...props} />);

beforeEach(() => {
  vi.clearAllMocks();
  api.getReconciliationCandidates.mockResolvedValue(payload());
  api.previewReconciliationAllocation.mockResolvedValue(previewPayload());
});

test('rule 14 — the credit is named, plausible receipts come first and the others are folded', async () => {
  renderDialog();
  expect(await screen.findByText('Échéances probables')).toBeTruthy();
  expect(screen.getByText(/20\/10 · ACME/)).toBeTruthy();
  expect(screen.getByText('Luca Rossi', { exact: false })).toBeTruthy();
  expect(screen.getByText('Toutes les échéances ouvertes (1)')).toBeTruthy();
  expect(api.getReconciliationCandidates).toHaveBeenCalledWith({ transactionId: 'tx-9', q: '' });
});

test('rule 14 — several receipts ticked go to the preview as receipt keys of the one credit', async () => {
  renderDialog();
  const boxes = await screen.findAllByRole('checkbox');
  fireEvent.click(boxes[0]);
  fireEvent.click(boxes[1]);
  await waitFor(() => expect(api.previewReconciliationAllocation).toHaveBeenLastCalledWith({ transactionIds: ['tx-9'], receiptKeys: ['7|balance', '8|balance'] }));
});

test('rule 14 — the search asks the server with the credit', async () => {
  renderDialog();
  await screen.findByText('Échéances probables');
  fireEvent.change(screen.getByLabelText(/Client, logement/), { target: { value: 'rossi' } });
  await waitFor(() => expect(api.getReconciliationCandidates).toHaveBeenCalledWith({ transactionId: 'tx-9', q: 'rossi' }));
});

test('rule 14 — « Rattacher » sends the previewed pairs once the preview is valid', async () => {
  const onSubmit = vi.fn();
  renderDialog({ onSubmit });
  fireEvent.click((await screen.findAllByRole('checkbox'))[0]);
  await screen.findByText('1 virement · 300,00 €');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Rattacher' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Rattacher' }));
  expect(onSubmit).toHaveBeenCalledWith(previewPayload().pairs);
});
