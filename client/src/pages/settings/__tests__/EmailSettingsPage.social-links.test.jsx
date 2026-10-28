/**
 * EmailSettingsPage — social links of the J+1 e-mail (specs/settings-input-guards.md rules 35, 37, 42):
 * the list is saved as `emails.socialLinks`, the legacy `instagramUrl` is never sent back by the
 * page, and a server refusal lands under its row.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, act, within, fireEvent } from '@testing-library/react';
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

// Under a loaded CI box the whole page renders slowly: a modest per-test timeout, light interactions.
const SLOW_OK = 20_000;
const renderPage = () => render(<MemoryRouter><EmailSettingsPage /></MemoryRouter>);

test('rule 35, 42: an added link is saved as the whole list, without the legacy instagramUrl', async () => {
  api.updateSettings.mockImplementation(async (body) => payload(body.emails.socialLinks));
  renderPage();
  await screen.findByText('Réseaux sociaux');
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter un réseau' }));
  fireEvent.change(screen.getAllByLabelText('Adresse du lien')[1], { target: { value: 'https://facebook.com/a' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
  expect(api.updateSettings.mock.calls[0][0]).toEqual({
    emails: { socialLinks: [...SAVED, { network: 'facebook', url: 'https://facebook.com/a' }] },
  });
}, SLOW_OK);

test('rule 37: the server\'s refusal of one link shows under that row', async () => {
  api.updateSettings.mockRejectedValue(Object.assign(new Error('SETTINGS_INVALID'), {
    errors: { 'socialLinks.0.url': "Lien d'un autre réseau." },
  }));
  renderPage();
  await screen.findByText('Réseaux sociaux');
  fireEvent.change(screen.getByLabelText('Adresse du lien'), { target: { value: 'https://instagram.com/ax' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  const row = (await screen.findAllByRole('listitem'))[0];
  expect(await within(row).findByText("Lien d'un autre réseau.")).toBeInTheDocument();
}, SLOW_OK);
