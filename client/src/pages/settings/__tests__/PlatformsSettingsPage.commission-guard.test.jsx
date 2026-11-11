// specs/settings-input-guards.md rules 28-29 — the commission and payout fields of Paramètres › Plateformes.
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { LIMITS } from './platformLimitsFixtures';

vi.mock('../../../api', () => ({
  default: { getPlatformSettings: vi.fn(), savePlatformSettings: vi.fn() },
}));
vi.mock('../../../components/DialogProvider', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }));
vi.mock('../../../plugins/sdk/Slot', () => ({ default: () => null }));

import api from '../../../api';
import PlatformsSettingsPage from '../PlatformsSettingsPage';

const PLATFORMS = [
  { id: 3, name: 'Airbnb', isDirect: false, countsAsDirect: false, forbidsGuestChores: false, color: '#FF5A5F', commissionPercent: 15.5, takesDeposit: false, touristTaxCollection: 'platform', payoutDueDays: 10, relaysGuestEmail: false, reviewWhereFr: '', reviewWhereEn: '' },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getPlatformSettings.mockResolvedValue({ limits: LIMITS, platforms: PLATFORMS });
});

const open = async () => {
  render(<MemoryRouter><PlatformsSettingsPage /></MemoryRouter>);
  return screen.findByLabelText('Commission Airbnb');
};
const edit = (input, text) => {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
};

test('rule 28: a minus typed in a commission is stripped', async () => {
  const input = await open();
  edit(input, '-5');
  expect(input).toHaveValue('5');
});

test('rule 28: a non-number brings the previous rate back on blur, and the page stays clean', async () => {
  const input = await open();
  edit(input, 'abc');
  fireEvent.blur(input);
  expect(input).toHaveValue('15,5');
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

test('rule 28: 120 is refused in red and the rate is sent as typed', async () => {
  const input = await open();
  edit(input, '120');
  fireEvent.blur(input);
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Entre 0 et 99,99 %.')).toBeInTheDocument();
  api.savePlatformSettings.mockResolvedValue({ platforms: PLATFORMS });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  expect(api.savePlatformSettings).toHaveBeenCalledWith([{ id: 3, commissionPercent: 120 }]);
});

test('rule 29: the payout days behave the same way, with the server\'s message', async () => {
  await open();
  const payout = screen.getByLabelText('Virement Airbnb');
  edit(payout, '-4');
  expect(payout).toHaveValue('4');
  edit(payout, '400');
  fireEvent.blur(payout);
  expect(screen.getByText('Un nombre entier de jours (0 à 365).')).toBeInTheDocument();
});
