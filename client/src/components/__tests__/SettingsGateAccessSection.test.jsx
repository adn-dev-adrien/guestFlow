import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import SettingsGateAccessSection from '../SettingsGateAccessSection';

// specs/gate-access-sowel-connector.md §3.5 rules 16 and 24 — the card answers a single question:
// is the house talking, and when did it last. And it hands back no secret.

vi.mock('../../api', () => ({ default: { getGateConnector: vi.fn() } }));

import api from '../../api';

beforeEach(() => {
  vi.mocked(api.getGateConnector).mockReset();
});

test('says where to read the two keys while nothing is configured', async () => {
  api.getGateConnector.mockResolvedValue({ configured: false, invitations: 0, lastReceivedAt: null });
  render(<SettingsGateAccessSection />);

  expect(await screen.findByText('Non configuré')).toBeTruthy();
  expect(screen.getByText(/server\/.env.local/)).toBeTruthy();
});

test('says the house is talking, and since when', async () => {
  api.getGateConnector.mockResolvedValue({
    configured: true,
    invitations: 3,
    lastReceivedAt: '2026-09-20T09:15:00.000Z',
  });
  render(<SettingsGateAccessSection />);

  expect(await screen.findByText('La maison parle')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  expect(screen.getByText(/11:15/)).toBeTruthy(); // 09:15 UTC = 11:15 in Paris in September
});

test('tells « configured » apart from « the house has already spoken »', async () => {
  api.getGateConnector.mockResolvedValue({ configured: true, invitations: 0, lastReceivedAt: null });
  render(<SettingsGateAccessSection />);
  expect(await screen.findByText('En attente de la maison')).toBeTruthy();
  expect(screen.getByText('jamais')).toBeTruthy();
});

test('never hands back a secret', async () => {
  api.getGateConnector.mockResolvedValue({
    configured: true,
    invitations: 1,
    lastReceivedAt: '2026-09-20T09:15:00.000Z',
  });
  const { container } = render(<SettingsGateAccessSection />);
  await screen.findByText('La maison parle');
  expect(container.textContent).not.toMatch(/GATE_API_KEY=|GATE_SIGNING_SECRET=/);
});

test('stays silent when the server does not answer', async () => {
  api.getGateConnector.mockRejectedValue(new Error('boom'));
  const { container } = render(<SettingsGateAccessSection />);
  await waitFor(() => expect(api.getGateConnector).toHaveBeenCalled());
  expect(container.textContent).toBe('');
});
