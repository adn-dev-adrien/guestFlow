// specs/server-test-isolation.md rule 11 — a « nothing shown » check first waits for the answer that could show it.
/**
 * specs/reconciliation-assisted-matching.md rules 24–26, 29 — the penalty dialog: amount, motif, date, the
 * before / after choice only when the server needs it, the server's figures and refusals, nothing computed here.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DialogProvider from '../../DialogProvider';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { listPlatformPenalties: vi.fn(), previewPlatformPenalty: vi.fn(), declarePlatformPenalty: vi.fn() },
}));
import api from '../../../api';
import PlatformPenaltyDialog from '../PlatformPenaltyDialog';

const FIGURES = { before: { payout: 570.02, commission: 229.98, netReceived: 570.02 }, after: { payout: 610.02, commission: 189.98, netReceived: 570.02 } };
const preview = (over = {}) => ({ valid: true, needsChoice: false, warnings: [], errors: [], ...FIGURES, ...over });
const renderDialog = (props = {}) => render(
  <DialogProvider><PlatformPenaltyDialog open onClose={vi.fn()} reservationId={7} source="fiche" onDone={vi.fn()} {...props} /></DialogProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  api.listPlatformPenalties.mockResolvedValue({ items: [], suggestions: ['Frais de relogement', 'Non-conformité'] });
  api.previewPlatformPenalty.mockResolvedValue(preview());
});

test('rule 24 — opened from a reconciliation gap, the amount is prefilled and the choice is not asked', async () => {
  renderDialog({ source: 'reconciliation', initialAmount: 40 });
  expect(screen.getByLabelText('Montant (€)').value).toBe('40');
  await waitFor(() => expect(api.previewPlatformPenalty).toHaveBeenCalled());
  expect(await screen.findByText(/^Commission /)).toBeInTheDocument();
  expect(screen.queryByText(/le montant du relevé/)).toBeNull();
});

test('rule 25 — the before / after choice shows only when the server asks, with the server\'s figures', async () => {
  api.previewPlatformPenalty.mockResolvedValue(preview({ valid: false, needsChoice: true, errors: [{ code: 'INVALID_PENALTY', field: 'payoutIncludesPenalty', message: 'Indiquer…' }] }));
  renderDialog({ initialAmount: 40 });
  expect(await screen.findByText('le montant du relevé, avant pénalité')).toBeTruthy();
  expect(screen.getByText('le montant reçu sur le compte, pénalité déjà déduite')).toBeTruthy();
  expect(screen.getByText(/Commission 229,98 € → 189,98 €/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Enregistrer' }).disabled).toBe(true);
});

test('rule 25 — choosing « reçu sur le compte » re-previews with payoutIncludesPenalty', async () => {
  api.previewPlatformPenalty.mockResolvedValue(preview({ needsChoice: true }));
  renderDialog({ initialAmount: 40 });
  fireEvent.click(await screen.findByLabelText('le montant reçu sur le compte, pénalité déjà déduite'));
  await waitFor(() => expect(api.previewPlatformPenalty).toHaveBeenLastCalledWith(7, expect.objectContaining({ payoutIncludesPenalty: true, source: 'fiche' })));
});

test('rule 26 — a refusal of the server is worded under its field and keeps the button disabled', async () => {
  api.previewPlatformPenalty.mockResolvedValue(preview({ valid: false, errors: [{ code: 'PENALTY_EXCEEDS_PAYOUT', field: 'amount', message: 'Les pénalités dépassent le versement de la plateforme (610,02 €).' }] }));
  renderDialog({ source: 'reconciliation', initialAmount: 900 });
  expect(await screen.findByText(/dépassent le versement/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Enregistrer' }).disabled).toBe(true);
});

test('rule 29 — the warning about an already transmitted month is shown before saving', async () => {
  api.previewPlatformPenalty.mockResolvedValue(preview({ warnings: ['L’écriture de juin change : si juin est déjà transmis, prévenir le comptable.'] }));
  renderDialog({ source: 'reconciliation', initialAmount: 40 });
  expect(await screen.findByText(/L’écriture de juin change/)).toBeTruthy();
});

test('rule 24 — motif suggestions come from the server; « Enregistrer » sends the typed body and reports', async () => {
  api.declarePlatformPenalty.mockResolvedValue({ item: { id: 1 } });
  const onDone = vi.fn();
  const onClose = vi.fn();
  renderDialog({ source: 'reconciliation', initialAmount: 40, onDone, onClose });
  const reason = screen.getByLabelText('Motif');
  fireEvent.mouseDown(reason);
  expect(await screen.findByText('Frais de relogement')).toBeTruthy();
  fireEvent.change(reason, { target: { value: 'Frais de relogement' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.declarePlatformPenalty).toHaveBeenCalledWith(7, expect.objectContaining({ amount: 40, reason: 'Frais de relogement', source: 'reconciliation' })));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(onClose).toHaveBeenCalled();
});

test('rule 25 — the choice stays on screen once made, even when the server no longer asks', async () => {
  api.previewPlatformPenalty.mockResolvedValueOnce(preview({ needsChoice: true }));
  api.previewPlatformPenalty.mockResolvedValue(preview({ needsChoice: false }));
  renderDialog({ initialAmount: 40 });
  fireEvent.click(await screen.findByLabelText('le montant reçu sur le compte, pénalité déjà déduite'));
  await waitFor(() => expect(api.previewPlatformPenalty).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText('le montant reçu sur le compte, pénalité déjà déduite').checked).toBe(true);
});

test('rule 26 — nothing is asked before an amount is typed, and a bad amount is worded without a request', async () => {
  renderDialog({ source: 'reconciliation' });
  await waitFor(() => expect(api.listPlatformPenalties).toHaveBeenCalled());
  expect(api.previewPlatformPenalty).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Montant (€)'), { target: { value: 'abc' } });
  expect(await screen.findByText(/Montant invalide/)).toBeTruthy();
  expect(api.previewPlatformPenalty).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Enregistrer' }).disabled).toBe(true);
});
