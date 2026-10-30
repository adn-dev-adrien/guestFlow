// specs/payment-link-lifecycle.md rules 24 and 42 — the ledger row prints the server's link label, offers
// « Renvoyer la demande » only when the server does, and « Retirer le lien » behind its confirmation.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderFinance, dueRow, ledgerOf } from './ledgerFixtures';

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const rowEl = (key) => document.querySelector(`[data-row="${key}"]`);
const WITHDRAW = {
  linkId: 41, label: 'Retirer le lien', confirmTitle: 'Retirer ce lien ?', confirmMessage: 'Il ne pourra plus être payé.', confirmLabel: 'Retirer',
};
const openLink = (extra = {}) => ({ status: 'open', label: 'Lien envoyé le 30/10 · 840,00 € · valable jusqu’au 01/11 à 06:00', withdraw: WITHDRAW, ...extra });

beforeEach(() => { vi.clearAllMocks(); });

test('rule 24: the lapsed and withdrawn labels print as sent; « Renvoyer la demande » on the expired one only', () => {
  renderFinance({
    editingReservationId: 7,
    ledger: ledgerOf([
      dueRow('deposit', 'Acompte', 120, { detail: { link: { status: 'expired', label: 'Lien expiré le 01/11 à 06:00', resend: { type: 'deposit', label: 'Renvoyer la demande' } } } }),
      dueRow('balance', 'Solde', 200, { detail: { link: { status: 'cancelled', label: 'Lien retiré · dates prises' } } }),
    ]),
  });
  expect(within(rowEl('deposit')).getByText('Lien expiré le 01/11 à 06:00')).toBeInTheDocument();
  expect(within(rowEl('deposit')).getByRole('button', { name: 'Renvoyer la demande' })).toBeInTheDocument();
  expect(within(rowEl('balance')).getByText('Lien retiré · dates prises')).toBeInTheDocument();
  expect(within(rowEl('balance')).queryByRole('button', { name: 'Renvoyer la demande' })).toBeNull();
});

test('rule 42: « Retirer le lien » asks first; Annuler withdraws nothing', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance({ editingReservationId: 7, ledger: ledgerOf([dueRow('deposit', 'Acompte', 840, { detail: { link: openLink() } })]) });
  await user.click(within(rowEl('deposit')).getByRole('button', { name: 'Retirer le lien' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Retirer ce lien ?')).toBeInTheDocument();
  expect(within(dialog).getByText('Il ne pourra plus être payé.')).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
  expect(ctx.withdrawPaymentLink).not.toHaveBeenCalled();
});

test('rule 42: Retirer withdraws the link the server named', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance({ editingReservationId: 7, ledger: ledgerOf([dueRow('deposit', 'Acompte', 840, { detail: { link: openLink() } })]) });
  await user.click(within(rowEl('deposit')).getByRole('button', { name: 'Retirer le lien' }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Retirer' }));
  expect(ctx.withdrawPaymentLink).toHaveBeenCalledWith(41);
});

test('rule 42: no button when the server offers none (read-only stay, link no longer open)', () => {
  renderFinance({ editingReservationId: 7, ledger: ledgerOf([dueRow('deposit', 'Acompte', 840, { detail: { link: openLink({ withdraw: undefined }) } })]) });
  expect(screen.queryByRole('button', { name: 'Retirer le lien' })).toBeNull();
});

test('rule 42: on a devis too — the button only needs the server’s action', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance({ isDevisMode: true, editingReservationId: null, ledger: ledgerOf([dueRow('deposit', 'Acompte', 840, { action: null, detail: { link: openLink() } })]) });
  await user.click(screen.getByRole('button', { name: 'Retirer le lien' }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Retirer' }));
  expect(ctx.withdrawPaymentLink).toHaveBeenCalledWith(41);
});
