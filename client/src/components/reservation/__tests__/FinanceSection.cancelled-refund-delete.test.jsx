// specs/calendar-property-parity.md rule 25 and specs/reservation-refunds.md rule 6, readings of 2026-11-02 (audit
// R15-C1) — a cancelled fiche is a disabled fieldset, yet a refund made after the cancellation can be deleted: the
// server offers « Supprimer » on that row only, and the fiche draws it outside the fieldset, beside « + Nouveau
// remboursement ». The « Acompte conservé » row, which the server gives no action, offers nothing.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderFinance, ledgerOf } from './ledgerFixtures';

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const rowEl = (key) => document.querySelector(`[data-row="${key}"]`);
const retained = {
  key: 'refund-2', label: 'Acompte conservé', amount: -150, state: 'retained', tone: 'info',
  stateLabel: 'Requalifié en indemnité le 02/11', action: null, amountEdit: { editable: false, mode: 'none' },
};
const later = {
  key: 'refund-3', label: 'Remboursement', amount: -50, state: 'refunded', tone: 'info',
  stateLabel: 'Rendu sur l\'indemnité le 02/11 · virement', amountEdit: { editable: false, mode: 'none' },
  action: { kind: 'deleteRefund', label: 'Supprimer', refundId: 3, confirm: 'Supprimer ce remboursement ?' },
};

// The page hands the same node outside its fieldset as both hosts on a cancelled fiche.
let host;
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => { host.remove(); });

test('rule 25 reading: « Supprimer » of a refund made after the cancellation is drawn outside the fieldset and deletes it', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance({
    editingReservationId: 22303, closedActionsHost: host, refundHost: host, ledger: ledgerOf([retained, later], { label: 'Tout est perçu', amount: null }),
  });
  expect(within(rowEl('refund-3')).queryByRole('button', { name: /Supprimer/ })).toBeNull();
  const button = within(host).getByRole('button', { name: 'Supprimer : Remboursement -50,00 €' });
  // Right after « + Nouveau remboursement », in the same place.
  const buttons = within(host).getAllByRole('button').map((b) => b.textContent);
  expect(buttons).toEqual(['+ Nouveau remboursement', 'Supprimer']);
  expect(within(host).getByText(/Rendu sur l'indemnité le 02\/11 · virement/)).toBeInTheDocument();
  await user.click(button);
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Confirmer|Supprimer|OK/ }));
  expect(ctx.deleteRefund).toHaveBeenCalledWith(3);
});

test('rule 25 reading: the « Acompte conservé » row offers no deletion, inside or outside the fieldset', () => {
  renderFinance({ editingReservationId: 22303, closedActionsHost: host, refundHost: host, ledger: ledgerOf([retained], { label: 'Tout est perçu', amount: null }) });
  expect(within(rowEl('refund-2')).queryByRole('button', { name: /Supprimer/ })).toBeNull();
  expect(within(host).queryByRole('button', { name: /Supprimer/ })).toBeNull();
});

test('rule 29: a duplicate set aside (no refund host) draws no deletion outside the fieldset', () => {
  renderFinance({ editingReservationId: 22279, closedActionsHost: host, refundHost: null, ledger: ledgerOf([later], { label: 'Tout est perçu', amount: null }) });
  expect(within(host).queryByRole('button', { name: /Supprimer/ })).toBeNull();
});
