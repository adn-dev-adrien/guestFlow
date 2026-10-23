import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

import DialogProvider from '../../../components/DialogProvider';
import ReconciliationPage from '../ReconciliationPage';
import { proposed, gap, done, COUNTS, credit } from './reconciliationFixtures';

// specs/qonto-bank-reconciliation.md rule 28, §6 — the Suivi financier page: counters, tabs read from the
// server per view, confirm / discard on a row, credits no fiche claims, the disconnected state.

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => ({ ...(await importOriginal()), useNavigate: () => navigate }));
vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getReconciliation: vi.fn(), readReconciliation: vi.fn(), confirmReconciliation: vi.fn(), discardReconciliation: vi.fn(),
    undoReconciliation: vi.fn(), setReconciliationOutside: vi.fn(), getReconciliationCandidates: vi.fn(),
  },
}));
import api from '../../../api';

const payload = (over = {}) => ({
  lastReadAt: '2026-10-23T08:00:00.000Z', lastError: null, startDate: '2026-10-01', counts: COUNTS, view: 'todo',
  items: [gap(), proposed({ key: '8|balance', reservation: { id: 8, clientName: 'Camille Lefevre', propertyName: 'Gîte', platform: 'direct' } })],
  credits: [credit()], ...over,
});
const renderPage = () => render(<MemoryRouter><DialogProvider><ReconciliationPage /></DialogProvider></MemoryRouter>);

beforeEach(() => { vi.clearAllMocks(); window.innerWidth = 1280; });

test('draws counters, the tabs with their counts and the server rows', async () => {
  api.getReconciliation.mockResolvedValue(payload());
  renderPage();
  expect(await screen.findByText('Écart de montant')).toBeTruthy();
  expect(screen.getByText('Écarts')).toBeTruthy();
  expect(screen.getByRole('tab', { name: /À traiter 3/ })).toBeTruthy();
  expect(screen.getByText('Camille Lefevre')).toBeTruthy();
  expect(screen.getByText('Non rattaché')).toBeTruthy();
  expect(api.getReconciliation).toHaveBeenCalledWith('todo');
});

test('a tab asks the server for its view', async () => {
  api.getReconciliation.mockResolvedValue(payload());
  renderPage();
  await screen.findByText('Écart de montant');
  api.getReconciliation.mockResolvedValue(payload({ view: 'done', items: [done()], credits: [] }));
  fireEvent.click(screen.getByRole('tab', { name: /Rapprochés/ }));
  await waitFor(() => expect(api.getReconciliation).toHaveBeenCalledWith('done'));
  expect(await screen.findByText('Rapproché')).toBeTruthy();
});

test('Confirmer on a row posts its allocations and reloads the view', async () => {
  api.getReconciliation.mockResolvedValue(payload());
  api.confirmReconciliation.mockResolvedValue({ ok: true, marked: [] });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirmer' }));
  await waitFor(() => expect(api.confirmReconciliation).toHaveBeenCalledWith({
    transactionId: 'tx-1', allocations: [{ reservationId: 7, ledgerKey: 'balance', amountCents: 59658 }],
  }));
  await waitFor(() => expect(api.getReconciliation.mock.calls.length).toBeGreaterThan(1));
});

test('« Actualiser » reads the account and shows the failure in words', async () => {
  api.getReconciliation.mockResolvedValue(payload());
  api.readReconciliation.mockResolvedValue(payload({ lastError: { at: '2026-10-23T09:00:00.000Z', message: 'Qonto indisponible' } }));
  renderPage();
  await screen.findByText('Écart de montant');
  fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
  expect(await screen.findByText(/Lecture du compte impossible.*Qonto indisponible/)).toBeTruthy();
  expect(api.readReconciliation).toHaveBeenCalledWith('todo');
});

test('credits no fiche claims: « Hors réservation » marks the credit', async () => {
  api.getReconciliation.mockResolvedValue(payload({ view: 'other', items: [], credits: [credit({ status: 'other', kind: 'other' })] }));
  api.setReconciliationOutside.mockResolvedValue({ ok: true });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Hors réservation' }));
  await waitFor(() => expect(api.setReconciliationOutside).toHaveBeenCalledWith('tx-9', true));
});

test('empty view and the disconnected state', async () => {
  api.getReconciliation.mockResolvedValue(payload({ items: [], credits: [], counts: { ...COUNTS, todo: 0, gaps: 0, proposed: 0, unmatched: 0 } }));
  const { unmount } = renderPage();
  expect(await screen.findByText(/Rien à traiter/)).toBeTruthy();
  unmount();
  api.getReconciliation.mockRejectedValue(Object.assign(new Error('Qonto n\'est pas connecté.'), { code: 'QONTO_NOT_CONNECTED' }));
  renderPage();
  expect(await screen.findByText('Qonto n\'est pas connecté')).toBeTruthy();
});
