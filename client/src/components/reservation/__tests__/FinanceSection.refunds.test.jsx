import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderFinance as renderLedger, ledgerOf } from './ledgerFixtures';

// specs/reservation-refunds.md §6 — the refunds of the Finance card. Since
// specs/reservation-payment-ledger.md rule 2 each refund is a ledger row (date, means, lines, reason,
// shaped by the server), the trop-perçu a row with « Rembourser », and « + Nouveau remboursement »
// sits under the ledger. Deleting still asks for confirmation.

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const NONE = { editable: false, mode: 'none', min: null, max: null, reason: null };
const refundRow = (id, amount, stateLabel, lines, note) => ({
  key: `refund-${id}`, label: 'Remboursement', amount: -amount, state: 'refunded', tone: 'info', stateLabel,
  action: { kind: 'deleteRefund', label: 'Supprimer', refundId: id, confirm: 'Supprimer ce remboursement ?' },
  amountEdit: NONE, detail: { lines, ...(note ? { note } : {}) },
});
const REFUND_ROWS = [
  refundRow(3, 24, 'Rendu le 14/08 · virement', ['Petit-déjeuner : − 24,00 €'], '« Départ anticipé — petits-déjeuners non pris »'),
  refundRow(2, 10, 'Rendu le 02/08 · caisse interne', ['Geste commercial : − 10,00 €']),
];

function renderFinance(overrides = {}) {
  const { form: formOverrides, ...rest } = overrides;
  return renderLedger({
    editingReservationId: 7,
    reservationId: 7,
    form: { startDate: '2026-08-10', endDate: '2026-08-17', ...formOverrides },
    ...rest,
  }).ctx;
}

beforeEach(() => { vi.clearAllMocks(); });

test('« + Nouveau remboursement » is offered on a reservation', () => {
  renderFinance();
  expect(screen.getByRole('button', { name: '+ Nouveau remboursement' })).toBeInTheDocument();
});

test('a devis has no refund entry', () => {
  renderFinance({ isDevisMode: true, editingReservationId: null });
  expect(screen.queryByRole('button', { name: '+ Nouveau remboursement' })).not.toBeInTheDocument();
});

test('each refund is a row: amount, date and means, lines and reason', () => {
  renderFinance({ ledger: ledgerOf(REFUND_ROWS) });
  const first = document.querySelector('[data-row="refund-3"]');
  expect(within(first).getByText('Rendu le 14/08 · virement')).toBeInTheDocument();
  expect(within(first).getAllByText(/24,00/).length).toBeGreaterThan(0);
  expect(within(first).getByText('Petit-déjeuner : − 24,00 €')).toBeInTheDocument();
  expect(within(first).getByText('« Départ anticipé — petits-déjeuners non pris »')).toBeInTheDocument();
  expect(screen.getByText('Rendu le 02/08 · caisse interne')).toBeInTheDocument();
});

test('deleting a refund asks for confirmation, then calls deleteRefund', async () => {
  const user = userEvent.setup();
  const deleteRefund = vi.fn();
  renderFinance({ ledger: ledgerOf([REFUND_ROWS[0]]), deleteRefund });
  await user.click(screen.getByRole('button', { name: 'Supprimer' }));
  expect(await screen.findByText('Supprimer ce remboursement ?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^Confirmer$/ }));
  await waitFor(() => expect(deleteRefund).toHaveBeenCalledWith(3));
});

test('« Nouveau remboursement » opens the dialog', async () => {
  const user = userEvent.setup();
  const setRefundDialogOpen = vi.fn();
  renderFinance({ setRefundDialogOpen });
  await user.click(screen.getByRole('button', { name: '+ Nouveau remboursement' }));
  expect(setRefundDialogOpen).toHaveBeenCalledWith(true);
});

// specs/reservation-refunds.md rule 34 — the trop-perçu row opens the dialog on the server's amount.
test('rule 34 — « Rembourser » on the trop-perçu row opens the dialog on the announced amount', async () => {
  const user = userEvent.setup();
  const setRefundDialogOpen = vi.fn();
  const lines = [{ bucket: 'options', label: 'Prestations', collectedTtc: 96, dueTtc: 0, amountTtc: 96 }];
  renderFinance({
    setRefundDialogOpen, refundOverpaymentTtc: 96, refundOverpaymentLines: lines,
    ledger: ledgerOf([{
      key: 'overpayment', label: 'Trop-perçu', amount: 96, state: 'due', tone: 'warning', stateLabel: 'À rembourser',
      action: { kind: 'refund', label: 'Rembourser' }, amountEdit: NONE, detail: { lines: ['Prestations : 96,00 € encaissés, 0,00 € dus'] },
    }]),
  });
  await user.click(screen.getByRole('button', { name: 'Rembourser' }));
  expect(setRefundDialogOpen).toHaveBeenCalledWith({ overpaymentTtc: 96, overpaymentLines: lines });
});
