import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import SettingsGateAccessSection from '../SettingsGateAccessSection';

// specs/gate-access-sowel-connector.md §3.6 rule 29 — the card says whether Sowel reads the list,
// when it last did, how many keys it created. Rules 29b-29c — it hands the admin the three values the
// plugin needs, the two secrets masked until « Afficher ».

vi.mock('../../../api', () => ({ default: { getGateConnector: vi.fn(), getGateConnectorSecrets: vi.fn() } }));

import api from '../../../api';

const state = (over = {}) => ({
  configured: true,
  lastReadAt: '2026-09-27T09:15:00.000Z',
  stale: false,
  keysCreated: 3,
  secretsFile: 'server/.env.local',
  secretNames: ['GATE_API_KEY', 'GATE_SIGNING_SECRET'],
  ...over,
});

const secrets = (over = {}) => ({
  address: { value: 'https://guestflow.adn-dev.fr', source: 'setting' },
  apiKey: 'the-api-key',
  signingSecret: 'the-signing-secret',
  ...over,
});

beforeEach(() => {
  vi.mocked(api.getGateConnector).mockReset();
  vi.mocked(api.getGateConnectorSecrets).mockReset();
  api.getGateConnectorSecrets.mockResolvedValue(secrets());
});

test('says Sowel reads, since when, and how many keys it created', async () => {
  api.getGateConnector.mockResolvedValue(state());
  render(<SettingsGateAccessSection />);

  expect(await screen.findByText('Sowel lit les clés')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  expect(screen.getByText(/11:15/)).toBeTruthy(); // 09:15 UTC = 11:15 in Paris in September
});

test('shows the address, and the two secrets masked until « Afficher »', async () => {
  api.getGateConnector.mockResolvedValue(state());
  const { container } = render(<SettingsGateAccessSection />);

  expect(await screen.findByText('guestFlow address')).toBeTruthy();
  expect(screen.getByText('API key (GATE_API_KEY)')).toBeTruthy();
  expect(screen.getByText('Signing secret (GATE_SIGNING_SECRET)')).toBeTruthy();
  expect(screen.getByText('https://guestflow.adn-dev.fr')).toBeTruthy();
  expect(container.textContent).not.toContain('the-api-key');
  expect(container.textContent).not.toContain('the-signing-secret');

  await userEvent.click(screen.getByRole('button', { name: 'Afficher — API key (GATE_API_KEY)' }));
  expect(screen.getByText('the-api-key')).toBeTruthy();
  expect(container.textContent).not.toContain('the-signing-secret');
});

test('« Copier » copies a secret without revealing it', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  api.getGateConnector.mockResolvedValue(state());
  const { container } = render(<SettingsGateAccessSection />);

  await userEvent.click(await screen.findByRole('button', { name: 'Copier — Signing secret (GATE_SIGNING_SECRET)' }));
  expect(writeText).toHaveBeenCalledWith('the-signing-secret');
  expect(container.textContent).not.toContain('the-signing-secret');
});

test('says when the address is only deduced from the browser', async () => {
  api.getGateConnector.mockResolvedValue(state());
  api.getGateConnectorSecrets.mockResolvedValue(secrets({ address: { value: 'http://localhost:4000', source: 'request' } }));
  render(<SettingsGateAccessSection />);
  expect(await screen.findByText(/Adresse déduite de ce navigateur/)).toBeTruthy();
});

test('a read older than 3 hours is not « Sowel lit les clés »', async () => {
  api.getGateConnector.mockResolvedValue(state({ stale: true }));
  render(<SettingsGateAccessSection />);
  expect(await screen.findByText('Sowel ne lit plus')).toBeTruthy();
  expect(screen.queryByText('Sowel lit les clés')).toBeNull();
});

test('tells « configured » apart from « Sowel has already read »', async () => {
  api.getGateConnector.mockResolvedValue(state({ lastReadAt: null, keysCreated: 0 }));
  render(<SettingsGateAccessSection />);
  expect(await screen.findByText('Jamais lu par Sowel')).toBeTruthy();
  expect(screen.getByText('jamais')).toBeTruthy();
});

test('says « Non configuré » when a secret is missing', async () => {
  api.getGateConnector.mockResolvedValue(state({ configured: false, lastReadAt: null }));
  render(<SettingsGateAccessSection />);
  expect(await screen.findByText('Non configuré')).toBeTruthy();
});

test('stays silent when the server does not answer', async () => {
  api.getGateConnector.mockRejectedValue(new Error('boom'));
  const { container } = render(<SettingsGateAccessSection />);
  await waitFor(() => expect(api.getGateConnector).toHaveBeenCalled());
  expect(container.textContent).toBe('');
});
