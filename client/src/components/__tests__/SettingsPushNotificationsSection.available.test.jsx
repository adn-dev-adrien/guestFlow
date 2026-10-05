// specs/plugins-phase-3b-neat.md rules 13, 17 — the push toggles are the ones the server lists as
// `available`: « Souscriptions Neat » only while the neat plugin is live.
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

beforeEach(() => {
  vi.clearAllMocks();
  push.pushSupported.mockReturnValue(true);
  push.getPushState.mockResolvedValue({ enabled: true, permission: 'granted' });
});

test('Neat live → its toggle is listed', async () => {
  api.getPushPreferences.mockResolvedValue({ ...PREFS, available: [...Object.keys(PREFS)] });
  render(<SettingsPushNotificationsSection />);
  expect(await screen.findByLabelText('Souscriptions Neat')).toBeInTheDocument();
});

test('Neat off → no toggle for it; the core channels stay', async () => {
  api.getPushPreferences.mockResolvedValue({ ...PREFS, available: ['newReservation', 'arrivals', 'departures', 'breakfast'] });
  render(<SettingsPushNotificationsSection />);
  expect(await screen.findByLabelText('Petit déjeuner')).toBeInTheDocument();
  expect(screen.queryByLabelText('Souscriptions Neat')).not.toBeInTheDocument();
});
