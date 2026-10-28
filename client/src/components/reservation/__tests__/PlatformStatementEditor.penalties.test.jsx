/**
 * specs/reconciliation-assisted-matching.md rules 24, 27, 30 — the « Paiement plateforme » editor lists the
 * stay's penalties, declares one and deletes one; nothing offered on an unsaved fiche.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import DialogProvider from '../../DialogProvider';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { listPlatformPenalties: vi.fn(), removePlatformPenalty: vi.fn(), previewPlatformPenalty: vi.fn(), declarePlatformPenalty: vi.fn() },
}));
import api from '../../../api';
import PlatformStatementEditor from '../PlatformStatementEditor';

const FORM = { platformGrossAmount: 800, platformTouristTaxAmount: '', acompteCommissionAmount: '', platformCommissionAmount: 189.98, platformPayoutAmount: 610.02 };
const LINE = { id: 3, amount: 40, reason: 'Frais de relogement', date: '2026-06-12', dateLabel: '12/06', payoutAdjusted: false };
const renderEditor = (props = {}) => render(
  <DialogProvider>
    <PlatformStatementEditor
      form={FORM} pricingQuote={{}} withDepositCommission={false} locked={false} onApply={vi.fn()} onCancel={vi.fn()} computeCommission={vi.fn()}
      reservationId={7} canDeclarePenalty onPenaltiesChanged={vi.fn()} {...props}
    />
  </DialogProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  api.listPlatformPenalties.mockResolvedValue({ items: [LINE], total: 40, canDeclare: true, suggestions: [] });
  api.previewPlatformPenalty.mockResolvedValue({ valid: false, needsChoice: true, warnings: [], errors: [], before: {}, after: {} });
});

test('rule 27 — each penalty is one line: motif, amount, date', async () => {
  renderEditor();
  expect(await screen.findByText(/Pénalité · Frais de relogement · −40,00 € · 12\/06/)).toBeTruthy();
});

test('rule 30 — deleting asks first, then removes and tells the fiche to reload', async () => {
  api.removePlatformPenalty.mockResolvedValue({ ok: true, payoutRestored: true });
  const onPenaltiesChanged = vi.fn();
  renderEditor({ onPenaltiesChanged });
  fireEvent.click(await screen.findByRole('button', { name: 'Supprimer la pénalité' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
  await waitFor(() => expect(api.removePlatformPenalty).toHaveBeenCalledWith(7, 3));
  await waitFor(() => expect(onPenaltiesChanged).toHaveBeenCalled());
});

test('rule 24 — « Déclarer une pénalité » opens the dialog from the fiche', async () => {
  renderEditor();
  fireEvent.click(await screen.findByRole('button', { name: 'Déclarer une pénalité' }));
  expect(await screen.findByText('Pénalité plateforme')).toBeTruthy();
});

test('rule 24 — an unsaved or unsaved-changes fiche offers no declaration', async () => {
  renderEditor({ canDeclarePenalty: false });
  await screen.findByText(/Frais de relogement/);
  expect(screen.queryByRole('button', { name: 'Déclarer une pénalité' })).toBeNull();
});

test('no stored stay: no penalty section at all', () => {
  renderEditor({ reservationId: null });
  expect(api.listPlatformPenalties).not.toHaveBeenCalled();
  expect(screen.queryByText(/Pénalité/)).toBeNull();
});
