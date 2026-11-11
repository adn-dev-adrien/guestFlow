// specs/mixed-method-payments.md rule 44 (audit R34 NEW-4, mutant C8) — the mark form hands the ledger row's
// `action.split.whole` to its tender lines: on the acompte a cash line starts on the books and, short of the amount,
// no reste / geste can be chosen.
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderFinance, dueRow, ledgerOf } from './ledgerFixtures';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { markPayment: vi.fn(), modifySettlement: vi.fn(), collectSettlementRemainder: vi.fn() },
}));

beforeEach(() => { vi.clearAllMocks(); });

const METHODS = [{ value: 'card', label: 'CB' }, { value: 'cash', label: 'Espèces' }, { value: 'transfer', label: 'Virement' }];
const amount = (i) => document.querySelector(`[data-tender-amount="${i}"]`);
const acompte = (whole) => dueRow('deposit', 'Acompte', 200, {
  action: { kind: 'mark', label: 'Marquer perçu', split: { dueCents: 20000, methods: METHODS, ...(whole ? { whole: true } : {}) } },
});

test('rule 44 — the acompte row says whole: cash on the books, no shortfall choice, the submit stays closed short of the amount', async () => {
  const user = userEvent.setup();
  renderFinance({ editingReservationId: 7, reservationId: 7, ledger: ledgerOf([acompte(true)]) });
  await user.click(screen.getByRole('button', { name: /^Marquer perçu/ }));
  await user.click(screen.getByRole('button', { name: 'Plusieurs moyens' }));
  expect(screen.getByRole('switch', { name: 'Caisse interne' })).not.toBeChecked();
  fireEvent.change(amount(0), { target: { value: '50' } });
  fireEvent.change(amount(1), { target: { value: '100' } });
  expect(document.querySelector('[data-shortfall]')).toBeNull();
  expect(document.querySelector('[data-tender-whole]')).not.toBeNull();
});

test('rule 44 — a row without whole keeps D2: cash in the caisse interne by default', async () => {
  const user = userEvent.setup();
  renderFinance({ editingReservationId: 7, reservationId: 7, ledger: ledgerOf([acompte(false)]) });
  await user.click(screen.getByRole('button', { name: /^Marquer perçu/ }));
  await user.click(screen.getByRole('button', { name: 'Plusieurs moyens' }));
  expect(screen.getByRole('switch', { name: 'Caisse interne' })).toBeChecked();
});
