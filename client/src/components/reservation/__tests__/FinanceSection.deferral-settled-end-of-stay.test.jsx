import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderFinance, dueRow, paidRow, editable, ledgerOf } from './ledgerFixtures';

// specs/defer-arrival-complement-to-checkout.md rule 23 (audit R28 verification N2) — « Percevoir en fin de séjour » is
// closed while the end-of-stay complement is collected (books or caisse interne), and says why.

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const row = (key, label, amount, paid) => (paid ? paidRow : dueRow)(key, label, amount, {
  amountEdit: editable('complement'), detail: { slot: key },
});
const LEDGER = ledgerOf([
  row('complement', "Complément d'arrivée", 24, false),
  row('endOfStayComplement', 'Complément de fin de séjour', 12, true),
]);

async function renderWith(form) {
  renderFinance({
    ledger: LEDGER, editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 24, complementAmountAuto: 24, endOfStayComplementTotal: 12 },
    form,
  });
  for (const button of screen.queryAllByRole('button', { name: 'Détail' })) await userEvent.click(button);
}

for (const [label, form] of [
  ['perçue', { endOfStayComplementPaid: true }],
  ['en caisse interne', { endOfStayComplementPaidCash: true }],
]) {
  test(`règle 23 — fin de séjour ${label} : « Percevoir en fin de séjour » fermé, raison affichée`, async () => {
    await renderWith(form);
    expect(screen.getByRole('button', { name: /^Percevoir en fin de séjour$/i })).toBeDisabled();
    expect(screen.getByText('Complément de fin de séjour déjà encaissé.')).toBeInTheDocument();
  });
}

test('règle 23 — fin de séjour due : le report reste ouvert', async () => {
  await renderWith({});
  expect(screen.getByRole('button', { name: /^Percevoir en fin de séjour$/i })).toBeEnabled();
  expect(screen.queryByText('Complément de fin de séjour déjà encaissé.')).not.toBeInTheDocument();
});
