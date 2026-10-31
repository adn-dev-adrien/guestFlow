// specs/payment-link-lifecycle.md rule 63 (audit R10-M1; Adrien, 2026-10-31) — with an installment plan, the server sends
// the payments received after a withdrawal on a row of their own: an échéance one with both rule-56 actions, an acompte one
// with the refund only and a note. The fiche renders what it is sent, nothing computed.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderFinance, dueRow, ledgerOf } from './ledgerFixtures';

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const rowEl = (key) => document.querySelector(`[data-row="${key}"]`);
const NONE = { editable: false, mode: 'none', min: null, max: null, reason: null };
const settle = (linkId, amount, { stay = true } = {}) => ({
  linkId,
  ...(stay ? { stay: { label: 'Enregistrer sur le séjour', confirmTitle: `Enregistrer ${amount} sur le séjour ?`, confirmMessage: 'Le montant est compté comme perçu.', confirmLabel: 'Enregistrer' } } : {}),
  refunded: { label: 'Marquer remboursé', confirmTitle: `${amount} remboursés ?`, confirmMessage: 'À confirmer une fois le remboursement fait chez le prestataire.', confirmLabel: 'Remboursé' },
});
const NOTE = 'Supprimer l’échéancier pour l’enregistrer sur le séjour.';
const withdrawnRow = {
  key: 'withdrawnPayments', label: 'Paiements après retrait', amount: 801, state: 'due', tone: 'warning', stateLabel: 'À traiter',
  action: null, amountEdit: NONE,
  detail: {
    link: { status: 'cancelled', label: '501,00 € payés le 26/10 après retrait : à traiter', settle: settle(45, '501,00 €') },
    otherLinks: [{ status: 'cancelled', label: '300,00 € payés le 26/10 après retrait : à traiter', settle: settle(44, '300,00 €', { stay: false }) }],
    note: NOTE,
  },
};
const planLedger = () => ledgerOf([
  dueRow('installment-1', 'Échéance 1/2', 500, { action: null, stateLabel: 'À demander' }),
  dueRow('installment-2', 'Échéance 2/2', 501.5, { action: null, stateLabel: 'À percevoir avant le 15/05' }),
  withdrawnRow,
]);

test('rule 63: the row prints beside the échéances: both payments, « Enregistrer » on the échéance one only, and the note', () => {
  renderFinance({ editingReservationId: 7, ledger: planLedger() });
  const row = rowEl('withdrawnPayments');
  expect(within(row).getByText('Paiements après retrait')).toBeInTheDocument();
  expect(within(row).getByText('À traiter')).toBeInTheDocument();
  expect(within(row).getByText(withdrawnRow.detail.link.label)).toBeInTheDocument();
  expect(within(row).getByText(withdrawnRow.detail.otherLinks[0].label)).toBeInTheDocument();
  expect(within(row).getAllByRole('button', { name: 'Marquer remboursé' })).toHaveLength(2);
  expect(within(row).getAllByRole('button', { name: 'Enregistrer sur le séjour' })).toHaveLength(1);
  expect(within(row).getByText(NOTE)).toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: 'Marquer perçu' })).toBeNull();
});

test('rule 63: « Marquer remboursé » on the second payment asks first, then settles that link', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance({ editingReservationId: 7, ledger: planLedger() });
  await user.click(within(rowEl('withdrawnPayments')).getAllByRole('button', { name: 'Marquer remboursé' })[1]);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('300,00 € remboursés ?')).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Remboursé' }));
  expect(ctx.settlePaymentLink).toHaveBeenCalledWith(44, 'refunded');
});

test('rule 63: « Enregistrer sur le séjour » settles the payment shown first', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance({ editingReservationId: 7, ledger: planLedger() });
  await user.click(within(rowEl('withdrawnPayments')).getAllByRole('button', { name: 'Enregistrer sur le séjour' })[0]);
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enregistrer' }));
  expect(ctx.settlePaymentLink).toHaveBeenCalledWith(45, 'stay');
});

test('rule 63 (review of #911, m2): on a closed fiche the row’s refunds are drawn outside the disabled fieldset, and work', async () => {
  const user = userEvent.setup();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const readOnly = {
    ...withdrawnRow,
    detail: {
      link: { ...withdrawnRow.detail.link, settle: settle(45, '501,00 €', { stay: false }) },
      otherLinks: withdrawnRow.detail.otherLinks,
    },
  };
  const { ctx } = renderFinance({ editingReservationId: 7, closedActionsHost: host, ledger: ledgerOf([readOnly]) });
  expect(within(host).getByText(readOnly.detail.link.label)).toBeInTheDocument();
  expect(within(host).getByText(readOnly.detail.otherLinks[0].label)).toBeInTheDocument();
  const buttons = within(host).getAllByRole('button', { name: 'Marquer remboursé' });
  expect(buttons).toHaveLength(2);
  expect(within(rowEl('withdrawnPayments')).queryByRole('button', { name: 'Marquer remboursé' })).toBeNull();
  await user.click(buttons[0]);
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remboursé' }));
  expect(ctx.settlePaymentLink).toHaveBeenCalledWith(45, 'refunded');
  host.remove();
});
