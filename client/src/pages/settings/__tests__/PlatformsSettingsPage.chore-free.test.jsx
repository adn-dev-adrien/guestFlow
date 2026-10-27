// specs/airbnb-no-checkout-chores.md rule 8 — « Sans corvées de départ »: a switch per platform, sent with
// the save; an own channel has none.
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
  { id: 1, name: 'direct', isDirect: true, countsAsDirect: true, forbidsGuestChores: null, color: '#c9a227', commissionPercent: 0, takesDeposit: null, touristTaxCollection: null, payoutDueDays: null },
  { id: 2, name: 'Airbnb', isDirect: false, countsAsDirect: false, forbidsGuestChores: true, color: '#ff5a5f', commissionPercent: 15.5, takesDeposit: false, touristTaxCollection: 'platform', payoutDueDays: 2 },
  { id: 3, name: 'Booking', isDirect: false, countsAsDirect: false, forbidsGuestChores: false, color: '#003580', commissionPercent: 16.44, takesDeposit: false, touristTaxCollection: 'platform_reversed', payoutDueDays: 30 },
];

beforeEach(() => {
  api.getPlatformSettings.mockResolvedValue({ platforms: PLATFORMS });
  api.savePlatformSettings.mockResolvedValue({ platforms: PLATFORMS });
});

test('the ticked platform reads ticked, another one is ticked and saved, direct has no switch', async () => {
  render(<MemoryRouter><PlatformsSettingsPage /></MemoryRouter>);
  expect(await screen.findByLabelText('Sans corvées de départ Airbnb')).toBeChecked();
  expect(screen.queryByLabelText('Sans corvées de départ Direct')).toBeNull();
  const booking = screen.getByLabelText('Sans corvées de départ Booking');
  expect(booking).not.toBeChecked();
  fireEvent.click(booking);
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.savePlatformSettings).toHaveBeenCalledWith([{ id: 3, forbidsGuestChores: true }]));
});
