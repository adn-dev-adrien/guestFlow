// specs/plugins-phase-p-productisation.md rule 19 — « Compté comme vente directe »: locked on for
// `direct`, a switch for the others, sent with the save.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getPlatformSettings: vi.fn(), savePlatformSettings: vi.fn() },
}));
vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast };
});

import api from '../../../api';
import PlatformsSettingsPage from '../PlatformsSettingsPage';

const PLATFORMS = [
  { id: 1, name: 'direct', isDirect: true, countsAsDirect: true, color: '#c9a227', commissionPercent: 0, takesDeposit: null, touristTaxCollection: null, payoutDueDays: null },
  { id: 4, name: 'Lodgify', isDirect: false, countsAsDirect: false, color: '#fec700', commissionPercent: 5, takesDeposit: true, touristTaxCollection: 'owner', payoutDueDays: 7 },
];

beforeEach(() => {
  api.getPlatformSettings.mockResolvedValue({ platforms: PLATFORMS });
  api.savePlatformSettings.mockResolvedValue({ platforms: PLATFORMS });
});

test('direct is locked on; another platform is switched on and saved', async () => {
  render(<MemoryRouter><PlatformsSettingsPage /></MemoryRouter>);
  const direct = await screen.findByLabelText('Compté comme vente directe Direct');
  expect(direct).toBeChecked();
  expect(direct).toBeDisabled();
  const lodgify = screen.getByLabelText('Compté comme vente directe Lodgify');
  expect(lodgify).not.toBeChecked();
  fireEvent.click(lodgify);
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.savePlatformSettings).toHaveBeenCalledWith([{ id: 4, countsAsDirect: true }]));
});
