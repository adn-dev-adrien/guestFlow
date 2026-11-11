import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderFinance as renderLedger, dueRow, paidRow, editable, ledgerOf } from './ledgerFixtures';

// specs/defer-arrival-complement-to-checkout.md rule 22 (audit R28-C-M1, 2026-11-08) — the merged card of a deferred
// complement never carries an end of stay already settled: the server's block names the part it holds
// (`checkoutComplement.endOfStayAmount`, 0 here), and the card's « Montant ajusté » reads that part, not the end of stay's
// total, so a typed total lands whole on the arrival complement.

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const row = (key, label, amount, paid) => (paid ? paidRow : dueRow)(key, label, amount, {
  amountEdit: editable('complement'), detail: { slot: key },
});
const FUTURE = { startDate: '2099-06-01', endDate: '2099-06-05' };

beforeEach(() => { vi.clearAllMocks(); });

test('règle 22 — la carte fusionnée sans la fin de séjour déjà perçue : le total saisi va au complément d’arrivée', async () => {
  const user = userEvent.setup();
  const { ctx } = renderLedger({
    ledger: ledgerOf([
      row('checkoutComplement', 'Complément de fin de séjour', 20, false),
      row('endOfStayComplement', 'Complément de fin de séjour', 50, true),
    ]),
    editingReservationId: 7,
    reservationId: 7,
    pricingQuote: {
      complementAmount: 20, complementAmountAuto: 20,
      endOfStayComplementTotal: 50, endOfStayComplementAutoTotal: 50,
      checkoutComplement: {
        deferred: true, amount: 20, arrivalAmount: 20, endOfStayAmount: 0,
        paid: false, paidCash: false, paidDate: null,
        lines: [{ label: 'Draps', amount: 20, origin: 'arrival' }],
      },
    },
    form: {
      ...FUTURE,
      complementDeferredToCheckout: true,
      endOfStayComplementPaid: true,
      complementAdjustment: { floor: 0, tax: 0, accommodation: 0, allocation: null },
    },
  });
  const [merged] = screen.getAllByRole('button', { name: 'Détail' });
  await user.click(merged);
  expect(screen.getByText(/Calcul auto \(20,00 €\)/)).toBeInTheDocument();
  await user.type(screen.getByLabelText(/Montant ajusté/i), '30');
  await user.tab();
  expect(ctx.updateForm).toHaveBeenCalledWith({ complementAmountOverride: 30 });
});
