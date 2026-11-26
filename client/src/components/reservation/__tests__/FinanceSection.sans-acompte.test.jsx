// specs/payments/disable-deposit-per-reservation.md rules 4 and 8 — the « Sans acompte » switch sits in the
// « Paiements » section of the fiche, is free by default and flips the form's flag; with the acompte off, the
// ledger's acompte row reads what the server says (« Sans objet · acompte désactivé »), the solde row the rest.
import { screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { renderFinance, dueRow, naRow, ledgerOf } from './ledgerFixtures';

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const sansAcompte = () => screen.getByRole('switch', { name: 'Sans acompte' });

beforeEach(() => { vi.clearAllMocks(); });

test('rule 4: the switch is in the fiche, off by default, and ticking it updates the form', () => {
  const ledger = ledgerOf([dueRow('deposit', 'Acompte', 100), dueRow('balance', 'Solde', 355.36)]);
  const { ctx } = renderFinance({ form: { platform: 'direct', depositDisabled: 0 }, ledger });
  expect(sansAcompte()).toBeEnabled();
  expect(sansAcompte()).not.toBeChecked();
  fireEvent.click(sansAcompte());
  expect(ctx.updateForm).toHaveBeenCalledWith(expect.objectContaining({ depositDisabled: true }));
});

test('rule 8: acompte off — the acompte row says « Sans objet · acompte désactivé », the solde carries the total, the switch stays to flip back', () => {
  const ledger = ledgerOf([naRow('deposit', 'Acompte', 'Sans objet · acompte désactivé'), dueRow('balance', 'Solde', 455.36)]);
  const { ctx } = renderFinance({ form: { platform: 'direct', depositDisabled: 1 }, ledger });
  expect(screen.getByText('Sans objet · acompte désactivé')).toBeInTheDocument();
  expect(screen.getByText('Solde')).toBeInTheDocument();
  expect(sansAcompte()).toBeChecked();
  fireEvent.click(sansAcompte());
  expect(ctx.updateForm).toHaveBeenCalledWith(expect.objectContaining({ depositDisabled: false }));
});
