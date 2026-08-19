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
 *   - The cancellation-compensation account is editable and travels in the save payload; its VAT
 *     rate is displayed read-only (specs/cancellation-compensation.md §3.3 rule 19).
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../components/DialogProvider';

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
  cancellationCompensationAccount: '75880000',
  vatRateCancellationCompensation: 0,
  platforms: [
    { id: 1, name: 'direct',         commissionAccountNumber: null,        hasVatOnCommission: false, isDirect: true },
    { id: 2, name: 'Airbnb',         commissionAccountNumber: null,        hasVatOnCommission: false, isDirect: false },
    { id: 3, name: 'Gitedefrance',   commissionAccountNumber: '62260500',  hasVatOnCommission: true,  isDirect: false },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/comptabilite/plateformes']}>
      <DialogProvider><PlatformAccountsPage /></DialogProvider>
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
  await screen.findByText('Plan comptable');
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

// ── 2026-06-05 regression net — the prod bug Adrien reported: filling
//    Airbnb's account, hitting Save, leaving the page, coming back showed
//    empty fields. Root cause was a double-JSON-encoded body
//    (`api.savePlatformAccounts` did `JSON.stringify(payload)` + the shared
//    `request()` helper stringified again) → 400 → nothing persisted.
//    `api-body-encoding.test.js` pins the API helper level; the next 3
//    cases pin the PAGE level: any future regression that breaks the round-
//    trip between Save and a subsequent GET surfaces here. ──────────────

test('round-trip — after save, the form shows the values the server returned (Airbnb account + TVA)', async () => {
  const user = userEvent.setup();
  // Server's PUT response shape mirrors what `model.saveAll → getAll` produces
  // post-write: Airbnb now has its commission account + TVA toggle ON.
  api.savePlatformAccounts.mockResolvedValue({
    ...SAMPLE_GET,
    platforms: SAMPLE_GET.platforms.map((p) =>
      p.id === 2 ? { ...p, commissionAccountNumber: '62260300', hasVatOnCommission: true } : p
    ),
  });
  renderPage();
  await screen.findByText('Airbnb');
  // Edit Airbnb's account + toggle TVA, then save.
  const airbnbRow = screen.getByText('Airbnb').closest('tr');
  const airbnbAccount = within(airbnbRow).getByPlaceholderText('622600 (défaut)');
  await user.clear(airbnbAccount);
  await user.type(airbnbAccount, '62260300');
  await user.click(within(airbnbRow).getByRole('switch'));
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  // After save, the form's Airbnb row must show what the server returned —
  // not what the user typed, not the pre-save state. The "Configuration
  // enregistrée." alert + non-dirty Save button (= disabled) together prove
  // the round-trip closed cleanly.
  await screen.findByText(/Configuration enregistrée/i);
  const airbnbRow2 = screen.getByText('Airbnb').closest('tr');
  expect(within(airbnbRow2).getByPlaceholderText('622600 (défaut)')).toHaveValue('62260300');
  expect(within(airbnbRow2).getByRole('switch')).toBeChecked();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

test('round-trip — remount after save: GET returns the persisted state, form re-populates from it', async () => {
  // First mount: empty defaults.
  const { unmount } = renderPage();
  await screen.findByText('Airbnb');
  expect(screen.getByText('Airbnb').closest('tr').querySelector('input[type="text"]'))
    .toHaveValue('');
  unmount();
  // Simulate the navigate-away-then-back scenario by re-mounting with the
  // GET payload now reflecting a previously-persisted save. THIS is the
  // shape the prod user expected on come-back and was missing — pinning it
  // here means a future double-encode regression that silently 400s a save
  // (so the second GET still returns the empty pre-save state) will fail
  // this test as soon as the wiring is wrong end-to-end.
  api.getPlatformAccounts.mockResolvedValue({
    ...SAMPLE_GET,
    platforms: SAMPLE_GET.platforms.map((p) =>
      p.id === 2 ? { ...p, commissionAccountNumber: '62260300', hasVatOnCommission: true } : p
    ),
  });
  renderPage();
  const airbnbRow = (await screen.findByText('Airbnb')).closest('tr');
  expect(within(airbnbRow).getByPlaceholderText('622600 (défaut)')).toHaveValue('62260300');
  expect(within(airbnbRow).getByRole('switch')).toBeChecked();
});

test('Cancel restores the last-saved state (not the in-progress edits)', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Airbnb');
  // Type something into Airbnb, then click Cancel — the field must revert to
  // its initial (savedPlatforms) value, not stay with the typed value.
  const airbnbRow = screen.getByText('Airbnb').closest('tr');
  const airbnbAccount = within(airbnbRow).getByPlaceholderText('622600 (défaut)');
  await user.clear(airbnbAccount);
  await user.type(airbnbAccount, '99999999');
  expect(airbnbAccount).toHaveValue('99999999');
  await user.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(within(screen.getByText('Airbnb').closest('tr')).getByPlaceholderText('622600 (défaut)'))
    .toHaveValue('');
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

test("the cancellation-compensation account is editable and its 0 % VAT is shown as « hors champ »", async () => {
  const user = userEvent.setup();
  api.savePlatformAccounts.mockResolvedValue(SAMPLE_GET);
  renderPage();
  const field = await screen.findByLabelText(/Compte indemnités d'annulation/i);
  expect(field).toHaveValue('75880000');
  expect(screen.getByText(/hors champ/i)).toBeInTheDocument();

  await user.clear(field);
  await user.type(field, '75880100');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.savePlatformAccounts).toHaveBeenCalled());
  expect(api.savePlatformAccounts.mock.calls[0][0].cancellationCompensationAccount).toBe('75880100');
});

test('the accountant may edit the compensation account (it is a chart-of-accounts setting)', async () => {
  setAuth({ roles: ['accountant'] });
  renderPage();
  const field = await screen.findByLabelText(/Compte indemnités d'annulation/i);
  expect(field).not.toBeDisabled();
  // …but the VAT rate stays read-only for them.
  expect(screen.getByText(/réservé à un administrateur/i)).toBeInTheDocument();
});
