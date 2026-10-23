// specs/plugins-phase-2-hosts.md rule 30 — a connection that cannot be read is said, with « Réessayer »,
// never an empty « Site » tab; a support session reads the server's refusal, without a retry.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

const api = { getWebsiteConnection: vi.fn(), regenerateWebsiteKey: vi.fn() };
vi.mock('../../sdk', async () => {
  const SecretRevealField = (await import('../../../components/SecretRevealField')).default;
  const ErrorAlert = (await import('../../../components/ErrorAlert')).default;
  return { api, ErrorAlert, SecretRevealField, useAppDialogs: () => ({ confirm: vi.fn() }) };
});

const { default: SettingsWebsiteSection } = await import('../SettingsWebsiteSection');

beforeEach(() => {
  api.getWebsiteConnection.mockReset();
});

test('a failed read shows an error with « Réessayer », which reloads the card', async () => {
  api.getWebsiteConnection
    .mockRejectedValueOnce(Object.assign(new Error('Internal Server Error'), { status: 500 }))
    .mockResolvedValueOnce({ address: { value: 'https://guestflow.example.com', source: 'setting' }, apiKey: 'k' });
  render(<SettingsWebsiteSection />);
  expect(await screen.findByText('Site internet : connexion illisible.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('https://guestflow.example.com')).toBeTruthy();
  expect(screen.queryByText('Site internet : connexion illisible.')).toBeNull();
  expect(api.getWebsiteConnection).toHaveBeenCalledTimes(2);
});

test('a support session reads the refusal, without a retry', async () => {
  api.getWebsiteConnection.mockRejectedValue(Object.assign(new Error('SUPPORT_FORBIDDEN'), {
    status: 403, error: 'SUPPORT_FORBIDDEN', message: 'Identifiants et accès réservés au client.',
  }));
  render(<SettingsWebsiteSection />);
  expect(await screen.findByText('Identifiants et accès réservés au client.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
});
