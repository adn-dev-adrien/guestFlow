// specs/payment-schedule-and-cancellation.md rule 59 (audit R37-RES-L1) — a caution the cancelled stay still holds is
// given back from the cancelled fiche: the server offers « Restituer » on its row, the fiche draws it outside the
// disabled fieldset beside « + Nouveau remboursement », and a confirmed click sends `cautionReturned` alone.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import api from '../../../api';
import { renderFinance, ledgerOf } from './ledgerFixtures';

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const rowEl = (key) => document.querySelector(`[data-row="${key}"]`);
const received = {
  key: 'cautionReceived', label: 'Caution reçue', amount: 300, state: 'paid', tone: 'done',
  stateLabel: 'Reçue le 02/11', action: null, amountEdit: { editable: false, mode: 'none' },
};
const toReturn = {
  key: 'cautionReturned', label: 'Caution restituée', amount: 300, state: 'due', tone: 'due',
  stateLabel: 'À rendre au départ', amountEdit: { editable: false, mode: 'none' },
  action: { kind: 'mark', label: 'Restituer', dateLabel: 'Rendue le', after: '2026-11-02' },
};

let host;
beforeEach(() => {
  vi.clearAllMocks();
  api.markPayment.mockResolvedValue({ ok: true });
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => { host.remove(); });

test('rule 59: « Restituer » of a held caution is drawn outside the fieldset and sends the return alone', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance({
    editingReservationId: 22335, closedActionsHost: host, refundHost: host, ledger: ledgerOf([received, toReturn], { label: 'Tout est perçu', amount: null }),
  });
  expect(within(rowEl('cautionReturned')).queryByRole('button', { name: /Restituer/ })).toBeNull();
  const button = within(host).getByRole('button', { name: 'Restituer : Caution restituée 300,00 €' });
  await user.click(button);
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Restituer' }));
  expect(api.markPayment).toHaveBeenCalledWith(22335, { cautionReturned: true });
  expect(ctx.reloadReservationFinance).toHaveBeenCalled();
});

test('rule 59: « Garder » sends nothing', async () => {
  const user = userEvent.setup();
  renderFinance({ editingReservationId: 22335, closedActionsHost: host, refundHost: host, ledger: ledgerOf([received, toReturn], { label: 'Tout est perçu', amount: null }) });
  await user.click(within(host).getByRole('button', { name: /Restituer/ }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Garder' }));
  expect(api.markPayment).not.toHaveBeenCalled();
});

test('rule 59: a duplicate set aside (no refund host) draws no return outside the fieldset', () => {
  renderFinance({ editingReservationId: 22279, closedActionsHost: host, refundHost: null, ledger: ledgerOf([received, toReturn], { label: 'Tout est perçu', amount: null }) });
  expect(within(host).queryByRole('button', { name: /Restituer/ })).toBeNull();
});
