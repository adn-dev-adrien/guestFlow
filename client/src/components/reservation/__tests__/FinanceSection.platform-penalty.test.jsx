// specs/reconciliation-assisted-matching.md rules 24, 27, 30 (review 2026-10-28) — the platform payout row of the
// ledger carries « Déclarer une pénalité » and its penalty lines with a delete, even when the amounts are frozen
// (a past locked fiche), and refuses while the fiche has unsaved edits.
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { renderFinance, paidRow, ledgerOf } from './ledgerFixtures';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    markPayment: vi.fn(), computePlatformCommission: vi.fn(), listPlatformPenalties: vi.fn().mockResolvedValue({ items: [], suggestions: [] }),
    previewPlatformPenalty: vi.fn().mockResolvedValue({ valid: false, needsChoice: false, warnings: [], errors: [], before: {}, after: {} }),
    removePlatformPenalty: vi.fn(),
  },
}));
import api from '../../../api';

const frozen = (extra = {}) => paidRow('balance', 'Versement Booking', 600, {
  amountEdit: { editable: false, mode: 'locked', min: null, max: null, reason: 'Versement reçu le 12/10 : annuler la réception pour corriger les montants.' },
  penaltyAction: { label: 'Déclarer une pénalité' }, ...extra,
});
const rowEl = (key) => document.querySelector(`[data-row="${key}"]`);

beforeEach(() => { vi.clearAllMocks(); });

test('rules 24, 40 — on a frozen payout row, « Déclarer une pénalité » opens the dialog without the statement editor', async () => {
  renderFinance({ editingReservationId: 7, fichePristine: true, ledger: ledgerOf([frozen()]) });
  fireEvent.click(within(rowEl('balance')).getByRole('button', { name: 'Déclarer une pénalité' }));
  expect(await screen.findByText('Pénalité plateforme')).toBeTruthy();
});

test('rule 24 — unsaved edits disable the declaration with the reason', () => {
  renderFinance({ editingReservationId: 7, fichePristine: false, ledger: ledgerOf([frozen()]) });
  expect(within(rowEl('balance')).getByRole('button', { name: 'Déclarer une pénalité' }).disabled).toBe(true);
});

test('rules 27, 30, 40 — each penalty line shows its text and can be deleted after a confirmation; the fiche re-reads', async () => {
  api.removePlatformPenalty.mockResolvedValue({ ok: true, payoutRestored: true });
  const { ctx } = renderFinance({
    editingReservationId: 7, fichePristine: true,
    ledger: ledgerOf([frozen({ detail: { penalties: [{ id: 3, label: 'Pénalité plateforme −40,00 € · Frais de relogement' }] } })]),
  });
  expect(within(rowEl('balance')).getByText(/Pénalité plateforme −40,00 € · Frais de relogement/)).toBeTruthy();
  fireEvent.click(within(rowEl('balance')).getByRole('button', { name: 'Supprimer la pénalité' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
  await waitFor(() => expect(api.removePlatformPenalty).toHaveBeenCalledWith(7, 3));
  await waitFor(() => expect(ctx.reloadReservationFinance).toHaveBeenCalled());
});

test('rule 24 — a row without the server\'s penalty action (direct stay) shows none', () => {
  renderFinance({ editingReservationId: 7, fichePristine: true, ledger: ledgerOf([paidRow('balance', 'Solde', 600)]) });
  expect(screen.queryByRole('button', { name: 'Déclarer une pénalité' })).toBeNull();
});
