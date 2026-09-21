/**
 * IntegrationsSettingsPage — the action bar is the only thing that writes.
 * See specs/settings-one-save-and-automatic-webhook.md §3 rules 1 and 4; the Neat card moved from the
 * former « Générale » page to Paramètres → Intégrations (specs/settings-rationalization.md rule 2).
 *
 * The Neat card keeps its own data and its own endpoints; what it gave up is its three « Enregistrer »
 * buttons. This suite checks the seam: a change made inside the card lights up the bar, the bar's
 * Save writes the card, and leaving with only a card-level change is still guarded.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    sendSmtpTest: vi.fn(),
    uploadCompanyLogo: vi.fn(),
    deleteCompanyLogo: vi.fn(),
    getSystemVersion: vi.fn(),
    getPushStatus: vi.fn(),
    getNeatSettings: vi.fn(),
    updateNeatSettings: vi.fn(),
    testNeatConnection: vi.fn(),
    getNeatDiscovery: vi.fn(),
    updateNeatSelection: vi.fn(),
    updateNeatMapping: vi.fn(),
  },
}));

vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return {
    __esModule: true,
    default: ({ children }) => children,
    useToast: () => stableToast,
    useAppDialogs: () => ({ confirm: vi.fn().mockResolvedValue(true), alert: vi.fn().mockResolvedValue() }),
  };
});

vi.mock('../../../components/SettingsGoogleCalendarSection', () => ({ __esModule: true, default: () => null }));

import api from '../../../api';
import IntegrationsSettingsPage from '../IntegrationsSettingsPage';
import { CONFIGURED_SETTINGS } from '../../../components/__tests__/neatSectionFixtures';

function settingsPayload(over = {}) {
  return {
    company: { name: 'Domaine Solio' },
    weather: { apiKeySet: false },
    updatedAtLabel: 'aujourd’hui',
    ...over,
  };
}

beforeEach(() => {
  Object.values(api).forEach((m) => m?.mockReset?.());
  api.getSettings.mockResolvedValue(settingsPayload());
  api.updateSettings.mockResolvedValue(settingsPayload());
  api.getNeatSettings.mockResolvedValue(CONFIGURED_SETTINGS);
  api.updateNeatSettings.mockResolvedValue(CONFIGURED_SETTINGS);
  delete window.__guestflowBeforeNavigate;
});

function renderPage() {
  return render(
    <MemoryRouter>
      <IntegrationsSettingsPage />
    </MemoryRouter>,
  );
}

const saveButton = () => screen.getByRole('button', { name: 'Enregistrer' });

// Rule 1 — the bar is the only writer, so it must know about a change it did not receive itself.
test('rule 1: a change inside the Neat card enables the bar’s Save, which writes that card', async () => {
  renderPage();
  await screen.findByText('Connectée — staging');
  expect(saveButton()).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Marge sur la prime Neat (%)'), { target: { value: '18' } });
  await waitFor(() => expect(saveButton()).toBeEnabled());

  await act(async () => { fireEvent.click(saveButton()); });

  await waitFor(() => expect(api.updateNeatSettings).toHaveBeenCalledTimes(1));
  expect(api.updateNeatSettings.mock.calls[0][0].marginPercent).toBe('18');
  // Rule 2: the general settings form was untouched, so nothing was posted for it.
  expect(api.updateSettings).not.toHaveBeenCalled();
});

// Rule 1 — the two halves of the page are saved by the same press.
test('rule 1: one press writes the weather key and the Neat card together', async () => {
  renderPage();
  await screen.findByText('Connectée — staging');

  fireEvent.change(screen.getByLabelText('Marge sur la prime Neat (%)'), { target: { value: '18' } });
  fireEvent.change(screen.getByLabelText('Clé API Météo-France (Vigilance)'), { target: { value: 'k-123' } });
  await waitFor(() => expect(saveButton()).toBeEnabled());

  await act(async () => { fireEvent.click(saveButton()); });

  await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
  expect(api.updateSettings.mock.calls[0][0]).toEqual({ weather: { apiKey: 'k-123' } });
  expect(api.updateNeatSettings).toHaveBeenCalledTimes(1);
});

// Rule 4 — the guard protects the page, not just the form the page happens to own.
test('rule 4: leaving with only a Neat change still asks for confirmation', async () => {
  renderPage();
  await screen.findByText('Connectée — staging');

  fireEvent.change(screen.getByLabelText('Marge sur la prime Neat (%)'), { target: { value: '18' } });
  await waitFor(() => expect(saveButton()).toBeEnabled());

  let blocked = false;
  act(() => { blocked = window.__guestflowBeforeNavigate('/reservations'); });

  expect(blocked).toBe(true);
  expect(await screen.findByText('Vous avez des modifications non enregistrées. Quitter sans sauvegarder ?')).toBeInTheDocument();
});

// Rule 3 — a refusal inside the card is reported, and the card keeps what the operator typed.
test('rule 3: a Neat refusal leaves the typed value in the field', async () => {
  api.updateNeatSettings.mockRejectedValue(new Error('Neat refuse ces identifiants.'));
  renderPage();
  await screen.findByText('Connectée — staging');

  fireEvent.change(screen.getByLabelText('Marge sur la prime Neat (%)'), { target: { value: '18' } });
  await act(async () => { fireEvent.click(saveButton()); });

  await waitFor(() => expect(api.updateNeatSettings).toHaveBeenCalled());
  expect(screen.getByLabelText('Marge sur la prime Neat (%)')).toHaveValue('18');
  expect(saveButton()).toBeEnabled();
});
