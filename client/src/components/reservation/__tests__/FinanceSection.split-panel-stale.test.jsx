// specs/mixed-method-payments.md rules 16, 20 (audit R34-C-L1) — a correction left open on a settlement the row no longer
// has (undone meanwhile, then recorded again) does not hide the new settlement's « Modifier » nor its reste's
// « Marquer payé ».
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from './mockReservationForm';
import { paidRow, ledgerOf } from './ledgerFixtures';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { markPayment: vi.fn(), modifySettlement: vi.fn(async () => ({ ok: true })), collectSettlementRemainder: vi.fn(async () => ({ ok: true })) },
}));

const METHODS = [{ value: 'card', label: 'CB' }, { value: 'cash', label: 'Espèces' }];
const solde = (id, remainders = []) => paidRow('balance', 'Solde', 907.2, {
  stateLabel: remainders.length ? 'Perçu en partie' : 'Perçu le 08/11 · plusieurs moyens',
  split: {
    methods: METHODS,
    settlements: [{
      id, paidDate: '2026-11-08', label: 'Moyens de paiement', // date-literal-ok: a recorded settlement date shown as is, never compared with today
      lines: [{ label: 'Espèces 500,00 €', internal: false }, { label: 'CB 400,00 €', internal: false }],
      shortfall: null,
      edit: { dueCents: 90720, tenders: [{ method: 'cash', amountCents: 50000, internal: false }, { method: 'card', amountCents: 40000, internal: false }], shortfallKind: 'due' },
    }],
    remainders,
    overpaid: [],
  },
});

const tree = (ledger) => {
  const ctx = makeMockContext({ editingReservationId: 7, reservationId: 7, ledger });
  return (
    <DialogProvider>
      <ReservationFormProvider value={ctx}><FinanceSection /></ReservationFormProvider>
    </DialogProvider>
  );
};

test('R34-C-L1 — « Modifier » open on settlement 41, the payment undone and recorded again (42): its buttons are back', async () => {
  const user = userEvent.setup();
  const view = render(tree(ledgerOf([solde(41)])));
  await user.click(screen.getByRole('button', { name: 'Modifier' }));
  expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull();

  view.rerender(tree(ledgerOf([solde(42, [{ targetKind: 'bucket', targetKey: 'balance', dueCents: 720, label: 'Reste à percevoir 7,20 €' }])])));
  expect(screen.getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Marquer payé' })).toBeInTheDocument();
});
