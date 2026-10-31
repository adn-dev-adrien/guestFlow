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

test('rule 42 (review of #902, L5): a second open link of the row prints too, each with its own « Retirer le lien »', async () => {
  const user = userEvent.setup();
  const other = { status: 'open', label: 'Lien envoyé le 29/10 · 300,00 € · valable jusqu’au 31/10 à 12:00', withdraw: { ...WITHDRAW, linkId: 40 } };
  const { ctx } = renderFinance({
    editingReservationId: 7,
    ledger: ledgerOf([dueRow('balance', 'Solde', 210, { detail: { link: openLink(), otherLinks: [other] } })]),
  });
  expect(within(rowEl('balance')).getByText(other.label)).toBeInTheDocument();
  const buttons = within(rowEl('balance')).getAllByRole('button', { name: 'Retirer le lien' });
  expect(buttons).toHaveLength(2);
  await user.click(buttons[1]);
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Retirer' }));
  expect(ctx.withdrawPaymentLink).toHaveBeenCalledWith(40);
});

// specs/payment-link-lifecycle.md rule 56 — a payment received after a withdrawal by hand: refunded or recorded on the stay.
const SETTLE = {
  linkId: 44,
  stay: { label: 'Enregistrer sur le séjour', confirmTitle: 'Enregistrer ce paiement sur le séjour ?', confirmMessage: 'Le montant est compté comme perçu.', confirmLabel: 'Enregistrer' },
  refunded: { label: 'Marquer remboursé', confirmTitle: 'Paiement remboursé ?', confirmMessage: 'À confirmer une fois le remboursement fait chez le prestataire.', confirmLabel: 'Remboursé' },
};
const unsettled = { status: 'cancelled', label: 'Payé le 30/10 après retrait : à traiter', settle: SETTLE };

for (const [outcome, action] of [['stay', SETTLE.stay], ['refunded', SETTLE.refunded]]) {
  test(`rule 56: « ${action.label} » asks first, then settles the payment as ${outcome}`, async () => {
    const user = userEvent.setup();
    const { ctx } = renderFinance({ editingReservationId: 7, ledger: ledgerOf([dueRow('deposit', 'Acompte', 90, { detail: { link: unsettled } })]) });
    expect(within(rowEl('deposit')).getByText(unsettled.label)).toBeInTheDocument();
    await user.click(within(rowEl('deposit')).getByRole('button', { name: action.label }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(action.confirmTitle)).toBeInTheDocument();
    expect(within(dialog).getByText(action.confirmMessage)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: action.confirmLabel }));
    expect(ctx.settlePaymentLink).toHaveBeenCalledWith(44, outcome);
  });
}

test('rule 56: a payment to settle listed beside the row’s link offers its two actions', () => {
  renderFinance({ editingReservationId: 7, ledger: ledgerOf([dueRow('balance', 'Solde', 210, { detail: { link: openLink(), otherLinks: [unsettled] } })]) });
  expect(within(rowEl('balance')).getByRole('button', { name: 'Enregistrer sur le séjour' })).toBeInTheDocument();
  expect(within(rowEl('balance')).getByRole('button', { name: 'Marquer remboursé' })).toBeInTheDocument();
});
