/**
 * PlatformsSettingsPage — every per-platform commercial setting in one place
 * (specs/settings-rationalization.md rule 17).
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getPlatformSettings: vi.fn(), savePlatformSettings: vi.fn() },
}));

vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast };
});

import api from '../../../api';
import PlatformsSettingsPage, { __test } from '../PlatformsSettingsPage';

const PLATFORMS = [
  { id: 1, name: 'direct', isDirect: true, color: '#c9a227', commissionPercent: 5, takesDeposit: null, touristTaxCollection: null, payoutDueDays: null },
  { id: 3, name: 'Airbnb', isDirect: false, color: '#FF5A5F', commissionPercent: 15.5, takesDeposit: false, touristTaxCollection: 'platform', payoutDueDays: 10 },
  { id: 4, name: 'Lodgify', isDirect: false, color: '#fec700', commissionPercent: 5, takesDeposit: true, touristTaxCollection: 'owner', payoutDueDays: null },
];

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.getPlatformSettings.mockResolvedValue({ platforms: PLATFORMS });
  api.savePlatformSettings.mockResolvedValue({ platforms: PLATFORMS });
});

const renderPage = () => render(<MemoryRouter><PlatformsSettingsPage /></MemoryRouter>);

test('changedRows sends only the fields that changed, per row that changed', () => {
  const saved = __test.toDraft(PLATFORMS);
  const draft = saved.map((p) => (p.id === 3 ? { ...p, commissionPercent: '16' } : p));
  expect(__test.changedRows(draft, saved)).toEqual([{ id: 3, commissionPercent: '16' }]);
  expect(__test.changedRows(saved, saved)).toEqual([]);
});

test('a value that does not apply to a channel is shown as « — », not as a field', async () => {
  renderPage();
  expect(await screen.findByLabelText('Commission Airbnb')).toHaveValue('15.5');
  expect(screen.getByLabelText('Virement Airbnb')).toHaveValue('10');
  expect(screen.queryByLabelText('Virement Lodgify')).toBeNull();
  expect(screen.queryByLabelText('Acompte Direct')).toBeNull();
  expect(screen.getAllByText('—').length).toBeGreaterThan(0);
});

test('a save sends the change; a refused field shows its message', async () => {
  api.savePlatformSettings.mockRejectedValueOnce(Object.assign(new Error('PLATFORMS_INVALID'), {
    errors: { 3: { commissionPercent: 'Entre 0 et 99,99 %.' } },
  }));
  renderPage();
  fireEvent.change(await screen.findByLabelText('Commission Airbnb'), { target: { value: '120' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  await waitFor(() => expect(api.savePlatformSettings).toHaveBeenCalledWith([{ id: 3, commissionPercent: '120' }]));
  expect(await screen.findByText('Entre 0 et 99,99 %.')).toBeInTheDocument();
});
