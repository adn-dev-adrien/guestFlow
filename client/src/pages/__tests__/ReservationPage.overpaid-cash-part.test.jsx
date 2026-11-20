// specs/pricing-components.md rule 112 (loop t8 UI8-1) — « Enregistrer et rembourser » opens the refund dialog on the cash part the
// save's 409 named (`overpaymentCash`): « Caisse interne » on its lines, the rest announced, as from the ledger row.
import React from 'react';
import { vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

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
import { FICHE, mockFiche, openFiche } from './refundedLineFixtures';

test('the 409 OVERPAID cash part opens the dialog « Caisse interne » on 30 with the announcement', async () => {
  mockFiche(api);
  api.getReservation.mockResolvedValue(FICHE);
  const over = Object.assign(new Error('Trop-perçu'), {
    code: 'OVERPAID', status: 409, overpaymentTtc: 60, overpaymentMethod: null,
    overpaymentLines: [{ bucket: 'options', label: 'Prestations complémentaires', amountTtc: 60 }],
    overpaymentCash: { amountTtc: 30, restTtc: 30, lines: [{ bucket: 'options', label: 'Prestations complémentaires', amountTtc: 30 }] },
  });
  api.updateReservation.mockRejectedValueOnce(over).mockResolvedValue({});
  api.createReservationRefund.mockResolvedValue({ refunds: [], refundableLines: [], refundTotals: { book: 0, withCash: 0 }, collectedTtc: 0 });
  dialogs.confirm.mockResolvedValue(true);
  openFiche();
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'x' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByRole('radio', { name: /Caisse interne/ })).toBeChecked();
  expect(screen.getByText(/payés en espèces : rendus en caisse interne\. Reste 30,00\s€ à rembourser ensuite\./)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));
  await waitFor(() => expect(api.createReservationRefund).toHaveBeenCalled());
  const payload = api.createReservationRefund.mock.calls[0][1];
  expect(payload.method).toBe('internal');
  expect(payload.lines).toEqual([{ label: 'Trop-perçu', bucket: 'options', amountTtc: 30 }]);
});
