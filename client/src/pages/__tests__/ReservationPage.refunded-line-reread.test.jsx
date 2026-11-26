// specs/pricing/pricing-components.md rule 108 (loop t8 UI8-3) — the refund that gives a lowered paid line's money back (and its deletion) moves
// the server's refundedLoweredLines: the fiche re-reads them with the rest of the finance, so the toggle goes and comes back at once.
import React from 'react';
import { vi } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';

vi.setConfig({ testTimeout: 30000 });

const dialogs = { alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn() };

vi.mock('../../api', () => {
  const calls = {};
  const handler = {
    get(_t, name) {
      if (name === '__esModule') return false;
      if (!calls[name]) calls[name] = vi.fn(async () => ([]));
      return calls[name];
    },
  };
  return { __esModule: true, default: new Proxy({}, handler) };
});
vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => dialogs,
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, roles: ['admin'] } }),
  useAuth: () => ({ user: { id: 1, roles: ['admin'] } }),
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false, usePlugins: () => ({ plugins: [], isActive: () => false }) }));

import api from '../../api';
import { FICHE, SERVER_KEY, mockFiche, openFiche } from './refundedLineFixtures';

const REFUND = { id: 5, refundDate: '2099-11-14', method: 'transfer', totalTtc: 30, reason: '', lines: [] };
const REFUND_ROW = {
  key: 'refund-5', label: 'Remboursement', amount: -30, state: 'refunded', tone: 'info', stateLabel: 'Rendu le 14/11 · virement',
  amountEdit: { editable: false, mode: 'none' }, action: { kind: 'deleteRefund', label: 'Supprimer', refundId: 5, confirm: 'Supprimer ce remboursement ?' },
};

test('the refund made on the trop-perçu locks the line; deleting it gives the toggle back', async () => {
  mockFiche(api);
  let refunded = false;
  api.getReservation.mockImplementation(async () => (refunded
    ? { ...FICHE, refunds: [REFUND], ledger: { rows: [REFUND_ROW], closing: null, remaining: 0 }, refundedLoweredLines: [{ key: SERVER_KEY, table: 'custom', lineId: 3 }] }
    : { ...FICHE, refundedLoweredLines: [] }));
  api.createReservationRefund.mockImplementation(async () => { refunded = true; return { refunds: [REFUND], refundableLines: [], refundTotals: { book: 30, withCash: 30 }, collectedTtc: 230 }; });
  api.deleteReservationRefund.mockImplementation(async () => { refunded = false; return { refunds: [], refundableLines: [], refundTotals: { book: 0, withCash: 0 }, collectedTtc: 230 }; });
  const over = Object.assign(new Error('Trop-perçu'), {
    code: 'OVERPAID', status: 409, overpaymentTtc: 30, overpaymentMethod: null,
    overpaymentLines: [{ bucket: 'options', label: 'Prestations complémentaires', amountTtc: 30 }],
  });
  api.updateReservation.mockRejectedValueOnce(over).mockResolvedValue({});
  dialogs.confirm.mockResolvedValue(true);
  openFiche();
  expect(await screen.findByRole('button', { name: '✓ Offert' })).toBeInTheDocument();
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'x' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer le remboursement' }));
  await waitFor(() => expect(api.createReservationRefund).toHaveBeenCalled());
  expect(await screen.findByText('✓ Offert · remboursée')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '✓ Offert' })).toBeNull();

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(within(document.querySelector('[data-row="refund-5"]')).getByRole('button', { name: /Supprimer/ }));
  await waitFor(() => expect(api.deleteReservationRefund).toHaveBeenCalled());
  expect(await screen.findByRole('button', { name: '✓ Offert' })).toBeInTheDocument();
  expect(screen.queryByText('✓ Offert · remboursée')).toBeNull();
});
