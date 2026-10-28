// specs/platform-settings-relay-and-review.md rules 1-5 — « Adresse e-mail relais » and « Où laisser un
// avis » (FR / EN): per platform, sent with the save, refused fields shown in red; an own channel has none.
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
import { LIMITS } from './platformLimitsFixtures';

const base = { isDirect: false, countsAsDirect: false, forbidsGuestChores: false, color: '#123456', commissionPercent: 15, takesDeposit: false, touristTaxCollection: 'platform', payoutDueDays: 10 };
const PLATFORMS = [
  { ...base, id: 1, name: 'direct', isDirect: true, countsAsDirect: true, forbidsGuestChores: null, takesDeposit: null, touristTaxCollection: null, payoutDueDays: null, relaysGuestEmail: null, reviewWhereFr: null, reviewWhereEn: null },
  { ...base, id: 2, name: 'Airbnb', relaysGuestEmail: true, reviewWhereFr: 'Airbnb', reviewWhereEn: 'Airbnb' },
  { ...base, id: 3, name: 'Abritel', relaysGuestEmail: false, reviewWhereFr: '', reviewWhereEn: '' },
];

beforeEach(() => {
  api.getPlatformSettings.mockResolvedValue({ limits: LIMITS, platforms: PLATFORMS });
  api.savePlatformSettings.mockResolvedValue({ platforms: PLATFORMS });
});

test('the relay switch and the review wording are saved per platform; direct has neither', async () => {
  render(<MemoryRouter><PlatformsSettingsPage /></MemoryRouter>);
  expect(await screen.findByLabelText('Adresse e-mail relais Airbnb')).toBeChecked();
  expect(screen.queryByLabelText('Adresse e-mail relais Direct')).toBeNull();
  expect(screen.queryByLabelText('Où laisser un avis Direct')).toBeNull();
  fireEvent.click(screen.getByLabelText('Adresse e-mail relais Abritel'));
  fireEvent.change(screen.getByLabelText('Où laisser un avis Abritel'), { target: { value: 'votre espace Abritel' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.savePlatformSettings).toHaveBeenCalledWith([
    { id: 3, relaysGuestEmail: true, reviewWhereFr: 'votre espace Abritel' },
  ]));
});

test('a wording the server refuses is shown under its field', async () => {
  api.savePlatformSettings.mockRejectedValue({ errors: { 3: { reviewWhereEn: '80 caractères au plus.' } } });
  render(<MemoryRouter><PlatformsSettingsPage /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText('Où laisser un avis (anglais) Abritel'), { target: { value: 'x'.repeat(80) } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('80 caractères au plus.')).toBeInTheDocument();
});
