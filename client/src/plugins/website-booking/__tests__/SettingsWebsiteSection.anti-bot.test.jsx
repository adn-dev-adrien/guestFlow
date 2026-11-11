// specs/public-request-abuse-and-grouping.md, transition edge case — Paramètres › Intégrations › Site
// says « Protection anti-robot inactive » until the WordPress plugin solves the proof of work.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const api = { getWebsiteConnection: vi.fn(), regenerateWebsiteKey: vi.fn() };
vi.mock('../../sdk', async () => {
  const SecretRevealField = (await import('../../../components/SecretRevealField')).default;
  return { api, SecretRevealField, useAppDialogs: () => ({ confirm: vi.fn() }) };
});

const { default: SettingsWebsiteSection } = await import('../SettingsWebsiteSection');

const connection = (antiBot) => ({ address: { value: 'https://gf.example.com', source: 'setting' }, apiKey: 'k', antiBot });

test('an old plugin → the warning, with the versions', async () => {
  api.getWebsiteConnection.mockResolvedValue(connection({ active: false, pluginVersion: '1.17.1', requiredVersion: '1.18.0' }));
  render(<SettingsWebsiteSection />);
  const alert = await screen.findByRole('status');
  expect(alert.textContent).toMatch('Protection anti-robot inactive : mettre à jour l’extension WordPress');
  expect(alert.textContent).toMatch('1.18.0 ou plus ; vue : 1.17.1');
});

test('an up-to-date plugin → no warning', async () => {
  api.getWebsiteConnection.mockResolvedValue(connection({ active: true, pluginVersion: '1.18.0', requiredVersion: '1.18.0' }));
  render(<SettingsWebsiteSection />);
  expect(await screen.findByText('https://gf.example.com')).toBeTruthy();
  expect(screen.queryByText(/Protection anti-robot inactive/)).toBeNull();
});
