// specs/plugins-phase-p-productisation.md rules 27–28 — the « Comptes » section of the Plan comptable:
// one field per role with its default as helper, a save sends the plan, the server's refusal shows
// under its field.
import { vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../../components/DialogProvider';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getPlatformAccounts: vi.fn(), savePlatformAccounts: vi.fn(), refreshPlatformAccounts: vi.fn() },
}));
vi.mock('../../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { roles: ['admin'] } }) }));

import api from '../../../api';
import PlatformAccountsPage from '../PlatformAccountsPage';

const GET = {
  defaultAccount: '622600', vatRateCommission: 20, cancellationCompensationAccount: '75880000', vatRateCancellationCompensation: 0,
  plan: [
    { key: 'accommodationAccount', value: '70600000', default: '70600000' },
    { key: 'journalCode', value: 'VT', default: 'VT' },
  ],
  platforms: [],
};

const renderPage = () => render(
  <MemoryRouter><DialogProvider><PlatformAccountsPage /></DialogProvider></MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  api.getPlatformAccounts.mockResolvedValue(GET);
});

test('each role is a field with its default as helper; a save sends the plan', async () => {
  const user = userEvent.setup();
  api.savePlatformAccounts.mockResolvedValue(GET);
  renderPage();
  const accommodation = await screen.findByLabelText('Hébergement');
  expect(accommodation).toHaveValue('70600000');
  expect(screen.getByText('Par défaut : VT')).toBeInTheDocument();
  await user.clear(accommodation);
  await user.type(accommodation, '706100');
  await user.clear(screen.getByLabelText('Code journal des ventes'));
  await user.type(screen.getByLabelText('Code journal des ventes'), 've');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.savePlatformAccounts).toHaveBeenCalled());
  expect(api.savePlatformAccounts.mock.calls[0][0].plan).toEqual({ accommodationAccount: '706100', journalCode: 'VE' });
});

test('an account refused by the server shows its message under the field', async () => {
  const user = userEvent.setup();
  api.savePlatformAccounts.mockRejectedValue(Object.assign(new Error('PLATFORM_ACCOUNTS_INVALID'), {
    errors: { plan: { accommodationAccount: 'De 3 à 12 chiffres.' } },
  }));
  renderPage();
  const accommodation = await screen.findByLabelText('Hébergement');
  await user.clear(accommodation);
  await user.type(accommodation, '70');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('De 3 à 12 chiffres.')).toBeInTheDocument();
});
