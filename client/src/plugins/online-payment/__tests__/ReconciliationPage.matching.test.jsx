import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

import DialogProvider from '../../../components/DialogProvider';
import ReconciliationPage from '../ReconciliationPage';
import { proposed, COUNTS, BULK, previewPayload } from './reconciliationFixtures';

// specs/reconciliation-assisted-matching.md rules 18, 21 — the page says how many matches confirmed themselves
// after the read and leads to them; a group that needs typed shares opens the shares dialog.

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getReconciliation: vi.fn(), readReconciliation: vi.fn(), confirmReconciliation: vi.fn(), confirmAllReconciliation: vi.fn(), linkReconciliationBatch: vi.fn(),
    previewReconciliationAllocation: vi.fn(), discardReconciliation: vi.fn(), undoReconciliation: vi.fn(), setReconciliationOutside: vi.fn(), getReconciliationCandidates: vi.fn(),
  },
}));
import api from '../../../api';

const group = proposed();
group.proposal = {
  ...group.proposal, needsShares: true, confidence: 'verifier', confidenceLabel: 'à vérifier', reason: 'Versement groupé de 2 séjours · montants estimés',
  pairs: [{ transactionId: 'tx-1', reservationId: 7, ledgerKey: 'balance', amountCents: 40000 }, { transactionId: 'tx-1', reservationId: 8, ledgerKey: 'balance', amountCents: 19658 }],
  alsoCovers: [{ reservationId: 8, ledgerKey: 'balance', label: 'Versement Booking', clientName: 'Camille Lefevre' }],
};
const payload = (over = {}) => ({
  lastReadAt: '2026-10-23T08:00:00.000Z', lastError: null, startDate: '2026-10-01', counts: COUNTS, view: 'todo', filter: null,
  items: [group], credits: [], bulk: BULK, autoConfirmed: { count: 12, at: '2026-10-23T08:00:00.000Z' }, ...over,
});
const renderPage = () => render(<MemoryRouter><DialogProvider><ReconciliationPage /></DialogProvider></MemoryRouter>);

beforeEach(() => { vi.clearAllMocks(); window.innerWidth = 1280; api.getReconciliation.mockResolvedValue(payload()); });

test('rule 21 — « 12 rapprochements automatiques » leads to the reconciled rows', async () => {
  renderPage();
  expect(await screen.findByText('12 rapprochements automatiques')).toBeTruthy();
  api.getReconciliation.mockResolvedValue(payload({ view: 'done', filter: 'reconciled', items: [] }));
  fireEvent.click(screen.getByRole('button', { name: 'Voir' }));
  await waitFor(() => expect(api.getReconciliation).toHaveBeenLastCalledWith('done', 'auto'));
});

test('rule 21 — no line when nothing was confirmed automatically', async () => {
  api.getReconciliation.mockResolvedValue(payload({ autoConfirmed: { count: 0, at: '2026-10-23T08:00:00.000Z' } }));
  renderPage();
  await screen.findByText('Écarts');
  expect(screen.queryByText(/automatique/)).toBeNull();
});

test('rule 18 — « Répartir et confirmer » opens the shares dialog and sends the proposal id with the shares', async () => {
  api.previewReconciliationAllocation.mockResolvedValue(previewPayload());
  api.linkReconciliationBatch.mockResolvedValue({ ok: true, marked: [], notWritten: [] });
  renderPage();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Répartir et confirmer' }))[0]);
  expect(await screen.findByLabelText('Camille Lefevre · Versement Booking (€)')).toBeTruthy();
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Répartir et confirmer' }).some((b) => !b.disabled && b.closest('[role="dialog"]'))).toBe(true));
  const submit = screen.getAllByRole('button', { name: 'Répartir et confirmer' }).find((b) => b.closest('[role="dialog"]'));
  fireEvent.click(submit);
  await waitFor(() => expect(api.linkReconciliationBatch).toHaveBeenCalledWith({
    pairs: group.proposal.pairs.map((p) => ({ ...p })), proposalId: group.proposal.id,
  }));
});
