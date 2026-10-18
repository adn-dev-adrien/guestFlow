// specs/plugins-phase-p-productisation.md rule 35 — at a tablet width (900 px, side menu open) the
// platforms are cards, so « Taxe de séjour », « Virement » and « Vente directe » are never hidden.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { mediaAtWidth } from '../../__tests__/tabletWidthMedia';

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

let orig;
beforeEach(() => {
  orig = window.matchMedia;
  api.getPlatformSettings.mockResolvedValue({ platforms: [
    { id: 1, name: 'direct', isDirect: true, countsAsDirect: true, color: '#c9a227', commissionPercent: 0, takesDeposit: null, touristTaxCollection: null, payoutDueDays: null },
    { id: 4, name: 'Lodgify', isDirect: false, countsAsDirect: false, color: '#fec700', commissionPercent: 5, takesDeposit: true, touristTaxCollection: 'owner', payoutDueDays: 7 },
  ] });
});
afterEach(() => { window.matchMedia = orig; });

test('900 px: cards, no table; 1280 px: the table', async () => {
  window.matchMedia = mediaAtWidth(900);
  const { unmount } = render(<MemoryRouter><PlatformsSettingsPage /></MemoryRouter>);
  expect(await screen.findByLabelText('Compté comme vente directe Lodgify')).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  unmount();
  window.matchMedia = mediaAtWidth(1280);
  render(<MemoryRouter><PlatformsSettingsPage /></MemoryRouter>);
  expect(await screen.findByLabelText('Compté comme vente directe Lodgify')).toBeInTheDocument();
  expect(screen.getByRole('table')).toBeInTheDocument();
});
