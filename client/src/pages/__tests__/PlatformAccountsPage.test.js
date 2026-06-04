import { vi } from 'vitest';
/**
 * Vitest coverage for the dedicated `/comptabilite/plateformes` page (spec
 * accounting-platform-commission-and-no-deposit.md §3.7 + §7.3).
 *
 * Pins:
 *   - GET payload shapes the bottom table (defaults + per-platform rows with isDirect flag).
 *   - Direct row's inputs are disabled (rule 18); the "Pas de commission" caption is rendered.
 *   - Editing a per-platform compte commission + Switch fires updates; Save sends the
 *     normalized payload (account trimmed, hasVat boolean, Direct row excluded).
 *   - The "Rafraîchir la liste" button calls `api.refreshPlatformAccounts` and flashes a
 *     success snackbar with the +N count (rule 2 + §6).
 *   - The vatRateCommission caption shows the active rate; admin sees a clickable
 *     "modifiable dans Réglages" link, accountant sees plain italic text.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getPlatformAccounts: vi.fn(),
    savePlatformAccounts: vi.fn(),
    refreshPlatformAccounts: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: vi.fn(),
}));

import api from '../../api';
import { useAuth } from '../../hooks/useAuth';
import PlatformAccountsPage from '../PlatformAccountsPage';

function setAuth(user) {
  useAuth.mockReturnValue({ user });
}

const SAMPLE_GET = {
  defaultAccount: '622600',
  vatRateCommission: 20,
  platforms: [
    { id: 1, name: 'direct',         commissionAccountNumber: null,        hasVatOnCommission: false, isDirect: true },
    { id: 2, name: 'Airbnb',         commissionAccountNumber: null,        hasVatOnCommission: false, isDirect: false },
    { id: 3, name: 'Gitedefrance',   commissionAccountNumber: '62260500',  hasVatOnCommission: true,  isDirect: false },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/comptabilite/plateformes']}>
      <PlatformAccountsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getPlatformAccounts.mockResolvedValue(SAMPLE_GET);
  setAuth({ roles: ['admin'] });
});

test('renders the default account + every platform row from the GET payload', async () => {
  renderPage();
  await screen.findByText('Plan comptable plateformes');
  expect(screen.getByLabelText('Compte commission par défaut')).toHaveValue('622600');
  // Each platform name appears as a row label.
  expect(await screen.findByText('Airbnb')).toBeInTheDocument();
  expect(screen.getByText('Gitedefrance')).toBeInTheDocument();
  expect(screen.getByText('direct')).toBeInTheDocument();
});

test("Direct row is rendered with disabled inputs + the 'Pas de commission' caption", async () => {
  renderPage();
  // The aria-label of the TVA switch carries the platform name — that's the cheapest stable
  // way to locate the Direct row's Switch.
  const directSwitch = await screen.findByLabelText('TVA déductible commission direct');
  expect(directSwitch).toBeDisabled();
  expect(screen.getByText(/Pas de commission sur les réservations directes/i)).toBeInTheDocument();
});

test("vatRateCommission caption shows the rate; admin sees the 'modifiable' link", async () => {
  renderPage();
  // The rate is rendered inside a <strong>, the wrapping caption is the parent Typography.
  await screen.findByText('20 %');
  // Admin: the "modifiable" link is rendered as a clickable button.
  expect(screen.getByRole('button', { name: /modifiable dans Réglages → Général/i })).toBeInTheDocument();
});

test("accountant sees plain italic text instead of the 'modifiable' link", async () => {
  setAuth({ roles: ['accountant'] });
  renderPage();
  await screen.findByText('20 %');
  expect(screen.getByText(/modifiable par un administrateur/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /modifiable dans Réglages/i })).not.toBeInTheDocument();
});

test('saving forwards the normalized payload (Direct row excluded, hasVat as boolean)', async () => {
  const user = userEvent.setup();
  api.savePlatformAccounts.mockResolvedValue(SAMPLE_GET);
  renderPage();
  // Wait for the table to render.
  await screen.findByText('Airbnb');
  // Edit Airbnb's compte commission so the form becomes dirty. Both non-direct rows share
  // the same `622600 (défaut)` placeholder, so we scope by the row containing 'Airbnb'.
  const airbnbRow = screen.getByText('Airbnb').closest('tr');
  const airbnbAccount = within(airbnbRow).getByPlaceholderText('622600 (défaut)');
  await user.clear(airbnbAccount);
  await user.type(airbnbAccount, '62260300');
  // The header Save button is part of the PageActionBar — its tooltip is "Enregistrer".
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.savePlatformAccounts).toHaveBeenCalled());
  const payload = api.savePlatformAccounts.mock.calls[0][0];
  expect(payload.defaultAccount).toBe('622600');
  // Only non-direct platforms in the payload (rule 18).
  expect(payload.platforms.every((p) => p.id !== 1)).toBe(true);
  const airbnbInPayload = payload.platforms.find((p) => p.id === 2);
  expect(airbnbInPayload).toMatchObject({ id: 2, account: '62260300', hasVat: false });
});

test('"Rafraîchir la liste" button calls the API and flashes the +N snackbar', async () => {
  const user = userEvent.setup();
  api.refreshPlatformAccounts.mockResolvedValue({
    ...SAMPLE_GET,
    platforms: [
      ...SAMPLE_GET.platforms,
      { id: 4, name: 'Booking', commissionAccountNumber: null, hasVatOnCommission: false, isDirect: false },
    ],
    newCount: 1,
  });
  renderPage();
  await screen.findByText('Airbnb');
  await user.click(screen.getByRole('button', { name: /Rafraîchir la liste/i }));
  await waitFor(() => expect(api.refreshPlatformAccounts).toHaveBeenCalled());
  // Success snackbar shows the +N count message.
  expect(await screen.findByText(/\+1 nouvelle plateforme ramassée/i)).toBeInTheDocument();
  // The new platform appears in the table.
  expect(screen.getByText('Booking')).toBeInTheDocument();
});

test('"Rafraîchir la liste" with newCount=0 shows the up-to-date message', async () => {
  const user = userEvent.setup();
  api.refreshPlatformAccounts.mockResolvedValue({ ...SAMPLE_GET, newCount: 0 });
  renderPage();
  await screen.findByText('Airbnb');
  await user.click(screen.getByRole('button', { name: /Rafraîchir la liste/i }));
  await waitFor(() => expect(api.refreshPlatformAccounts).toHaveBeenCalled());
  expect(await screen.findByText(/Aucune nouvelle plateforme à ramasser/i)).toBeInTheDocument();
});

test('validation error from the server is surfaced under the bad row', async () => {
  const user = userEvent.setup();
  // Simulate a 400 from saveAll with a per-platform error.
  api.savePlatformAccounts.mockRejectedValue({
    body: {
      errors: {
        defaultAccount: null,
        platforms: [{ id: 2, account: 'Compte doit comporter 6 à 8 chiffres.' }],
      },
    },
  });
  renderPage();
  await screen.findByText('Airbnb');
  // Trigger a save with an invalid Airbnb account (scope by row).
  const airbnbRow = screen.getByText('Airbnb').closest('tr');
  const airbnbAccount = within(airbnbRow).getByPlaceholderText('622600 (défaut)');
  await user.clear(airbnbAccount);
  await user.type(airbnbAccount, '12');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Compte doit comporter 6 à 8 chiffres.')).toBeInTheDocument();
});
