// specs/platform-settings-relay-and-review.md rule 14 (2026-10-27 spec review) — the property's
// « Plateformes » tab names each platform the way Paramètres › Plateformes does (the server's display
// name), never by its stored key (« GitesDeFrance », « BookingCom », « direct »).
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { setPlatformDisplayNames } from '../../../constants/platforms';

vi.mock('../../IcalExportCard', () => ({ default: () => null }));
vi.mock('../../DialogProvider', () => {
  const toast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => toast };
});
vi.mock('../../../api', () => ({
  default: {
    getPropertyPlatforms: vi.fn(), getPlatformSettings: vi.fn(), createPropertyIcalSource: vi.fn(),
    updatePropertyIcalSource: vi.fn(), deletePropertyIcalSource: vi.fn(), syncPropertyIcalSource: vi.fn(),
    syncAllPropertyIcalSources: vi.fn(), setPlatformColor: vi.fn(),
  },
}));

import api from '../../../api';
import PropertyPlatformsTab from '../PropertyPlatformsTab';

test('stored keys are shown under their display names', async () => {
  setPlatformDisplayNames({ GitesDeFrance: 'Gîtes de France', BookingCom: 'Booking.com' });
  api.getPlatformSettings.mockResolvedValue({ platforms: [] });
  api.getPropertyPlatforms.mockResolvedValue({ platforms: [
    { platformKey: 'direct', platformLabel: 'direct', isDirect: true, isDirectChannel: true, isBuiltIn: true, url: '', disabled: false, sourceId: null },
    { platformKey: 'gitesdefrance', platformLabel: 'GitesDeFrance', isDirect: false, isBuiltIn: true, url: '', disabled: false, sourceId: null },
    { platformKey: 'bookingcom', platformLabel: 'BookingCom', isDirect: false, isBuiltIn: true, url: '', disabled: false, sourceId: null },
  ] });
  render(<MemoryRouter><PropertyPlatformsTab propertyId={5} propertyName="Le Moulin" canManage /></MemoryRouter>);

  expect(within(await screen.findByTestId('platform-row-gitesdefrance')).getByText('Gîtes de France')).toBeInTheDocument();
  expect(within(screen.getByTestId('platform-row-bookingcom')).getByText('Booking.com')).toBeInTheDocument();
  expect(within(screen.getByTestId('platform-row-direct')).getByText('Direct')).toBeInTheDocument();
  expect(screen.queryByText('GitesDeFrance')).toBeNull();
  expect(screen.queryByText('BookingCom')).toBeNull();
});
