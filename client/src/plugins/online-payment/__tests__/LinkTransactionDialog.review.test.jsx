import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import LinkTransactionDialog from '../LinkTransactionDialog';
import { ficheCredit, ficheCreditsPayload, previewPayload } from './reconciliationFixtures';

// specs/reconciliation-assisted-matching.md rules 1, 7, 8, 14 — review of 2026-10-28: a closed credit dialog never
// crashes, a list or preview failure is worded with a retry, a manual split names its transfers and shows a
// refusal under the right field, a credit proposed to the fiche is named as such.

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getReconciliationFicheCredits: vi.fn(), getReconciliationCandidates: vi.fn(), previewReconciliationAllocation: vi.fn() },
}));
import api from '../../../api';

beforeEach(() => {
  vi.clearAllMocks(); window.innerWidth = 1280;
  api.getReconciliationFicheCredits.mockResolvedValue(ficheCreditsPayload());
  api.previewReconciliationAllocation.mockResolvedValue(previewPayload());
});

test('rule 14 — a dialog switched from a credit to nothing (closed) renders without a receipts list', async () => {
  api.getReconciliationCandidates.mockResolvedValue({ likely: [], others: { total: 0, offset: 0, items: [] }, query: { tokens: [] } });
  const credit = { transactionId: 'tx-9', remainingCents: 70000, dateLabel: '20/10', counterparty: 'ACME' };
  const { rerender } = render(<LinkTransactionDialog open onClose={vi.fn()} onSubmit={vi.fn()} credit={credit} />);
  await screen.findByText(/Aucune échéance à rattacher/);
  expect(() => rerender(<LinkTransactionDialog open={false} onClose={vi.fn()} onSubmit={vi.fn()} credit={null} />)).not.toThrow();
});

test('rule 1 — a list failure is worded with a retry instead of an endless spinner', async () => {
  api.getReconciliationFicheCredits.mockRejectedValueOnce(Object.assign(new Error('Cette réservation est hors du périmètre du rapprochement.'), { code: 'RESERVATION_OUT_OF_SCOPE' }));
  render(<LinkTransactionDialog open onClose={vi.fn()} onSubmit={vi.fn()} reservationId={7} />);
  expect(await screen.findByText(/hors du périmètre/)).toBeTruthy();
  api.getReconciliationFicheCredits.mockResolvedValue(ficheCreditsPayload());
  fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
  expect(await screen.findByText('Correspondances probables')).toBeTruthy();
});

test('rule 5 — a preview failure replaces the stale footer and offers a retry', async () => {
  render(<LinkTransactionDialog open onClose={vi.fn()} onSubmit={vi.fn()} reservationId={7} />);
  fireEvent.click((await screen.findAllByRole('checkbox'))[0]);
  await screen.findByText('1 virement · 300,00 €');
  api.previewReconciliationAllocation.mockRejectedValue(new Error('Serveur indisponible'));
  fireEvent.click((await screen.findAllByRole('checkbox'))[1]);
  expect(await screen.findByText(/Serveur indisponible/)).toBeTruthy();
  expect(screen.queryByText('1 virement · 300,00 €')).toBeNull();
  expect(screen.getByRole('button', { name: 'Rattacher' }).disabled).toBe(true);
});

test('rule 7 — a split field names its transfer and the refusal of its credit shows under it, not only in the footer', async () => {
  render(<LinkTransactionDialog open onClose={vi.fn()} onSubmit={vi.fn()} reservationId={7} />);
  fireEvent.click((await screen.findAllByRole('checkbox'))[0]);
  await screen.findByText('1 virement · 300,00 €');
  fireEvent.click(screen.getByRole('button', { name: 'Modifier la répartition' }));
  const field = await screen.findByLabelText(/12\/03 · 300,00 € → Acompte \(€\)/);
  api.previewReconciliationAllocation.mockResolvedValue(previewPayload({
    valid: false, errors: [{ code: 'ALLOCATION_EXCEEDS_TRANSACTION', field: 'credit.tx-1', message: 'Le virement du 12/03 n\'a plus que 300,00 € à répartir.' }],
  }));
  fireEvent.change(field, { target: { value: '400' } });
  const message = await screen.findByText(/n'a plus que 300,00 €/);
  expect(message.closest('.MuiFormControl-root')).toBeTruthy();
});

test('rules 2, 39 — a credit the matcher proposes to this fiche says so', async () => {
  api.getReconciliationFicheCredits.mockResolvedValue(ficheCreditsPayload({ likely: [ficheCredit({ reasons: ['proposal'] })] }));
  render(<LinkTransactionDialog open onClose={vi.fn()} onSubmit={vi.fn()} reservationId={7} />);
  expect(await screen.findByText('proposé pour cette fiche')).toBeTruthy();
});
