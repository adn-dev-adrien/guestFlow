import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import LinkTransactionDialog from '../LinkTransactionDialog';
import { ficheCredit, ficheCreditsPayload, previewPayload } from './reconciliationFixtures';

// specs/reconciliation-assisted-matching.md rules 1–8 — the fiche's « Rattacher des virements »: the server's
// groups, search and preview are drawn as they come; nothing is summed on the client.

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getReconciliationFicheCredits: vi.fn(), previewReconciliationAllocation: vi.fn() },
}));
import api from '../../../api';

const renderDialog = (props = {}) => render(<LinkTransactionDialog open onClose={vi.fn()} onSubmit={vi.fn()} reservationId={7} {...props} />);

beforeEach(() => {
  vi.clearAllMocks();
  window.innerWidth = 1280;
  api.getReconciliationFicheCredits.mockResolvedValue(ficheCreditsPayload());
  api.previewReconciliationAllocation.mockResolvedValue(previewPayload());
});

test('rules 2–3 — plausible credits first with their reasons, the others folded under a counted title', async () => {
  renderDialog();
  expect(await screen.findByText('Correspondances probables')).toBeTruthy();
  expect(screen.getByText('montant exact')).toBeTruthy();
  expect(screen.getByText('Tous les virements disponibles (1)')).toBeTruthy();
  expect(screen.getByText('M. OU MME ROSSI · « ACOMPTE »')).toBeTruthy();
});

test('rule 1 — a partly used credit says what remains; a credit proposed elsewhere is flagged', async () => {
  api.getReconciliationFicheCredits.mockResolvedValue(ficheCreditsPayload({
    likely: [ficheCredit({ partlyUsedLabel: 'reste 120,00 € sur 450,00 €', proposedElsewhere: true })],
  }));
  renderDialog();
  expect(await screen.findByText('reste 120,00 € sur 450,00 €')).toBeTruthy();
  expect(screen.getByText('proposé ailleurs')).toBeTruthy();
});

test('rule 4 — typing in the search asks the server, which filters both groups', async () => {
  renderDialog();
  await screen.findByText('Correspondances probables');
  fireEvent.change(screen.getByLabelText(/Nom, date/), { target: { value: '12/03' } });
  await waitFor(() => expect(api.getReconciliationFicheCredits).toHaveBeenCalledWith(7, { q: '12/03' }));
});

test('rule 4 — no match: the search is worded and can be cleared', async () => {
  renderDialog();
  await screen.findByText('Correspondances probables');
  api.getReconciliationFicheCredits.mockResolvedValue(ficheCreditsPayload({ likely: [], others: { total: 0, offset: 0, items: [] } }));
  fireEvent.change(screen.getByLabelText(/Nom, date/), { target: { value: 'zzz' } });
  expect(await screen.findByText(/Aucun virement ne correspond à « zzz »/)).toBeTruthy();
  api.getReconciliationFicheCredits.mockResolvedValue(ficheCreditsPayload());
  fireEvent.click(screen.getByRole('button', { name: 'Effacer la recherche' }));
  expect(await screen.findByText('Correspondances probables')).toBeTruthy();
});

test('rule 5 — ticking a credit asks the server\'s preview and the footer shows its words', async () => {
  renderDialog();
  fireEvent.click((await screen.findAllByRole('checkbox'))[0]);
  await waitFor(() => expect(api.previewReconciliationAllocation).toHaveBeenCalledWith({ reservationId: 7, transactionIds: ['tx-1'] }));
  expect(await screen.findByText('1 virement · 300,00 €')).toBeTruthy();
  expect(screen.getByText('Acompte · couvert')).toBeTruthy();
});

test('rule 6 — a leftover is worded under the list', async () => {
  api.previewReconciliationAllocation.mockResolvedValue(previewPayload({
    leftover: [{ transactionId: 'tx-1', cents: 5000, dateLabel: '12/03', message: '50,00 € restent disponibles sur le virement du 12/03' }],
  }));
  renderDialog();
  fireEvent.click((await screen.findAllByRole('checkbox'))[0]);
  expect(await screen.findByText('50,00 € restent disponibles sur le virement du 12/03')).toBeTruthy();
});

test('rule 7 — « Rattacher » stays disabled while the preview is refused, and the refusal is shown', async () => {
  api.previewReconciliationAllocation.mockResolvedValue(previewPayload({
    valid: false, errors: [{ code: 'ALLOCATION_EXCEEDS_TRANSACTION', field: 'credit.tx-1', message: 'Le virement du 12/03 n\'a plus que 300,00 € à répartir.' }],
  }));
  renderDialog();
  fireEvent.click((await screen.findAllByRole('checkbox'))[0]);
  expect(await screen.findByText(/n'a plus que 300,00 €/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Rattacher' }).disabled).toBe(true);
});

test('rules 7–8 — « Modifier la répartition » re-previews the typed amounts; « Rattacher » sends the previewed pairs', async () => {
  const onSubmit = vi.fn();
  renderDialog({ onSubmit });
  fireEvent.click((await screen.findAllByRole('checkbox'))[0]);
  await screen.findByText('1 virement · 300,00 €');
  fireEvent.click(screen.getByRole('button', { name: 'Modifier la répartition' }));
  const field = await screen.findByLabelText(/→ Acompte \(€\)/);
  api.previewReconciliationAllocation.mockResolvedValue(previewPayload({ pairs: [{ transactionId: 'tx-1', reservationId: 7, ledgerKey: 'deposit', amountCents: 12050 }] }));
  fireEvent.change(field, { target: { value: '120,50' } });
  await waitFor(() => expect(api.previewReconciliationAllocation).toHaveBeenCalledWith({
    pairs: [{ transactionId: 'tx-1', reservationId: 7, ledgerKey: 'deposit', amountCents: 12050 }],
  }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Rattacher' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Rattacher' }));
  expect(onSubmit).toHaveBeenCalledWith([{ transactionId: 'tx-1', reservationId: 7, ledgerKey: 'deposit', amountCents: 12050 }]);
});

test('rule 7 — a typed amount that is not an amount is refused inline, with no request', async () => {
  renderDialog();
  fireEvent.click((await screen.findAllByRole('checkbox'))[0]);
  await screen.findByText('1 virement · 300,00 €');
  fireEvent.click(screen.getByRole('button', { name: 'Modifier la répartition' }));
  api.previewReconciliationAllocation.mockClear();
  fireEvent.change(await screen.findByLabelText(/→ Acompte \(€\)/), { target: { value: '12,345' } });
  expect(await screen.findByText(/deux décimales au plus/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Rattacher' }).disabled).toBe(true);
  expect(api.previewReconciliationAllocation).not.toHaveBeenCalled();
});

test('empty account: the dialog says so and offers no submit', async () => {
  api.getReconciliationFicheCredits.mockResolvedValue(ficheCreditsPayload({ likely: [], others: { total: 0, offset: 0, items: [] } }));
  renderDialog();
  expect(await screen.findByText(/Aucun virement disponible/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Rattacher' }).disabled).toBe(true);
});
