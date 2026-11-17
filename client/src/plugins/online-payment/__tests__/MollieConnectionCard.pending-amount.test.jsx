// specs/mollie-rolling-reserve-and-incoming-payments.md rule 14 — the card shows what Mollie still holds: the `pendingAmount`
// of the primary balance (the reserves not released yet), read by the server; without a read the line is absent.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import DialogProvider from '../../../components/DialogProvider';
import MollieConnectionCard from '../MollieConnectionCard';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getPluginSettings: vi.fn(), savePluginSettings: vi.fn(), testMollieConnection: vi.fn() },
}));
import api from '../../../api';

const renderCard = () => render(<DialogProvider><MollieConnectionCard /></DialogProvider>);
const BASE = { mollieAccessTokenSet: true, mollieProfileId: 'pfl_abc', mollieLastRead: '', mollieLastError: '' };

test('the pending amount of the Mollie balance is shown as what is still held', async () => {
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  api.getPluginSettings.mockResolvedValue({ ...BASE, mollieBalance: JSON.stringify({ at: '2026-11-16T08:00:00.000Z', pendingCents: 14928, availableCents: 0 }) });
  renderCard();
  expect(await screen.findByTestId('mollie-pending')).toHaveTextContent(/Encore chez Mollie : 149,28\s*€ \(réserves non libérées\)/);
});

test('without a balance read, no pending line is drawn', async () => {
  api.getPluginSettings.mockResolvedValue({ ...BASE, mollieBalance: '' });
  renderCard();
  await screen.findByText('Compte Mollie');
  expect(screen.queryByTestId('mollie-pending')).not.toBeInTheDocument();
});
