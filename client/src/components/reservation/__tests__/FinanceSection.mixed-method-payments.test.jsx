// specs/mixed-method-payments.md rules 17, 20-22, 30 — the fiche: « Plusieurs moyens » in the mark form, the
// settlements of a paid row, their correction and the reste à percevoir.
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import api from '../../../api';
import { renderFinance, dueRow, paidRow, ledgerOf } from './ledgerFixtures';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { markPayment: vi.fn(), modifySettlement: vi.fn(async () => ({ ok: true })), collectSettlementRemainder: vi.fn(async () => ({ ok: true })) },
}));

beforeEach(() => { vi.clearAllMocks(); });

const METHODS = [{ value: 'card', label: 'CB' }, { value: 'cash', label: 'Espèces' }, { value: 'cheque', label: 'Chèque' }];
const cleaning = () => dueRow('endOfStayComplement', 'Fin de séjour', 122, {
  action: { kind: 'mark', label: 'Marquer perçu', cash: true, split: { dueCents: 12200, methods: METHODS } },
});
const amount = (i) => document.querySelector(`[data-tender-amount="${i}"]`);

test('rule 21 — « Plusieurs moyens » only appears once the mark form is open', async () => {
  const user = userEvent.setup();
  renderFinance({ editingReservationId: 7, reservationId: 7, ledger: ledgerOf([cleaning()]) });
  expect(screen.queryByRole('button', { name: 'Plusieurs moyens' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /^Marquer perçu/ }));
  expect(screen.getByRole('button', { name: 'Plusieurs moyens' })).toBeInTheDocument();
});

test('rules 1-10 — 50 € cash + 72 € card is sent with the mark and the amount seen', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance({ editingReservationId: 7, reservationId: 7, ledger: ledgerOf([cleaning()]) });
  await user.click(screen.getByRole('button', { name: /^Marquer perçu/ }));
  await user.click(screen.getByRole('button', { name: 'Plusieurs moyens' }));
  expect(screen.queryByLabelText('Caisse interne', { selector: 'input[type="checkbox"]:not([role])' })).toBeNull();
  fireEvent.change(amount(0), { target: { value: '50' } });
  await user.click(screen.getByRole('button', { name: 'Encaisser 122,00 €' }));
  expect(ctx.markFromLedger).toHaveBeenCalledWith(expect.objectContaining({
    endOfStayComplementPaid: true,
    expectedAmountCents: 12200,
    tenders: [{ method: 'cash', amountCents: 5000, internal: true }, { method: 'card', amountCents: 7200, internal: false }],
  }));
});

test('rule 22 — « Un seul moyen » brings the ordinary form back', async () => {
  const user = userEvent.setup();
  renderFinance({ editingReservationId: 7, reservationId: 7, ledger: ledgerOf([cleaning()]) });
  await user.click(screen.getByRole('button', { name: /^Marquer perçu/ }));
  await user.click(screen.getByRole('button', { name: 'Plusieurs moyens' }));
  await user.click(screen.getByRole('button', { name: 'Un seul moyen' }));
  expect(screen.getByRole('button', { name: 'Valider' })).toBeInTheDocument();
});

const splitPaid = (extra = {}) => paidRow('endOfStayComplement', 'Fin de séjour', 122, {
  stateLabel: 'Perçu le 08/11 · plusieurs moyens',
  split: {
    methods: METHODS,
    settlements: [{
      id: 41, paidDate: '2026-11-08', label: 'Moyens de paiement',
      lines: [{ label: 'Espèces 50,00 €', internal: true }, { label: 'CB 72,00 €', internal: false }],
      shortfall: null,
      edit: { dueCents: 12200, tenders: [{ method: 'cash', amountCents: 5000, internal: true }, { method: 'card', amountCents: 7200, internal: false }], shortfallKind: null },
    }],
    remainder: null,
    ...extra,
  },
});

test('rule 30 — a paid row lists its lines and the caisse interne', () => {
  renderFinance({ editingReservationId: 7, reservationId: 7, ledger: ledgerOf([splitPaid()]) });
  expect(screen.getByText('Espèces 50,00 €')).toBeInTheDocument();
  expect(screen.getByText('caisse interne')).toBeInTheDocument();
  expect(screen.getByText('CB 72,00 €')).toBeInTheDocument();
});

test('rule 20 — « Modifier » reopens the lines prefilled and saves the correction', async () => {
  const user = userEvent.setup();
  const { ctx } = renderFinance({ editingReservationId: 7, reservationId: 7, ledger: ledgerOf([splitPaid()]) });
  await user.click(screen.getByRole('button', { name: 'Modifier' }));
  expect(amount(0).value).toBe('50,00');
  fireEvent.change(amount(0), { target: { value: '40' } });
  fireEvent.change(amount(1), { target: { value: '82' } });
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(api.modifySettlement).toHaveBeenCalledWith(7, 41, expect.objectContaining({
    date: '2026-11-08',
    tenders: [{ method: 'cash', amountCents: 4000, internal: true }, { method: 'card', amountCents: 8200, internal: false }],
  }));
  expect(ctx.reloadReservationFinance).toHaveBeenCalled();
});

test('rule 17 — the reste à percevoir is collected from its own block', async () => {
  const user = userEvent.setup();
  renderFinance({
    editingReservationId: 7, reservationId: 7,
    ledger: ledgerOf([splitPaid({ remainder: { dueCents: 800, targetKind: 'bucket', targetKey: 'endOfStayComplement', label: 'Reste à percevoir 8,00 €' } })]),
  });
  expect(screen.getByText('Reste à percevoir 8,00 €')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Marquer payé' }));
  expect(amount(0).value).toBe('8,00');
  await user.click(screen.getByRole('button', { name: 'Encaisser 8,00 €' }));
  expect(api.collectSettlementRemainder).toHaveBeenCalledWith(7, expect.objectContaining({
    targetKind: 'bucket', targetKey: 'endOfStayComplement',
    tenders: [{ method: 'cash', amountCents: 800, internal: true }],
  }));
});
