/**
 * SettingsPage — the "Envoi automatique des emails" switch, end to end through the form.
 * See specs/no-automatic-email-without-approval.md §4.3 + §6.
 *
 * What matters here is the round trip: the server's `emails.autoSendEnabled` hydrates the switch,
 * and flipping it sends exactly that group — never the whole settings payload.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    sendSmtpTest: vi.fn(),
    uploadCompanyLogo: vi.fn(),
    deleteCompanyLogo: vi.fn(),
    getGoogleCalendarStatus: vi.fn(),
    getSystemVersion: vi.fn(),
    getPushStatus: vi.fn(),
  },
}));

vi.mock('../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return {
    __esModule: true,
    useToast: () => stableToast,
    useAppDialogs: () => ({ confirm: vi.fn().mockResolvedValue(true), alert: vi.fn().mockResolvedValue() }),
  };
});

// The Google / push / update cards each fetch on mount and are irrelevant here.
vi.mock('../../components/SettingsGoogleCalendarSection', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/SettingsPushNotificationsSection', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/SettingsSystemUpdateSection', () => ({ __esModule: true, default: () => null }));

import api from '../../api';
import SettingsPage from '../SettingsPage';

const SWITCH_LABEL = 'Autoriser GuestFlow à envoyer les emails sans validation';

function settingsPayload(over = {}) {
  return {
    company: { name: 'Domaine Solio' },
    quote: {}, vat: {}, accounting: {}, smtp: {}, reservations: {}, laundry: {},
    notifications: { enabled: true, icalReservationEnabled: true, recipientEmail: '' },
    emails: { autoSendEnabled: false },
    weather: { apiKeySet: false },
    updatedAtLabel: 'aujourd’hui',
    ...over,
  };
}

beforeEach(() => {
  Object.values(api).forEach((m) => m?.mockReset?.());
  api.getSettings.mockResolvedValue(settingsPayload());
  api.updateSettings.mockImplementation(async () => settingsPayload({ emails: { autoSendEnabled: true } }));
});

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>
  );
}

test('the switch reflects what the server stored', async () => {
  renderPage();
  expect(await screen.findByLabelText(SWITCH_LABEL)).not.toBeChecked();
});

test('a server that already authorises automatic sending shows the switch on', async () => {
  api.getSettings.mockResolvedValue(settingsPayload({ emails: { autoSendEnabled: true } }));
  renderPage();
  await waitFor(() => expect(screen.getByLabelText(SWITCH_LABEL)).toBeChecked());
});

test('a payload without the emails group falls back to OFF, never to ON', async () => {
  // An older server, or a partially-migrated database: the safe reading is « not authorised ».
  api.getSettings.mockResolvedValue(settingsPayload({ emails: undefined }));
  renderPage();
  expect(await screen.findByLabelText(SWITCH_LABEL)).not.toBeChecked();
});

test('flipping the switch and saving sends only the emails group', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByLabelText(SWITCH_LABEL));
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

  await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
  expect(api.updateSettings).toHaveBeenCalledWith({ emails: { autoSendEnabled: true } });
});

test('the switch alone drives the dirty state', async () => {
  // Untouched, there is nothing to save; touched, Save opens up. This is what keeps a settings save
  // from re-writing groups the operator never opened.
  const user = userEvent.setup();
  renderPage();
  await screen.findByLabelText(SWITCH_LABEL);
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

  await user.click(screen.getByLabelText(SWITCH_LABEL));
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
  expect(api.updateSettings).not.toHaveBeenCalled();
});
