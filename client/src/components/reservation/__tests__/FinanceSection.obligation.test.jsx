// specs/pricing-components.md §3 rule 75 — the « À rembourser » rows of the register of refund obligations: the server words the
// row and its action, the fiche renders the button, asks, calls the close endpoint and re-reads the ledger.
import { screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderFinance, dueRow, ledgerOf } from './ledgerFixtures';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { closeRefundObligation: vi.fn().mockResolvedValue({}), markPayment: vi.fn() },
}));
import api from '../../../api';

const owed = (over = {}) => dueRow('obligation-4', 'Paiement en double à rembourser', 70, {
  stateLabel: 'À rembourser',
  action: { kind: 'closeObligation', label: 'Marquer remboursé', obligationId: 4, confirmTitle: 'Marquer comme remboursé ?', confirmLabel: 'Marquer remboursé' },
  ...over,
});
const rowEl = (key) => document.querySelector(`[data-row="${key}"]`);
beforeEach(() => { vi.clearAllMocks(); });

test('rule 75 — the row shows the server\'s label, amount and state, with its close button', () => {
  renderFinance({ editingReservationId: 7, ledger: ledgerOf([owed()]) });
  const row = rowEl('obligation-4');
  expect(within(row).getByText('Paiement en double à rembourser')).toBeInTheDocument();
  expect(within(row).getByText('À rembourser')).toBeInTheDocument();
  expect(within(row).getByRole('button', { name: /^Marquer remboursé/ })).toBeInTheDocument();
});

test('rule 75 — confirming closes the obligation as settled and re-reads the ledger', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance({ editingReservationId: 7, ledger: ledgerOf([owed()]) });
  await user.click(screen.getByRole('button', { name: /^Marquer remboursé/ }));
  expect(await screen.findByText('Marquer comme remboursé ?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Marquer remboursé' }));
  await waitFor(() => expect(api.closeRefundObligation).toHaveBeenCalledWith(7, 4, 'settled'));
  expect(ctx.reloadReservationFinance).toHaveBeenCalled();
});

test('rule 75 — declining the confirmation writes nothing', async () => {
  const user = userEvent.setup();
  renderFinance({ editingReservationId: 7, ledger: ledgerOf([owed()]) });
  await user.click(screen.getByRole('button', { name: /^Marquer remboursé/ }));
  await user.click(await screen.findByRole('button', { name: 'Annuler' }));
  expect(api.closeRefundObligation).not.toHaveBeenCalled();
});

test('rule 75 — a refusal of the server is said, the ledger is not re-read', async () => {
  api.closeRefundObligation.mockRejectedValueOnce(new Error('Déjà clos.'));
  const user = userEvent.setup();
  const { ctx } = renderFinance({ editingReservationId: 7, ledger: ledgerOf([owed()]) });
  await user.click(screen.getByRole('button', { name: /^Marquer remboursé/ }));
  await user.click(await screen.findByRole('button', { name: 'Marquer remboursé' }));
  expect(await screen.findByText('Déjà clos.')).toBeInTheDocument();
  expect(ctx.reloadReservationFinance).not.toHaveBeenCalled();
});
