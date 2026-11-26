import { vi } from 'vitest';
/**
 * specs/settings/settings-rationalization.md rule 14 — the VAT rate on commissions is edited by the admin; the
 * accountant reads it (read-only field, « Réservé à l'administrateur ») and never sends it.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../../components/DialogProvider';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getPlatformAccounts: vi.fn(), savePlatformAccounts: vi.fn(), refreshPlatformAccounts: vi.fn() },
}));
vi.mock('../../../hooks/useAuth', () => ({ __esModule: true, useAuth: vi.fn() }));

import api from '../../../api';
import { useAuth } from '../../../hooks/useAuth';
import PlatformAccountsPage from '../PlatformAccountsPage';

const SAMPLE = {
  defaultAccount: '622600',
  vatRateCommission: 20,
  cancellationCompensationAccount: '75880000',
  vatRateCancellationCompensation: 0,
  platforms: [{ id: 2, name: 'Airbnb', commissionAccountNumber: null, hasVatOnCommission: false, isDirect: false }],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/comptabilite/plateformes']}>
      <DialogProvider><PlatformAccountsPage /></DialogProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getPlatformAccounts.mockResolvedValue(SAMPLE);
  api.savePlatformAccounts.mockResolvedValue(SAMPLE);
});

test('the accountant reads the commission VAT rate: read-only, with its helper', async () => {
  useAuth.mockReturnValue({ user: { roles: ['accountant'] } });
  renderPage();
  const field = await screen.findByLabelText(/TVA déductible sur commissions/i);
  expect(field).toHaveValue('20');
  expect(field).toHaveAttribute('readonly');
  expect(screen.getByText('Réservé à l\'administrateur')).toBeInTheDocument();
});

test('an accountant saving the accounts does not send the commission VAT rate', async () => {
  const user = userEvent.setup();
  useAuth.mockReturnValue({ user: { roles: ['accountant'] } });
  renderPage();
  await user.type(await screen.findByLabelText('Commission par défaut'), '1');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.savePlatformAccounts).toHaveBeenCalled());
  expect(api.savePlatformAccounts.mock.calls[0][0]).not.toHaveProperty('vatRateCommission');
});

test('the admin edits the commission VAT rate', async () => {
  useAuth.mockReturnValue({ user: { roles: ['admin'] } });
  renderPage();
  const field = await screen.findByLabelText(/TVA déductible sur commissions/i);
  expect(field).not.toHaveAttribute('readonly');
  expect(screen.queryByText('Réservé à l\'administrateur')).not.toBeInTheDocument();
});
