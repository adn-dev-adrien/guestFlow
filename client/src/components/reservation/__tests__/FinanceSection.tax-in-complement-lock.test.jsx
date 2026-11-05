// specs/force-item-to-complement.md rule 20 (audit R23-N2) — a tax already collected cannot be switched to the complement: the
// server says so (`touristTaxInComplementLockedReason`), the fiche greys the switch and gives the reason under it.
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderFinance, paidRow, ledgerOf } from './ledgerFixtures';

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const LEDGER = ledgerOf([paidRow('balance', 'Solde', 604.8)]);
const QUOTE = { touristTaxTotal: 4.8 };
const taxSwitch = () => screen.getByRole('switch', { name: /Taxe de séjour en complément/ });
const open = (extra) => renderFinance({ form: { platform: 'direct', touristTaxInComplement: 0 }, ledger: LEDGER, pricingQuote: QUOTE, ...extra });

beforeEach(() => { vi.clearAllMocks(); });

test.each([
  ['collected-on-solde', 'Taxe encaissée avec le solde : décocher le solde d’abord.'],
  ['collected-on-acompte', 'Taxe encaissée avec l’acompte : décocher l’acompte d’abord.'],
  ['collected-on-installment', 'Taxe encaissée avec une échéance.'],
])('%s: disabled, says why, nothing moves', async (reason, caption) => {
  const { ctx } = open({ touristTaxInComplementLockedReason: reason });
  expect(taxSwitch()).toBeDisabled();
  expect(screen.getByText(caption)).toBeInTheDocument();
  expect(taxSwitch()).toHaveAccessibleDescription(caption);
  await userEvent.setup({ pointerEventsCheck: 0 }).click(taxSwitch());
  expect(ctx.updateForm).not.toHaveBeenCalled();
});

test('no reason: the switch stays free, with no caption', async () => {
  const { ctx } = open({ touristTaxInComplementLockedReason: null });
  expect(taxSwitch()).toBeEnabled();
  expect(screen.queryByText(/Taxe encaissée/)).toBeNull();
  await userEvent.setup().click(taxSwitch());
  expect(ctx.updateForm).toHaveBeenCalledWith({ touristTaxInComplement: true });
});

test('already on: a lock never freezes it, it can go off', async () => {
  const { ctx } = open({ form: { platform: 'direct', touristTaxInComplement: 1 }, touristTaxInComplementLockedReason: 'collected-on-solde' });
  expect(taxSwitch()).toBeEnabled();
  expect(screen.queryByText(/Taxe encaissée/)).toBeNull();
  await userEvent.setup().click(taxSwitch());
  expect(ctx.updateForm).toHaveBeenCalledWith({ touristTaxInComplement: false });
});
