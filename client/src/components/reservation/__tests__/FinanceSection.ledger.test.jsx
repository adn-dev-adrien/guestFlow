// specs/reservation-payment-ledger.md — the payments ledger on the fiche: marks through the inline
// form and the page's save-first pipeline (rules 8-10), refusals in place (rule 9), the caution order
// (rule 12), undo with a confirmation naming the date (rule 14), amount editing through the server
// (rules 15, 19, 21), the platform statement and transfer (rules 25-26), links (rule 28).
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderFinance, dueRow, paidRow, editable, ledgerOf } from './ledgerFixtures';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { markPayment: vi.fn().mockResolvedValue({ ok: true }), computePlatformCommission: vi.fn() },
}));
import api from '../../../api';

const rowEl = (key) => document.querySelector(`[data-row="${key}"]`);
beforeEach(() => { vi.clearAllMocks(); });

test('rule 8 — no « Caisse interne » on the acompte or the solde; closing the form restores the row', async () => {
  const user = userEvent.setup();
  renderFinance({ editingReservationId: 7, ledger: ledgerOf([dueRow('deposit', 'Acompte', 90), dueRow('balance', 'Solde', 217.2)]) });
  await user.click(within(rowEl('deposit')).getByRole('button', { name: 'Marquer perçu' }));
  expect(screen.queryByLabelText('Caisse interne')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(screen.queryByLabelText('Perçu le')).toBeNull();
  expect(within(rowEl('deposit')).getByRole('button', { name: 'Marquer perçu' })).toBeInTheDocument();
});

test('rule 9 — the server\'s date refusal shows under the date field and the form stays open', async () => {
  const user = userEvent.setup();
  const markFromLedger = vi.fn(async () => ({ ok: false, error: 'Un encaissement ne peut pas être daté dans le futur.', field: 'date' }));
  renderFinance({ editingReservationId: 7, markFromLedger, ledger: ledgerOf([dueRow('deposit', 'Acompte', 90)]) });
  await user.click(screen.getByRole('button', { name: 'Marquer perçu' }));
  const date = screen.getByLabelText('Perçu le');
  fireEvent.change(date, { target: { value: '2099-01-01' } });
  await user.click(screen.getByRole('button', { name: 'Valider' }));
  expect(await screen.findByText('Un encaissement ne peut pas être daté dans le futur.')).toBeInTheDocument();
  expect(screen.getByLabelText('Perçu le')).toHaveValue('2099-01-01');
  expect(markFromLedger).toHaveBeenCalledWith(expect.objectContaining({ depositPaidDate: '2099-01-01' }), null);
});

test('rules 10-11 — a mark goes through the page\'s save-first pipeline with the amount seen, in cents', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance({ editingReservationId: 7, ledger: ledgerOf([dueRow('balance', 'Solde', 614.4)]) });
  await user.click(screen.getByRole('button', { name: 'Marquer perçu' }));
  await user.click(screen.getByRole('button', { name: 'Valider' }));
  expect(ctx.markFromLedger).toHaveBeenCalledWith(
    { balancePaid: true, balancePaidDate: expect.any(String), expectedAmountCents: 61440 },
    null,
  );
  expect(api.markPayment).not.toHaveBeenCalled();
});

test('rule 12 — « Restituer » is not offered before the caution is received', () => {
  renderFinance({
    editingReservationId: 7,
    ledger: ledgerOf([
      dueRow('cautionReceived', 'Caution reçue', 400, { stateLabel: "À recevoir à l'arrivée", action: { kind: 'mark', label: 'Recevoir' } }),
      { ...dueRow('cautionReturned', 'Caution restituée', 400), state: 'waiting', tone: 'muted', stateLabel: 'Après réception', action: null },
    ]),
  });
  expect(screen.getByText('Après réception')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Restituer' })).toBeNull();
});

test('rule 14 — undo asks with the server\'s sentence (date + accounting entry), then un-ticks', async () => {
  const user = userEvent.setup();
  const confirmText = 'Annuler la perception de l\'acompte du 12/08 ? L\'écriture comptable correspondante disparaît.';
  const { ctx } = renderFinance({
    editingReservationId: 7,
    ledger: ledgerOf([paidRow('deposit', 'Acompte', 90, { action: { kind: 'undo', label: 'Annuler', confirm: confirmText } })]),
  });
  await user.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(await screen.findByText(confirmText)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Annuler la perception' }));
  await waitFor(() => expect(api.markPayment).toHaveBeenCalledWith(7, { depositPaid: false }));
  expect(ctx.reloadReservationFinance).toHaveBeenCalled();
});

test('rule 14 — « Garder » keeps the payment', async () => {
  const user = userEvent.setup();
  renderFinance({ editingReservationId: 7, ledger: ledgerOf([paidRow('cautionReceived', 'Caution reçue', 400)]) });
  await user.click(screen.getByRole('button', { name: 'Annuler' }));
  await user.click(await screen.findByRole('button', { name: 'Garder' }));
  expect(api.markPayment).not.toHaveBeenCalled();
});

test('rules 15, 21 — the editor asks the server and « Valider » applies its formPatch', async () => {
  const user = userEvent.setup();
  const answer = { ok: true, amount: 250, reached: 250, effects: ['Acompte : 90,00 € → 57,20 € · total inchangé'], formPatch: { depositAmountOverride: 57.2, ledgerAmountEdit: 'balance' } };
  const checkLedgerEdit = vi.fn(async () => answer);
  const { ctx } = renderFinance({
    editingReservationId: 7, checkLedgerEdit,
    ledger: ledgerOf([dueRow('balance', 'Solde', 217.2, { amountEdit: editable('split', { help: 'Entre 7,20 € et 307,20 €.' }) })]),
  });
  await user.click(screen.getByRole('button', { name: /Modifier le montant : Solde/ }));
  const field = screen.getByLabelText('Montant du solde (€)');
  await user.clear(field);
  await user.type(field, '250');
  expect(await screen.findByText('Acompte : 90,00 € → 57,20 € · total inchangé')).toBeInTheDocument();
  expect(checkLedgerEdit).toHaveBeenLastCalledWith('balance', '250');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Valider' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Valider' }));
  expect(ctx.applyLedgerPatch).toHaveBeenCalledWith(answer.formPatch);
});

test('rule 15 — a locked amount shows its reason on demand', async () => {
  const user = userEvent.setup();
  renderFinance({
    editingReservationId: 7,
    ledger: ledgerOf([dueRow('deposit', 'Acompte', 90, { amountEdit: { editable: false, mode: 'locked', reason: 'Solde déjà perçu : l\'acompte ne peut plus changer.' } })]),
  });
  await user.click(screen.getByRole('button', { name: /Montant figé : Acompte/ }));
  expect(screen.getByRole('alert')).toHaveTextContent('Solde déjà perçu : l\'acompte ne peut plus changer.');
});

test('rule 16 — « Calcul automatique » applies the server\'s reset patch', async () => {
  const user = userEvent.setup();
  const reset = { label: 'Calcul automatique', patch: { depositAmountOverride: '' } };
  const { ctx } = renderFinance({
    editingReservationId: 7,
    ledger: ledgerOf([dueRow('deposit', 'Acompte', 120, { amountEdit: editable('amount', { reset }) })]),
  });
  await user.click(screen.getByRole('button', { name: /Modifier le montant : Acompte/ }));
  await user.click(screen.getByRole('button', { name: 'Calcul automatique' }));
  expect(ctx.applyLedgerPatch).toHaveBeenCalledWith({ depositAmountOverride: '' });
});

test('rule 19 — « Créer le remboursement » opens the refund dialog prefilled with the gap', async () => {
  const user = userEvent.setup();
  const checkLedgerEdit = vi.fn(async () => ({ ok: false, reason: 'Déjà perçu : 866,40 €. Pour rendre 66,40 €, créer un remboursement.', refund: { amount: 66.4, label: 'Créer le remboursement' } }));
  const { ctx } = renderFinance({
    editingReservationId: 7, reservationId: 7, checkLedgerEdit,
    ledger: ledgerOf([paidRow('balance', 'Solde', 866.4, { amountEdit: { editable: false, mode: 'paid', reason: 'Solde perçu le 12/08 : montant figé.' } })]),
  });
  await user.click(screen.getByRole('button', { name: /Montant figé : Solde/ }));
  const field = screen.getByLabelText('Montant du solde (€)');
  await user.clear(field);
  await user.type(field, '800');
  await user.click(await screen.findByRole('button', { name: 'Créer le remboursement' }));
  expect(ctx.setRefundDialogOpen).toHaveBeenCalledWith({ overpaymentTtc: 66.4, overpaymentLines: null });
});

test('rule 26 — « Marquer reçu » asks for the transfer, words the gap and carries the commission in the form patch', async () => {
  const user = userEvent.setup();
  api.computePlatformCommission.mockResolvedValue({ gap: 12.03, gapLabel: 'Écart : 12,03 € avec le net attendu', commission: 170, commissionLabel: 'Commission solde → 170,00 €' });
  const { ctx } = renderFinance({
    editingReservationId: 7,
    form: { platform: 'Booking', platformGrossAmount: 987.39 },
    ledger: ledgerOf([dueRow('balance', 'Versement Booking', 987.39, {
      stateLabel: 'Attendu le 22/10', action: { kind: 'mark', label: 'Marquer reçu', payout: { expected: 829.42 } }, amountEdit: editable('statement'),
    })]),
  });
  await user.click(screen.getByRole('button', { name: 'Marquer reçu' }));
  expect(screen.getByLabelText('Reçu le')).toBeInTheDocument();
  const payout = screen.getByLabelText('Virement reçu (€)');
  expect(payout).toHaveValue('829,42');
  await user.clear(payout);
  await user.type(payout, '817,39');
  await user.click(await screen.findByRole('button', { name: 'Commission solde → 170,00 €' }));
  expect(screen.getByText('Écart : 12,03 € avec le net attendu')).toBeInTheDocument();
  expect(api.computePlatformCommission).toHaveBeenLastCalledWith(expect.objectContaining({ payout: 817.39, expectedNet: 829.42 }));
  await user.click(screen.getByRole('button', { name: 'Valider' }));
  expect(ctx.markFromLedger).toHaveBeenCalledWith(
    expect.objectContaining({ balancePaid: true, expectedAmountCents: 98739 }),
    { platformPayoutAmount: 817.39, platformCommissionAmount: 170 },
  );
});

test('rule 25 — the payout amount opens the statement fields', async () => {
  const user = userEvent.setup();
  renderFinance({
    editingReservationId: 7, form: { platform: 'Booking' },
    ledger: ledgerOf([dueRow('balance', 'Versement Booking', 987.39, { amountEdit: editable('statement') })]),
  });
  await user.click(screen.getByRole('button', { name: /Modifier le montant : Versement Booking/ }));
  expect(screen.getByLabelText('Commission solde (€)')).toBeInTheDocument();
});

test('rule 28 — the link reads on its row; « Renvoyer la demande » only when the server offers it', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance({
    editingReservationId: 7,
    ledger: ledgerOf([
      dueRow('deposit', 'Acompte', 120, { detail: { link: { status: 'cancelled', label: 'Lien retiré · montant modifié', resend: { type: 'deposit', label: 'Renvoyer la demande' } } } }),
      paidRow('balance', 'Solde', 100, { detail: { link: { status: 'paid', label: 'Payé par lien le 05/08' } } }),
    ]),
  });
  expect(screen.getByText('Lien retiré · montant modifié')).toBeInTheDocument();
  expect(within(rowEl('balance')).getByText('Payé par lien le 05/08')).toBeInTheDocument();
  expect(within(rowEl('balance')).queryByRole('button', { name: 'Renvoyer la demande' })).toBeNull();
  await user.click(within(rowEl('deposit')).getByRole('button', { name: 'Renvoyer la demande' }));
  expect(ctx.resendPaymentRequest).toHaveBeenCalledWith('deposit');
});

test('rule 32 — a zero acompte reads « Aucun acompte » with no action', () => {
  renderFinance({
    editingReservationId: 7,
    ledger: ledgerOf([{ ...dueRow('deposit', 'Acompte', 0), state: 'none', tone: 'muted', stateLabel: 'Aucun acompte', action: null }]),
  });
  expect(within(rowEl('deposit')).getByText('Aucun acompte')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Marquer perçu' })).toBeNull();
});
