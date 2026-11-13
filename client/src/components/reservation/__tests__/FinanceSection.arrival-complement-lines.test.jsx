import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderFinance as renderLedger, dueRow, editable, ledgerOf } from './ledgerFixtures';

// specs/lock-at-arrival-time-and-arrival-complement-lines.md rules 6-7 — the « Détail » of the arrival
// complement lists what it contains, through the same component as the end-of-stay complement. The lines
// come from the server (live quote, else the stored payload); the fiche sums nothing.

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const LEDGER = ledgerOf([dueRow('complement', "Complément d'arrivée", 63.8, {
  amountEdit: editable('complement'), detail: { slot: 'complement' },
})]);
const LATE_CHECKOUT = { kind: 'option', label: 'Départ tardif', qty: 1, unitPrice: 63.8, amount: 63.8 };

async function open(overrides) {
  renderLedger({ ledger: LEDGER, editingReservationId: 7, reservationId: 7, ...overrides });
  await userEvent.click(screen.getByRole('button', { name: 'Détail' }));
}

test('the stored lines of the payload are listed under « Détail »', async () => {
  await open({ form: { startDate: '2099-06-01', endDate: '2099-06-05', arrivalComplementLines: [LATE_CHECKOUT] } });
  expect(screen.getByText(/Départ tardif : 63,80 €/)).toBeInTheDocument();
});

test('the live quote lines win while the fiche is being edited', async () => {
  await open({
    pricingQuote: { complementAmountAuto: 70, complementDetailLines: [{ ...LATE_CHECKOUT, label: 'Ménage', amount: 70 }] },
    form: { startDate: '2099-06-01', endDate: '2099-06-05', arrivalComplementLines: [LATE_CHECKOUT] },
  });
  expect(screen.getByText(/Ménage : 70,00 €/)).toBeInTheDocument();
  expect(screen.queryByText(/Départ tardif/)).not.toBeInTheDocument();
});

test('an empty live list wins over stale stored lines: the complement was emptied', async () => {
  await open({
    pricingQuote: { complementAmountAuto: 0, complementDetailLines: [] },
    form: { startDate: '2099-06-01', endDate: '2099-06-05', arrivalComplementLines: [LATE_CHECKOUT] },
  });
  expect(screen.queryByText(/Départ tardif/)).not.toBeInTheDocument();
});
