import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { vi } from 'vitest';

import DialogProvider from '../../../components/DialogProvider';
import ReconciliationPage from '../ReconciliationPage';
import { proposed, gap, COUNTS, BULK, credit } from './reconciliationFixtures';

// specs/reconciliation-assisted-matching.md rules 11–13 — a counter is a filter kept in the URL, with a
// chip and Échap to leave it; « Tout confirmer » appears when the view holds proposals.

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getReconciliation: vi.fn(), readReconciliation: vi.fn(), confirmReconciliation: vi.fn(), confirmAllReconciliation: vi.fn(),
    discardReconciliation: vi.fn(), undoReconciliation: vi.fn(), setReconciliationOutside: vi.fn(), getReconciliationCandidates: vi.fn(),
  },
}));
import api from '../../../api';

const payload = (over = {}) => ({
  lastReadAt: '2026-10-23T08:00:00.000Z', lastError: null, startDate: '2026-10-01', counts: COUNTS, view: 'todo', filter: null,
  items: [gap(), proposed({ key: '8|balance', reservation: { id: 8, clientName: 'Camille Lefevre', propertyName: 'Gîte', platform: 'direct' } })],
  credits: [credit()], bulk: BULK, ...over,
});
function Where() { const l = useLocation(); return <span data-testid="where">{l.search}</span>; }
const renderPage = (url = '/finance/rapprochement') => render(
  <MemoryRouter initialEntries={[url]}><DialogProvider><ReconciliationPage /><Where /></DialogProvider></MemoryRouter>,
);

beforeEach(() => { vi.clearAllMocks(); window.innerWidth = 1280; api.getReconciliation.mockResolvedValue(payload()); });

test('rule 11 — clicking a counter asks the server for that set, presses it and shows the chip', async () => {
  renderPage();
  const counter = await screen.findByRole('button', { name: /Écarts/ });
  expect(counter.getAttribute('aria-pressed')).toBe('false');
  api.getReconciliation.mockResolvedValue(payload({ filter: 'gaps', items: [gap()], credits: [] }));
  fireEvent.click(counter);
  await waitFor(() => expect(api.getReconciliation).toHaveBeenLastCalledWith('todo', 'gaps'));
  await waitFor(() => expect(screen.getByRole('button', { name: /Écarts/, pressed: true })).toBeTruthy());
  expect(screen.getByLabelText('Filtre actif : Écarts · 1')).toBeTruthy();
  expect(screen.getByTestId('where').textContent).toBe('?filter=gaps');
});

test('rule 11 — a second click on the active counter leaves the filter', async () => {
  renderPage('/finance/rapprochement?filter=gaps');
  const counter = await screen.findByRole('button', { name: /Écarts/, pressed: true });
  api.getReconciliation.mockResolvedValue(payload());
  fireEvent.click(counter);
  await waitFor(() => expect(api.getReconciliation).toHaveBeenLastCalledWith('todo', null));
  expect(screen.queryByLabelText('Filtre actif : Écarts · 1')).toBeNull();
  expect(screen.getByTestId('where').textContent).toBe('');
});

test('rule 11 — the chip\'s close button and Échap leave the filter', async () => {
  renderPage('/finance/rapprochement?filter=proposed');
  await screen.findByLabelText('Filtre actif : À confirmer · 1');
  fireEvent.click(screen.getByTestId('CancelIcon'));
  await waitFor(() => expect(screen.queryByLabelText('Filtre actif : À confirmer · 1')).toBeNull());
  fireEvent.click(await screen.findByRole('button', { name: /À confirmer/ }));
  await screen.findByLabelText('Filtre actif : À confirmer · 1');
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByLabelText('Filtre actif : À confirmer · 1')).toBeNull());
});

test('rule 11 — the filter lives in the URL: a reload with it asks the server for it; the tab bar clears it', async () => {
  renderPage('/finance/rapprochement?filter=reconciled');
  await waitFor(() => expect(api.getReconciliation).toHaveBeenCalledWith('done', 'reconciled'));
  api.getReconciliation.mockResolvedValue(payload());
  fireEvent.click(await screen.findByRole('tab', { name: /À traiter/ }));
  await waitFor(() => expect(api.getReconciliation).toHaveBeenLastCalledWith('todo', null));
  expect(screen.getByTestId('where').textContent).toBe('');
});

test('rules 12–13 — « Tout confirmer » shows with proposals, opens the summary and confirms the shown ids', async () => {
  api.confirmAllReconciliation.mockResolvedValue({ confirmed: [{ proposalId: 'tx-1:7|balance', keys: ['7|balance'] }], skipped: [], totalCents: 59658 });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Tout confirmer' }));
  expect(await screen.findByText(/1 rapprochement · 596,58 €/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer 1' }));
  await waitFor(() => expect(api.confirmAllReconciliation).toHaveBeenCalledWith({ proposalIds: ['tx-1:7|balance'], amounts: { 'tx-1:7|balance': 59658 } }));
  expect(await screen.findByText('1 rapprochement confirmé')).toBeTruthy();
});

test('rule 12 — no proposal in the view: no « Tout confirmer »', async () => {
  api.getReconciliation.mockResolvedValue(payload({ bulk: { ...BULK, proposalIds: [], count: 0, totalCents: 0 } }));
  renderPage();
  await screen.findByRole('button', { name: /Écarts/ });
  expect(screen.queryByRole('button', { name: 'Tout confirmer' })).toBeNull();
});

test('rule 13 — a skipped proposal is worded in the toast', async () => {
  api.confirmAllReconciliation.mockResolvedValue({ confirmed: [], skipped: [{ proposalId: 'x', reason: 'changed', message: 'a changé' }], totalCents: 0 });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Tout confirmer' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirmer 1' }));
  expect(await screen.findByText('0 confirmé · 1 non confirmé — voir la liste')).toBeTruthy();
});
