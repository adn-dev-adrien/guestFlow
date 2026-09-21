/**
 * EmailSettingsPage — one email address, typed once (specs/settings-rationalization.md rule 12).
 *
 * The sending address, the SMTP login and the sender name show what they fall back to (server
 * `smtp.derived`) until the operator overrides them; an override is sent as the only change, and
 * going back to the derived value sends an empty override. No master auto-send switch any more
 * (rule 17b).
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getSettings: vi.fn(), updateSettings: vi.fn(), sendSmtpTest: vi.fn(), getPushStatus: vi.fn() },
}));

vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return {
    __esModule: true,
    useToast: () => stableToast,
    useAppDialogs: () => ({ confirm: vi.fn().mockResolvedValue(true), alert: vi.fn().mockResolvedValue() }),
  };
});

vi.mock('../../../components/SettingsPushNotificationsSection', () => ({ __esModule: true, default: () => null }));

import api from '../../../api';
import EmailSettingsPage from '../EmailSettingsPage';

function settingsPayload(smtp = {}) {
  return {
    smtp: {
      host: 'smtp.gmail.com', secure: false, username: '', passwordSet: true, fromEmail: '', fromName: '',
      publicUrl: 'https://guestflow.example',
      derived: { fromEmail: 'contact@solio.fr', username: 'contact@solio.fr', fromName: 'Domaine Solio' },
      ...smtp,
    },
    notifications: { enabled: true, icalReservationEnabled: true, recipientEmail: '', derivedRecipient: 'contact@solio.fr' },
    emails: { googleReviewUrl: '', instagramUrl: '', poolSeasonStart: '06-15', poolSeasonEnd: '08-31' },
    updatedAtLabel: 'aujourd’hui',
  };
}

beforeEach(() => {
  Object.values(api).forEach((m) => m?.mockReset?.());
  api.getSettings.mockResolvedValue(settingsPayload());
  api.updateSettings.mockImplementation(async (payload) => settingsPayload(payload.smtp));
});

function renderPage() {
  return render(<MemoryRouter><EmailSettingsPage /></MemoryRouter>);
}

test('rule 12: the derived sending address, login and name are shown with their source', async () => {
  renderPage();
  expect(await screen.findByLabelText("Adresse d'envoi")).toHaveValue('contact@solio.fr');
  expect(screen.getByLabelText('Identifiant SMTP')).toHaveValue('contact@solio.fr');
  expect(screen.getByLabelText('Nom affiché')).toHaveValue('Domaine Solio');
  expect(screen.getByText("= l'email de contact de l'Établissement")).toBeInTheDocument();
  expect(screen.getByLabelText('Reçues sur')).toHaveValue('contact@solio.fr');
});

test('rule 12: an override is sent alone, and going back to the derived value sends it empty', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByLabelText("Adresse d'envoi");

  await user.click(screen.getByRole('button', { name: 'Utiliser une autre adresse' }));
  await user.type(screen.getByLabelText("Adresse d'envoi"), 'no-reply@solio.fr');
  await act(async () => { await user.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
  expect(api.updateSettings.mock.calls[0][0]).toEqual({ smtp: { fromEmail: 'no-reply@solio.fr' } });

  await user.click(screen.getByRole('button', { name: 'Revenir à la valeur déduite' }));
  await act(async () => { await user.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(2));
  expect(api.updateSettings.mock.calls[1][0]).toEqual({ smtp: { fromEmail: '' } });
});

test('rule 17b: no master auto-send switch, and the public URL is not on this page', async () => {
  renderPage();
  await screen.findByLabelText("Adresse d'envoi");
  expect(screen.queryByText(/sans validation/i)).toBeNull();
  expect(screen.queryByLabelText(/URL publique/)).toBeNull();
  expect(screen.getByRole('link', { name: 'Emails' })).toHaveAttribute('href', '/emails');
});
