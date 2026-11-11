// specs/disable-deposit-per-reservation.md rule 13 (review of PR #893, RQ2) — an acompte a payment link
// collected cannot be switched off: the server says so (`depositDisabledLockedReason`), the fiche greys
// « Sans acompte » and gives the reason under it.
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderFinance, paidRow, dueRow, ledgerOf } from './ledgerFixtures';

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const CAPTION = 'Acompte perçu par un lien de paiement : remboursement pour l’annuler.';
const LEDGER = ledgerOf([paidRow('deposit', 'Acompte', 100), dueRow('balance', 'Solde', 355.36)]);
const sansAcompte = () => screen.getByRole('switch', { name: 'Sans acompte' });

beforeEach(() => { vi.clearAllMocks(); });

test('an acompte collected by a link: « Sans acompte » is disabled and says why', async () => {
  const { ctx } = renderFinance({ form: { platform: 'direct', depositDisabled: 0 }, ledger: LEDGER, depositDisabledLockedReason: 'collected-by-link' });
  expect(sansAcompte()).toBeDisabled();
  expect(sansAcompte()).not.toBeChecked();
  expect(screen.getByText(CAPTION)).toBeInTheDocument();
  expect(sansAcompte()).toHaveAccessibleDescription(CAPTION);
  await userEvent.setup({ pointerEventsCheck: 0 }).click(sansAcompte());
  expect(ctx.updateForm).not.toHaveBeenCalled();
});

test('no reason: « Sans acompte » stays free, with no caption', () => {
  const { ctx } = renderFinance({ form: { platform: 'direct', depositDisabled: 0 }, ledger: LEDGER, depositDisabledLockedReason: null });
  expect(sansAcompte()).toBeEnabled();
  expect(screen.queryByText(CAPTION)).not.toBeInTheDocument();
  fireEvent.click(sansAcompte());
  expect(ctx.updateForm).toHaveBeenCalledWith(expect.objectContaining({ depositDisabled: true }));
});

// Rule 14 (audit R8 client N2) — the lock arrives on a fiche that already ticks « Sans acompte » (the acompte was
// paid by its link while the operator edited): the switch stays free to untick, never to tick again.
test('ticked when the lock arrives: « Sans acompte » can be unticked, with the reason under it', () => {
  const { ctx } = renderFinance({ form: { platform: 'direct', depositDisabled: 1 }, ledger: LEDGER, depositDisabledLockedReason: 'collected-by-link' });
  expect(sansAcompte()).toBeChecked();
  expect(sansAcompte()).toBeEnabled();
  expect(sansAcompte()).toHaveAccessibleDescription(CAPTION);
  fireEvent.click(sansAcompte());
  expect(ctx.updateForm).toHaveBeenCalledWith(expect.objectContaining({ depositDisabled: false }));
});
