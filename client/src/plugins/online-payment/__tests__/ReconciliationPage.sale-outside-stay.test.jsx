// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rules 1, 8, 13 — the reconciliation page with a sale outside a stay
// (`reservation.id` null, `saleKey` set): the row is drawn under the sale's label, « Ouvrir la fiche » is not offered, and
// « Écarter » names the sale by reservation id 0, the way the server keys its receipts.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

import DialogProvider from '../../../components/DialogProvider';
import ReconciliationPage from '../ReconciliationPage';
import { proposed, gap, COUNTS, BULK } from './reconciliationFixtures';

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

const SALE = { id: null, saleKey: 'resource-booking:41', saleLabel: 'Bain nordique du 05/11', hasClient: false, clientName: 'Bain nordique du 05/11', propertyName: '', platform: 'direct' };
const payload = (items) => ({
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  lastReadAt: '2026-11-10T08:00:00.000Z', lastError: null, startDate: '2026-10-01', counts: COUNTS, view: 'todo', items, credits: [], filter: null, bulk: BULK,
});
const renderPage = () => render(<MemoryRouter><DialogProvider><ReconciliationPage /></DialogProvider></MemoryRouter>);

beforeEach(() => { vi.clearAllMocks(); window.innerWidth = 1280; });

test('« Écarter » on the proposal of a sale outside a stay discards reservation id 0 and the row does not crash', async () => {
  const sale = proposed({
    key: '0|sale:resource-booking:41#immediat', ledgerKey: 'sale:resource-booking:41#immediat', reservation: SALE,
    proposal: { id: 'tx-1:0|sale:resource-booking:41#immediat', confidence: 'sur', confidenceLabel: 'sûr', reason: 'Versement Mollie', source: 'mollie',
      allocations: [{ reservationId: 0, ledgerKey: 'sale:resource-booking:41#immediat', amountCents: 1120 }], amountCents: 1120,
      // date-literal-ok: fixture data drawn as given; nothing compares it with today
      bank: { transactionId: 'tx-1', amountCents: 1120, date: '2026-11-10', dateLabel: '10/11', counterparty: 'Stichting Mollie Payments', reference: '', remainingCents: 1120 }, alsoCovers: [] },
  });
  api.getReconciliation.mockResolvedValue(payload([sale]));
  api.discardReconciliation.mockResolvedValue({ ok: true });
  renderPage();
  expect(await screen.findAllByText(/Bain nordique du 05\/11/)).not.toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: /Écarter|Ignorer/ }));
  await waitFor(() => expect(api.discardReconciliation).toHaveBeenCalledWith({
    transactionId: 'tx-1', reservationId: 0, ledgerKey: 'sale:resource-booking:41#immediat',
  }));
});

test('a gap on a sale outside a stay offers no « Ouvrir la fiche »; a stay\'s gap still does', async () => {
  const saleGap = gap({ key: '0|sale:x#retenue', reservation: SALE });
  api.getReconciliation.mockResolvedValue(payload([saleGap, gap({ key: '7|balance' })]));
  renderPage();
  await screen.findAllByText(/Bain nordique du 05\/11/);
  expect(screen.getAllByRole('button', { name: 'Ouvrir la fiche' })).toHaveLength(1);
});
