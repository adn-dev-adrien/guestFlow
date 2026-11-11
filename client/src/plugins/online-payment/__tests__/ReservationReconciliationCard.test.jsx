import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import DialogProvider from '../../../components/DialogProvider';
import ReservationReconciliationCard from '../ReservationReconciliationCard';
import { item, proposed, gap, done, bankSide } from './reconciliationFixtures';

// specs/qonto-bank-reconciliation.md rules 25–27, 33, 39 — the fiche's card draws the server's block,
// confirms / discards / undoes on the spot and reloads the fiche after a write; nothing without a block.

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    confirmReconciliation: vi.fn(), discardReconciliation: vi.fn(), undoReconciliation: vi.fn(),
  },
}));
import api from '../../../api';

const block = (over = {}) => ({
  lastReadAt: '2026-10-23T08:00:00.000Z', lastError: null, allReconciled: false, lines: [item()], unclaimedCount: 0, ...over,
});
const renderCard = (props = {}) => render(
  <DialogProvider>
    <ReservationReconciliationCard reservationId={7} pluginBlocks={{ 'online-payment': block() }} reloadFinance={vi.fn().mockResolvedValue()} {...props} />
  </DialogProvider>,
);

beforeEach(() => { vi.clearAllMocks(); });

test('renders nothing without a block (out of scope, Qonto not connected)', () => {
  const { container } = renderCard({ pluginBlocks: {} });
  expect(container.textContent).toBe('');
});

test('draws one line per receipt with the server wording', () => {
  renderCard({ pluginBlocks: { 'online-payment': block({ lines: [gap(), item({ key: '7|deposit', label: 'Acompte' })] }) } });
  expect(screen.getByText('Rapprochement bancaire')).toBeTruthy();
  expect(screen.getByText('Écart de montant')).toBeTruthy();
  expect(screen.getByText(/Le virement fait 1 103,94 €, la fiche attend 103,94 €/)).toBeTruthy();
  expect(screen.getByText('Acompte')).toBeTruthy();
});

test('Confirmer sends the proposal\'s allocations, then reloads the fiche', async () => {
  api.confirmReconciliation.mockResolvedValue({ ok: true, marked: [{ reservationId: 7, ledgerKey: 'balance', date: '2026-11-12' }] });
  const reloadFinance = vi.fn().mockResolvedValue();
  renderCard({ pluginBlocks: { 'online-payment': block({ lines: [proposed()] }) }, reloadFinance });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
  await waitFor(() => expect(api.confirmReconciliation).toHaveBeenCalledWith({
    transactionId: 'tx-1', allocations: [{ reservationId: 7, ledgerKey: 'balance', amountCents: 59658 }],
  }));
  await waitFor(() => expect(reloadFinance).toHaveBeenCalled());
});

test('Écarter names the pair; Défaire undoes the credit', async () => {
  api.discardReconciliation.mockResolvedValue({ ok: true });
  api.undoReconciliation.mockResolvedValue({ ok: true, restored: [], untouched: [] });
  renderCard({ pluginBlocks: { 'online-payment': block({ lines: [proposed(), done({ key: '7|deposit', ledgerKey: 'deposit', label: 'Acompte', bank: [{ ...bankSide({ transactionId: 'tx-2' }), allocatedCents: 30000 }] })] }) } });
  fireEvent.click(screen.getByRole('button', { name: 'Écarter' }));
  await waitFor(() => expect(api.discardReconciliation).toHaveBeenCalledWith({ transactionId: 'tx-1', reservationId: 7, ledgerKey: 'balance' }));
  fireEvent.click(screen.getByRole('button', { name: 'Défaire' }));
  await waitFor(() => expect(api.undoReconciliation).toHaveBeenCalledWith('tx-2'));
});

test('a refusal of the core is worded and the card stays', async () => {
  api.confirmReconciliation.mockRejectedValue(Object.assign(new Error('Le montant a changé entre-temps : relire la fiche.'), { code: 'AMOUNT_CHANGED' }));
  renderCard({ pluginBlocks: { 'online-payment': block({ lines: [proposed()] }) } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
  expect(await screen.findByText('Le montant a changé entre-temps : relire la fiche.')).toBeTruthy();
});

test('rule 33 — fully reconciled folds to one line, the detail opens on demand', () => {
  renderCard({ pluginBlocks: { 'online-payment': block({ allReconciled: true, lines: [done()] }) } });
  expect(screen.getByText('Tout est rapproché.')).toBeTruthy();
  expect(screen.queryByText('Versement Booking')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Voir le détail' }));
  expect(screen.getByText('Versement Booking')).toBeTruthy();
});

test('rule 39 — unsaved edits refuse the writes with the reason', () => {
  renderCard({ formDirty: true, pluginBlocks: { 'online-payment': block({ lines: [proposed()] }) } });
  expect(screen.getByRole('button', { name: 'Confirmer' }).disabled).toBe(true);
  expect(screen.getByText('Enregistrer ou annuler les modifications avant de rapprocher.')).toBeTruthy();
});
