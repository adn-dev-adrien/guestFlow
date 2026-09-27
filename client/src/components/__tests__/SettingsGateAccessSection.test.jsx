import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import SettingsGateAccessSection from '../SettingsGateAccessSection';

// specs/gate-access-sowel-connector.md §3.6 rule 29 — the card says whether Sowel reads the list,
// when it last did, how many keys it created, and where the two secrets live. Never their values.

vi.mock('../../api', () => ({ default: { getGateConnector: vi.fn() } }));

import api from '../../api';

const state = (over = {}) => ({
  configured: true,
  lastReadAt: '2026-09-27T09:15:00.000Z',
  keysCreated: 3,
  secretsFile: 'server/.env.local',
  secretNames: ['GATE_API_KEY', 'GATE_SIGNING_SECRET'],
  ...over,
});

beforeEach(() => {
  vi.mocked(api.getGateConnector).mockReset();
});

test('says Sowel reads, since when, and how many keys it created', async () => {
  api.getGateConnector.mockResolvedValue(state());
  render(<SettingsGateAccessSection />);

  expect(await screen.findByText('Sowel lit les clés')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  expect(screen.getByText(/11:15/)).toBeTruthy(); // 09:15 UTC = 11:15 in Paris in September
});

test('says where the two secrets live, by name', async () => {
  api.getGateConnector.mockResolvedValue(state());
  render(<SettingsGateAccessSection />);
  expect(await screen.findByText('GATE_API_KEY et GATE_SIGNING_SECRET')).toBeTruthy();
  expect(screen.getByText('server/.env.local')).toBeTruthy();
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
