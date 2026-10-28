import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

import DialogProvider from '../../../components/DialogProvider';
import ReconciliationPage from '../ReconciliationPage';
import { proposed, done, gap, bankSide, COUNTS, BULK, credit, ficheCreditsPayload, previewPayload } from './reconciliationFixtures';

// specs/reconciliation-assisted-matching.md rules 11, 14, 19, 21, 24 — review of 2026-10-28: the page survives a
// closed dialog, « Actualiser » keeps the filter, the desktop table shows the same facts as the cards, an empty
// filter says so.

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getReconciliation: vi.fn(), readReconciliation: vi.fn(), confirmReconciliation: vi.fn(), confirmAllReconciliation: vi.fn(), linkReconciliationBatch: vi.fn(),
    previewReconciliationAllocation: vi.fn(), discardReconciliation: vi.fn(), undoReconciliation: vi.fn(), setReconciliationOutside: vi.fn(),
    getReconciliationCandidates: vi.fn(), listPlatformPenalties: vi.fn(), previewPlatformPenalty: vi.fn(),
  },
}));
import api from '../../../api';

const payload = (over = {}) => ({
  lastReadAt: '2026-10-23T08:00:00.000Z', lastError: null, startDate: '2026-10-01', counts: COUNTS, view: 'todo', filter: null,
  items: [], credits: [credit()], bulk: BULK, autoConfirmed: null, ...over,
});
const renderPage = (url = '/finance/rapprochement') => render(<MemoryRouter initialEntries={[url]}><DialogProvider><ReconciliationPage /></DialogProvider></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks(); window.innerWidth = 1280;
  api.getReconciliation.mockResolvedValue(payload());
  api.getReconciliationCandidates.mockResolvedValue({ likely: [], others: { total: 0, offset: 0, items: [] }, query: { tokens: [] } });
  api.previewReconciliationAllocation.mockResolvedValue(previewPayload());
});

test('rule 14 — cancelling the credit → fiches dialog, then reopening it, never crashes the page', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Rattacher à des fiches' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByText('Écarts')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Rattacher à des fiches' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
});

test('rule 14 — a successful link closes the dialog and the page keeps drawing', async () => {
  api.getReconciliationCandidates.mockResolvedValue({
    likely: [{ key: '7|balance', reservationId: 7, ledgerKey: 'balance', label: 'Solde', openCents: 21450, expectedCents: 21450, anchorDateLabel: 'avant le 18/10', reservation: { id: 7, clientName: 'Luca Rossi', propertyName: 'Estiva', platform: 'direct' } }],
    others: { total: 0, offset: 0, items: [] }, query: { tokens: [] },
  });
  api.linkReconciliationBatch.mockResolvedValue({ ok: true, marked: [], notWritten: [] });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Rattacher à des fiches' }));
  fireEvent.click((await screen.findAllByRole('checkbox'))[0]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Rattacher' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Rattacher' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByText('Écarts')).toBeTruthy();
});

test('rules 11, 41 — « Actualiser » keeps the filter it was read with', async () => {
  api.getReconciliation.mockResolvedValue(payload({ filter: 'gaps', items: [gap()] }));
  api.readReconciliation.mockResolvedValue(payload({ filter: 'gaps', items: [gap()] }));
  renderPage('/finance/rapprochement?filter=gaps');
  await screen.findByLabelText(/Filtre actif : Écarts/);
  fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
  await waitFor(() => expect(api.readReconciliation).toHaveBeenCalledWith('todo', 'gaps'));
});

test('rule 11 — an empty filter says what it means and offers the way out', async () => {
  api.getReconciliation.mockResolvedValue(payload({ filter: 'proposed', items: [], credits: [] }));
  renderPage('/finance/rapprochement?filter=proposed');
  expect(await screen.findByText('Plus rien à confirmer.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retirer le filtre' }));
  await waitFor(() => expect(api.getReconciliation).toHaveBeenLastCalledWith('todo', null));
});

test('rules 19, 21, 15 — the desktop table shows the « auto » badge, the stays a credit also covered and the credits of a split', async () => {
  const auto = done({ key: '7|balance', bank: [{ ...bankSide(), allocatedCents: 59658, auto: true, alsoCovers: [{ reservationId: 8, ledgerKey: 'balance', label: 'Versement Booking', clientName: 'Camille Lefevre' }] }] });
  const split = proposed({ key: '9|deposit', ledgerKey: 'deposit', label: 'Acompte' });
  split.proposal = { ...split.proposal, parts: [bankSide({ transactionId: 'a', dateLabel: '10/10', amountCents: 15000 }), bankSide({ transactionId: 'b', dateLabel: '12/10', amountCents: 15000 })], alsoCovers: [{ reservationId: 8, ledgerKey: 'balance', label: 'Versement Booking', clientName: 'Camille Lefevre' }] };
  api.getReconciliation.mockResolvedValue(payload({ items: [auto, split], credits: [] }));
  renderPage();
  const table = await screen.findByRole('table');
  expect(within(table).getByText('auto')).toBeTruthy();
  expect(within(table).getAllByText(/couvre aussi Camille Lefevre \(Versement Booking\)/)).toHaveLength(2);
  expect(within(table).getByText(/10\/10 · 150,00 €/)).toBeTruthy();
  expect(within(table).getByText(/12\/10 · 150,00 €/)).toBeTruthy();
  expect(within(table).getByText(/Versement groupé · couvre aussi/)).toBeTruthy();
});

test('rules 24, 34 — the penalty button of the table names the amount', async () => {
  api.getReconciliation.mockResolvedValue(payload({ items: [gap({ declarePenalty: { amountCents: 4000, amount: 40 } })], credits: [] }));
  renderPage();
  expect(await screen.findByRole('button', { name: /Déclarer une pénalité de 40,00 €/ })).toBeTruthy();
});

test('rules 21, 41 — the information line of the automatic confirmations can be closed', async () => {
  api.getReconciliation.mockResolvedValue(payload({ autoConfirmed: { count: 3, at: '2026-10-23T08:00:00.000Z' } }));
  renderPage();
  expect(await screen.findByText('3 rapprochements automatiques')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: "Fermer l'information" }));
  expect(screen.queryByText('3 rapprochements automatiques')).toBeNull();
});

test('rules 33, 46 — « Défaire » on an installment asks first, naming the payment link that stays closed', async () => {
  const item = done({ key: '9|installment-1', ledgerKey: 'installment-1', label: 'Échéance 1/2', undoWarning: 'Le lien de paiement de cette échéance reste annulé ; en envoyer un nouveau depuis la fiche.' });
  api.getReconciliation.mockResolvedValue(payload({ view: 'done', items: [item], credits: [] }));
  api.undoReconciliation.mockResolvedValue({ ok: true, restored: [], untouched: [] });
  renderPage('/finance/rapprochement');
  fireEvent.click(await screen.findByRole('tab', { name: /Rapprochés/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Défaire' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/reste annulé ; en envoyer un nouveau depuis la fiche/)).toBeTruthy();
  expect(api.undoReconciliation).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Défaire' }));
  await waitFor(() => expect(api.undoReconciliation).toHaveBeenCalledWith('tx-1'));
});

test('rules 33, 46 — without a warning « Défaire » acts at once', async () => {
  api.getReconciliation.mockResolvedValue(payload({ view: 'done', items: [done()], credits: [] }));
  api.undoReconciliation.mockResolvedValue({ ok: true, restored: [], untouched: [] });
  renderPage('/finance/rapprochement');
  fireEvent.click(await screen.findByRole('tab', { name: /Rapprochés/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Défaire' }));
  await waitFor(() => expect(api.undoReconciliation).toHaveBeenCalledWith('tx-1'));
  expect(screen.queryByRole('dialog')).toBeNull();
});
