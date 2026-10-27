// specs/plugins-phase-3b-neat.md rules 13, 17, specs/platform-settings-relay-and-review.md rule 8 — the
// push toggles are the server's `channels`, labels included: a plugin's only while it is live, and the
// card renders whatever label the plugin declared.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import SettingsPushNotificationsSection from '../SettingsPushNotificationsSection';
import api from '../../api';
import * as push from '../../push/registerPush';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getPushPreferences: vi.fn(),
    getPushPublicKey: vi.fn().mockResolvedValue({ publicKey: 'k', configured: true }),
    updatePushPreferences: vi.fn().mockResolvedValue({}),
    sendPushTest: vi.fn().mockResolvedValue({ sent: 1 }),
  },
}));

vi.mock('../../push/registerPush', () => ({
  pushSupported: vi.fn().mockReturnValue(true),
  getPushState: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}));

const PREFS = { newReservation: true, arrivals: true, departures: true, breakfast: true, neat: true };
const CORE = [
  { key: 'newReservation', label: 'Nouvelle réservation' }, { key: 'arrivals', label: 'Arrivées' },
  { key: 'departures', label: 'Départs' }, { key: 'breakfast', label: 'Petit déjeuner' },
];

beforeEach(() => {
  vi.clearAllMocks();
  push.pushSupported.mockReturnValue(true);
  push.getPushState.mockResolvedValue({ enabled: true, permission: 'granted' });
});

test('Neat live → its toggle is listed', async () => {
  api.getPushPreferences.mockResolvedValue({ ...PREFS, channels: [...CORE, { key: 'neat', label: 'Souscriptions Neat' }] });
  render(<SettingsPushNotificationsSection />);
  expect(await screen.findByLabelText('Souscriptions Neat')).toBeInTheDocument();
});

test('Neat off → no toggle for it; the core channels stay', async () => {
  api.getPushPreferences.mockResolvedValue({ ...PREFS, channels: CORE });
  render(<SettingsPushNotificationsSection />);
  expect(await screen.findByLabelText('Petit déjeuner')).toBeInTheDocument();
  expect(screen.queryByLabelText('Souscriptions Neat')).not.toBeInTheDocument();
});

test('a plugin channel the core does not know is rendered with its own label', async () => {
  api.getPushPreferences.mockResolvedValue({ ...PREFS, insurer: false, channels: [...CORE, { key: 'insurer', label: 'Souscriptions de l’assureur' }] });
  render(<SettingsPushNotificationsSection />);
  expect(await screen.findByLabelText('Souscriptions de l’assureur')).not.toBeChecked();
});

test('the server unreachable → no toggle at all, never a guessed list', async () => {
  api.getPushPreferences.mockRejectedValue(new Error('down'));
  render(<SettingsPushNotificationsSection />);
  expect(await screen.findByRole('button', { name: 'Désactiver' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Arrivées')).not.toBeInTheDocument();
});
