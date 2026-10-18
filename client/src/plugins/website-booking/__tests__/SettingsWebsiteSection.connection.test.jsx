// specs/plugins-phase-2-hosts.md rules 30-31 — Paramètres › Intégrations hands the admin what the
// WordPress plugin needs: this GuestFlow's address and the API key, masked until « Afficher », and a
// confirmed « Régénérer la clé ».
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { canSeeRoute } from '../../../constants/roles';

const confirm = vi.fn();
const api = { getWebsiteConnection: vi.fn(), regenerateWebsiteKey: vi.fn() };
vi.mock('../../sdk', async () => {
  const SecretRevealField = (await import('../../../components/SecretRevealField')).default;
  return { api, SecretRevealField, useAppDialogs: () => ({ confirm }) };
});

const { default: SettingsWebsiteSection } = await import('../SettingsWebsiteSection');

const connection = (over = {}) => ({
  address: { value: 'https://guestflow.example.com', source: 'setting' },
  apiKey: 'the-public-key',
  ...over,
});

beforeEach(() => {
  confirm.mockReset();
  api.getWebsiteConnection.mockReset().mockResolvedValue(connection());
  api.regenerateWebsiteKey.mockReset();
});

test('rule 30: the address in clear, the key masked until « Afficher »', async () => {
  render(<SettingsWebsiteSection />);
  expect(await screen.findByText('https://guestflow.example.com')).toBeTruthy();
  expect(screen.queryByText('the-public-key')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Afficher — Clé d’API' }));
  expect(screen.getByText('the-public-key')).toBeTruthy();
});

test('rule 30: an address guessed from the browser says so', async () => {
  api.getWebsiteConnection.mockResolvedValue(connection({ address: { value: 'http://localhost:3860', source: 'request' } }));
  render(<SettingsWebsiteSection />);
  expect(await screen.findByText(/Adresse déduite de ce navigateur/)).toBeTruthy();
});

test('rule 31: « Régénérer la clé » asks first, then shows the new key', async () => {
  confirm.mockResolvedValue(true);
  api.regenerateWebsiteKey.mockResolvedValue({ apiKey: 'a-new-key' });
  render(<SettingsWebsiteSection />);
  await userEvent.click(await screen.findByRole('button', { name: 'Régénérer la clé' }));
  expect(confirm).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch('Nouvelle clé active'));
  await userEvent.click(screen.getByRole('button', { name: 'Afficher — Clé d’API' }));
  expect(screen.getByText('a-new-key')).toBeTruthy();
});

test('rule 31: declining the confirmation keeps the key', async () => {
  confirm.mockResolvedValue(false);
  render(<SettingsWebsiteSection />);
  await userEvent.click(await screen.findByRole('button', { name: 'Régénérer la clé' }));
  expect(api.regenerateWebsiteKey).not.toHaveBeenCalled();
});

test('rule 31: a refusal is said in place (key fixed by the environment)', async () => {
  confirm.mockResolvedValue(true);
  api.regenerateWebsiteKey.mockRejectedValue(new Error('Clé fixée par la variable d’environnement PUBLIC_API_KEY du serveur : à changer là.'));
  render(<SettingsWebsiteSection />);
  await userEvent.click(await screen.findByRole('button', { name: 'Régénérer la clé' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch('variable d’environnement'));
});

test('rule 30: Intégrations is reachable with the website booking alone', () => {
  expect(canSeeRoute({ roles: ['admin'], enabledPlugins: ['website-booking'] }, '/settings/integrations')).toBe(true);
});
