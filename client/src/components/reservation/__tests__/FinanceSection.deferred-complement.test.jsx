import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderFinance, dueRow, editable, ledgerOf } from './ledgerFixtures';

// specs/defer-arrival-complement-to-checkout.md §3.2 — « En fin de séjour » chosen at check-in: the
// fiche shows ONE « Complément de fin de séjour » (arrival lines + end-of-stay lines, one total, one
// paid action) instead of two that read like a double count. Since specs/reservation-payment-ledger.md
// rule 22 it is one ledger row; the server settles both buckets (rule 8 of the defer spec).

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const CHECKOUT_COMPLEMENT = {
  deferred: true,
  amount: 78,
  arrivalAmount: 38,
  endOfStayAmount: 40,
  paid: false,
  paidCash: false,
  paidDate: null,
  lines: [
    { label: 'Linge de toilette', qty: 4, unitPrice: 8, amount: 32, origin: 'arrival' },
    { label: 'Taxe de séjour', qty: 1, unitPrice: 6, amount: 6, origin: 'arrival' },
    { label: 'Ménage de fin de séjour', qty: 1, unitPrice: 40, amount: 40, origin: 'endOfStay' },
  ],
};
const MERGED_ROW = dueRow('checkoutComplement', 'Complément de fin de séjour', 78, {
  stateLabel: 'À percevoir au départ',
  action: { kind: 'mark', label: 'Marquer perçu', cash: true },
  amountEdit: editable('complement'),
  detail: { slot: 'checkoutComplement' },
});
const BASE = {
  editingReservationId: 7, reservationId: 7,
  pricingQuote: { complementAmount: 38 },
  form: { checkoutComplement: CHECKOUT_COMPLEMENT, complementDeferredToCheckout: true, endOfStayComplementAmount: 40 },
  ledger: ledgerOf([MERGED_ROW]),
};

beforeEach(() => { vi.clearAllMocks(); });

test('deferred: a single « Complément de fin de séjour » row with every line and the combined total', async () => {
  const user = userEvent.setup();
  renderFinance(BASE);
  const row = document.querySelector('[data-row="checkoutComplement"]');
  expect(within(row).getByText('Complément de fin de séjour')).toBeInTheDocument();
  expect(within(row).getByText(/78,00/)).toBeInTheDocument();
  await user.click(within(row).getByRole('button', { name: 'Détail' }));
  expect(screen.getByText(/Linge de toilette : 32,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Taxe de séjour : 6,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Ménage de fin de séjour : 40,00 €/)).toBeInTheDocument();
  expect(screen.queryByText("Complément d'arrivée")).not.toBeInTheDocument();
});

test('deferred: « Marquer perçu » sends ONE mark for the merged amount (the server settles both buckets)', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance(BASE);
  await user.click(screen.getByRole('button', { name: 'Marquer perçu' }));
  await user.click(screen.getByRole('button', { name: 'Valider' }));
  expect(ctx.markFromLedger).toHaveBeenCalledWith(
    expect.objectContaining({ complementPaid: true, complementPaidDate: expect.any(String), expectedAmountCents: 7800 }),
    null,
  );
});

test('deferred: « Caisse interne » in the mark form flags the merged complement', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance(BASE);
  await user.click(screen.getByRole('button', { name: 'Marquer perçu' }));
  await user.click(screen.getByLabelText('Caisse interne'));
  await user.click(screen.getByRole('button', { name: 'Valider' }));
  expect(ctx.markFromLedger).toHaveBeenCalledWith(expect.objectContaining({ complementPaid: true, complementPaidCash: true }), null);
});

test('not deferred: the two complements are two rows', () => {
  renderFinance({
    ...BASE,
    ledger: ledgerOf([
      dueRow('complement', "Complément d'arrivée", 38, { amountEdit: editable('complement'), detail: { slot: 'complement' } }),
      dueRow('endOfStayComplement', 'Complément de fin de séjour', 40, { amountEdit: editable('complement'), detail: { slot: 'endOfStayComplement' } }),
    ]),
  });
  expect(screen.getByText("Complément d'arrivée")).toBeInTheDocument();
  expect(screen.getByText('Complément de fin de séjour')).toBeInTheDocument();
});
