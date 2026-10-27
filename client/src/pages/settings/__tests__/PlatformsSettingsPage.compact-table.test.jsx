// 2026-10-27 spec review (specs/plugins-phase-p-productisation.md rule 48) — at 1280 px with the side
// menu open the table showed 1043 px of columns in a 926 px card, « Sans corvées » behind an invisible
// scroll. The table now shows from 1280 px with compact columns (the colour beside the name, short
// one-line headers); below, the cards.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
    { id: 1, name: 'direct', isDirect: true, countsAsDirect: true, color: '#c9a227', commissionPercent: 0, takesDeposit: null, touristTaxCollection: null, payoutDueDays: null, forbidsGuestChores: null },
    { id: 4, name: 'Airbnb', isDirect: false, countsAsDirect: false, color: '#FF5A5F', commissionPercent: 15.5, takesDeposit: false, touristTaxCollection: 'platform', payoutDueDays: 10, forbidsGuestChores: true },
  ] });
});
afterEach(() => { window.matchMedia = orig; });

test('1280 px: seven compact columns, the colour beside the name', async () => {
  window.matchMedia = mediaAtWidth(1280);
  render(<MemoryRouter><PlatformsSettingsPage /></MemoryRouter>);
  expect(await screen.findByLabelText('Sans corvées de départ Airbnb')).toBeInTheDocument();
  const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent);
  expect(headers).toEqual(['Plateforme', 'Commission %', 'Acompte', 'Taxe de séjour', 'Virement (j)', 'Vente directe', 'Sans corvées']);
  const airbnbRow = screen.getByText('Airbnb').closest('tr');
  expect(within(airbnbRow).getAllByRole('cell')).toHaveLength(7);
});

test('1200 px: cards, every setting still visible', async () => {
  window.matchMedia = mediaAtWidth(1200);
  render(<MemoryRouter><PlatformsSettingsPage /></MemoryRouter>);
  expect(await screen.findByLabelText('Sans corvées de départ Airbnb')).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByLabelText('Virement Airbnb')).toBeInTheDocument();
});
