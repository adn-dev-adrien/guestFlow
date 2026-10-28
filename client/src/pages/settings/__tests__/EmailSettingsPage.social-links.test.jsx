/**
 * EmailSettingsPage — social links of the J+1 e-mail (specs/settings-input-guards.md rules 35, 37, 42):
 * the list is saved as `emails.socialLinks`, the legacy `instagramUrl` is never sent back by the
 * page, and a server refusal lands under its row.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, act, within } from '@testing-library/react';
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
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => false }));

import api from '../../../api';
import EmailSettingsPage from '../EmailSettingsPage';

const NETWORKS = [{ value: 'instagram', label: 'Instagram' }, { value: 'facebook', label: 'Facebook' }];
const payload = (socialLinks) => ({
  smtp: { host: 'smtp.example.com', secure: false, username: '', passwordSet: true, fromEmail: '', fromName: '', publicUrl: 'https://guestflow.example', derived: { fromEmail: 'c@x.fr', username: 'c@x.fr', fromName: 'Maison' } },
  notifications: { enabled: true, icalReservationEnabled: true, recipientEmail: '', derivedRecipient: 'c@x.fr' },
  emails: { googleReviewUrl: '', instagramUrl: 'https://instagram.com/a', socialLinks, socialNetworks: NETWORKS },
  updatedAtLabel: 'aujourd’hui',
});
const SAVED = [{ network: 'instagram', url: 'https://instagram.com/a' }];

beforeEach(() => {
  Object.values(api).forEach((m) => m?.mockReset?.());
  api.getSettings.mockResolvedValue(payload(SAVED));
});

const renderPage = () => render(<MemoryRouter><EmailSettingsPage /></MemoryRouter>);

test('rule 35, 42: an added link is saved as the whole list, without the legacy instagramUrl', async () => {
  const user = userEvent.setup();
  api.updateSettings.mockImplementation(async (body) => payload(body.emails.socialLinks));
  renderPage();
  await screen.findByText('Réseaux sociaux');
  await user.click(screen.getByRole('button', { name: 'Ajouter un réseau' }));
  await user.type(screen.getAllByLabelText('Adresse du lien')[1], 'https://facebook.com/a');
  await act(async () => { await user.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
  expect(api.updateSettings.mock.calls[0][0]).toEqual({
    emails: { socialLinks: [...SAVED, { network: 'facebook', url: 'https://facebook.com/a' }] },
  });
});

test('rule 37: the server\'s refusal of one link shows under that row', async () => {
  const user = userEvent.setup();
  api.updateSettings.mockRejectedValue(Object.assign(new Error('SETTINGS_INVALID'), {
    errors: { 'socialLinks.0.url': "Lien d'un autre réseau." },
  }));
  renderPage();
  await screen.findByText('Réseaux sociaux');
  await user.type(screen.getByLabelText('Adresse du lien'), 'x');
  await act(async () => { await user.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  const row = (await screen.findAllByRole('listitem'))[0];
  expect(await within(row).findByText("Lien d'un autre réseau.")).toBeInTheDocument();
});
