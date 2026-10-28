import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import DialogProvider from '../../../components/DialogProvider';
import ReconciliationSettingsCard from '../ReconciliationSettingsCard';

// specs/reconciliation-assisted-matching.md rule 20 — the switch « Confirmer automatiquement les
// correspondances sûres », on by default, saved with the other reconciliation settings.

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getPluginSettings: vi.fn(), savePluginSettings: vi.fn(), getReconciliationBankAccounts: vi.fn() },
}));
import api from '../../../api';

const renderCard = () => render(<DialogProvider><ReconciliationSettingsCard connected /></DialogProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  api.getReconciliationBankAccounts.mockResolvedValue([]);
  api.savePluginSettings.mockResolvedValue({});
});

test('on by default: an empty setting shows the switch on', async () => {
  api.getPluginSettings.mockResolvedValue({});
  renderCard();
  expect((await screen.findByRole('switch', { name: /Confirmer automatiquement/ })).checked).toBe(true);
});

test('off when the setting is « 0 »; turning it back on saves « 1 »', async () => {
  api.getPluginSettings.mockResolvedValue({ reconciliationAutoConfirm: '0' });
  renderCard();
  const sw = await screen.findByRole('switch', { name: /Confirmer automatiquement/ });
  expect(sw.checked).toBe(false);
  fireEvent.click(sw);
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.savePluginSettings).toHaveBeenCalledWith('online-payment', expect.objectContaining({ reconciliationAutoConfirm: '1' })));
});

test('turning it off saves « 0 »', async () => {
  api.getPluginSettings.mockResolvedValue({ reconciliationAutoConfirm: '1' });
  renderCard();
  fireEvent.click(await screen.findByRole('switch', { name: /Confirmer automatiquement/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.savePluginSettings).toHaveBeenCalledWith('online-payment', expect.objectContaining({ reconciliationAutoConfirm: '0' })));
});
