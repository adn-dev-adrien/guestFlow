import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderFinance, dueRow, paidRow, editable, ledgerOf } from './ledgerFixtures';

// specs/cash-complement-and-endofstay-finance.md §3 — the end-of-stay complement and the « Caisse
// interne » of the complements. Since specs/reservation-payment-ledger.md rule 8 the switch lives in the
// mark form of the complement rows, and only there (never on the acompte or the solde).

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const complement = (key, label, amount, extra = {}) => dueRow(key, label, amount, {
  stateLabel: key === 'complement' ? "À percevoir à l'arrivée" : 'À percevoir au départ',
  action: { kind: 'mark', label: 'Marquer perçu', cash: true },
  amountEdit: editable('complement'),
  detail: { slot: key },
  ...extra,
});

beforeEach(() => { vi.clearAllMocks(); });

test('end-of-stay complement row renders its amount and, folded, its breakdown', async () => {
  const user = userEvent.setup();
  renderFinance({
    editingReservationId: 7, reservationId: 7,
    form: {
      endOfStayComplementAmount: 88,
      endOfStayComplementDetail: JSON.stringify([{ label: 'Ménage', amount: 40 }, { label: 'Serviette', amount: 8 }]),
    },
    ledger: ledgerOf([complement('endOfStayComplement', 'Complément de fin de séjour', 88)]),
  });
  expect(screen.getByText('Complément de fin de séjour')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Détail' }));
  expect(screen.getByText(/Ménage : 40,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Serviette : 8,00 €/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Marquer perçu/ })).toBeInTheDocument();
});

test('end-of-stay « Marquer perçu » sends endOfStayComplementPaid + date', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance({
    editingReservationId: 7, reservationId: 7,
    ledger: ledgerOf([complement('endOfStayComplement', 'Complément de fin de séjour', 88)]),
  });
  await user.click(screen.getByRole('button', { name: /^Marquer perçu/ }));
  await user.click(screen.getByRole('button', { name: 'Valider' }));
  expect(ctx.markFromLedger).toHaveBeenCalledWith(
    expect.objectContaining({ endOfStayComplementPaid: true, endOfStayComplementPaidDate: expect.any(String), expectedAmountCents: 8800 }),
  );
});

test('end-of-stay « Caisse interne » sends the cash flag with the mark', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance({
    editingReservationId: 7, reservationId: 7,
    ledger: ledgerOf([complement('endOfStayComplement', 'Complément de fin de séjour', 88)]),
  });
  await user.click(screen.getByRole('button', { name: /^Marquer perçu/ }));
  await user.click(screen.getByLabelText('Caisse interne'));
  await user.click(screen.getByRole('button', { name: 'Valider' }));
  expect(ctx.markFromLedger).toHaveBeenCalledWith(expect.objectContaining({ endOfStayComplementPaid: true, endOfStayComplementPaidCash: true }));
});

test('arrival « Caisse interne » sends complementPaidCash with the mark', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance({
    editingReservationId: 7, reservationId: 7,
    ledger: ledgerOf([complement('complement', "Complément d'arrivée", 50)]),
  });
  await user.click(screen.getByRole('button', { name: /^Marquer perçu/ }));
  await user.click(screen.getByLabelText('Caisse interne'));
  await user.click(screen.getByRole('button', { name: 'Valider' }));
  expect(ctx.markFromLedger).toHaveBeenCalledWith(expect.objectContaining({ complementPaid: true, complementPaidCash: true }));
});

test('a caisse-interne complement reads its origin on the row (server label)', () => {
  renderFinance({
    editingReservationId: 7,
    ledger: ledgerOf([paidRow('complement', "Complément d'arrivée", 50, { stateLabel: 'Perçu le 12/10 · caisse interne' })]),
  });
  const row = document.querySelector('[data-row="complement"]');
  expect(within(row).getByText('Perçu le 12/10 · caisse interne')).toBeInTheDocument();
});
