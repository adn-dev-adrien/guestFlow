// specs/gift-vouchers/gift-voucher-campaigns.md rule 54 — « Annuler le bon »: within the 14 days of the payment a confirmation naming the voucher and the amount to refund; after them a
// forcing dialog (a goodwill cancellation) whose reason is mandatory; a voucher given away has no refund; a cancelled voucher shows « Annulé », « À rembourser x € » and
// « Marquer remboursé », then the refund done. Every figure and every deadline is the server's.
import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import giftVouchersApi from '../giftVouchersApi';
import GiftVoucherDetail from '../GiftVoucherDetail';
import { detail, renderWithShell } from './giftVoucherFixtures';

vi.mock('../giftVouchersApi', () => ({
  default: {
    get: vi.fn(), reveal: vi.fn(), resend: vi.fn(), extend: vi.fn(), cancel: vi.fn(), adjust: vi.fn(), downloadVoucher: vi.fn(), settleRefund: vi.fn(),
  },
}));

beforeEach(() => { vi.clearAllMocks(); });

const LATE = { open: false, endsOn: '2026-10-30' }; // date-literal-ok: a payload the mocked server answers; the screen only shows it
const cancelled = (over = {}) => detail({
  state: 'cancelled', canCancel: false, canDownload: false, balanceCents: 0, cancelReason: 'Geste', cancelForced: true, refunds: [{
    id: 9, amountCents: 15000, openedOn: '2026-11-15', settledOn: null, settledBy: null, // date-literal-ok: a payload the mocked server answers; the screen only shows it
  }], ...over,
});

test('within 14 days the confirmation names the voucher and the amount to refund, then the server cancels with nothing forced', async () => {
  giftVouchersApi.cancel.mockResolvedValue(cancelled());
  const onChange = vi.fn();
  renderWithShell(<GiftVoucherDetail voucher={detail()} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Annuler le bon' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(/Le bon BC-2026-0001 ne pourra plus servir\. 150,00.€ sont à rembourser\./);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Annuler le bon' }));
  await waitFor(() => expect(giftVouchersApi.cancel).toHaveBeenCalledWith(1));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'cancelled' })));
});

test('after 14 days a forcing dialog states the period is over and the confirmation stays disabled until a reason is typed', async () => {
  giftVouchersApi.cancel.mockResolvedValue(cancelled());
  const onChange = vi.fn();
  renderWithShell(<GiftVoucherDetail voucher={detail({ withdrawal: LATE })} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Annuler le bon' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(/Le délai de rétractation de 14 jours s’est terminé le/);
  expect(dialog).toHaveTextContent(/geste commercial/);
  const confirm = within(dialog).getByRole('button', { name: 'Annuler quand même' });
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText(/Motif/), '   ');
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText(/Motif/), 'Décès dans la famille');
  expect(confirm).toBeEnabled();
  await userEvent.click(confirm);
  await waitFor(() => expect(giftVouchersApi.cancel).toHaveBeenCalledWith(1, { force: true, reason: 'Décès dans la famille' }));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
});

test('when the server says the period ended meanwhile (CANCEL_FORCE_REQUIRED) the forcing dialog takes over', async () => {
  giftVouchersApi.cancel.mockRejectedValueOnce(Object.assign(new Error('Le délai de rétractation de 14 jours est écoulé.'), { code: 'CANCEL_FORCE_REQUIRED' }));
  renderWithShell(<GiftVoucherDetail voucher={detail()} onChange={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Annuler le bon' }));
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Annuler le bon' }));
  expect(await screen.findByRole('button', { name: 'Annuler quand même' })).toBeInTheDocument();
});

test('a voucher given away has no amount to refund in the confirmation and no refund line after', async () => {
  const offered = detail({ offered: true, withdrawal: null, refundCents: 0, paymentMethod: 'offered' });
  renderWithShell(<GiftVoucherDetail voucher={offered} onChange={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Annuler le bon' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Le bon BC-2026-0001 ne pourra plus servir.');
  expect(dialog).not.toHaveTextContent('à rembourser');
});

test('a cancelled voucher given away says no refund is owed', () => {
  renderWithShell(<GiftVoucherDetail voucher={cancelled({ offered: true, refunds: [], withdrawal: null, cancelForced: false })} onChange={vi.fn()} />);
  expect(screen.getByText('Aucun remboursement : bon offert.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Marquer remboursé' })).not.toBeInTheDocument();
});

test('a cancelled voucher reads « Annulé » with its reason, « À rembourser x € » and « Marquer remboursé », which settles the refund on the server', async () => {
  giftVouchersApi.settleRefund.mockResolvedValue(cancelled({ refunds: [{
    id: 9, amountCents: 15000, openedOn: '2026-11-15', settledOn: '2026-11-16', settledBy: 'Adrien', // date-literal-ok: a payload the mocked server answers; the screen only shows it
  }] }));
  const onChange = vi.fn();
  renderWithShell(<GiftVoucherDetail voucher={cancelled()} onChange={onChange} />);
  expect(screen.getByText('Annulé')).toBeInTheDocument();
  expect(screen.getByText('Geste')).toBeInTheDocument();
  expect(screen.getByText('Annulé après le délai de rétractation')).toBeInTheDocument();
  expect(screen.getByText(/À rembourser 150,00/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Annuler le bon' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Marquer remboursé' }));
  await waitFor(() => expect(giftVouchersApi.settleRefund).toHaveBeenCalledWith(1, 9));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
});

test('a settled refund shows the amount and the day, with no more button', () => {
  renderWithShell(<GiftVoucherDetail voucher={cancelled({ refunds: [{
    id: 9, amountCents: 15000, openedOn: '2026-11-15', settledOn: '2026-11-16', settledBy: 'Adrien', // date-literal-ok: a payload the mocked server answers; the screen only shows it
  }] })} onChange={vi.fn()} />);
  expect(screen.getByText(/150,00.€ remboursés le/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Marquer remboursé' })).not.toBeInTheDocument();
});

test('a voucher already used cannot be cancelled and says why', () => {
  renderWithShell(<GiftVoucherDetail voucher={detail({ canCancel: false })} onChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Annuler le bon' })).toBeDisabled();
  expect(screen.getByText('Ce bon a déjà servi : il ne peut plus être annulé.')).toBeInTheDocument();
});
