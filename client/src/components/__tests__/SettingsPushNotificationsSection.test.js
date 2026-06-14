import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import SettingsPushNotificationsSection from '../SettingsPushNotificationsSection';
import api from '../../api';
import * as push from '../../push/registerPush';

// specs/pwa-push-notifications.md §6 — per-user push prefs + per-device enable/disable.

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getPushPreferences: vi.fn().mockResolvedValue({ newReservation: true, arrivals: true, departures: true }),
    updatePushPreferences: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../push/registerPush', () => ({
  pushSupported: vi.fn(),
  getPushState: vi.fn(),
  enablePush: vi.fn().mockResolvedValue(true),
  disablePush: vi.fn().mockResolvedValue(true),
}));

beforeEach(() => {
  vi.clearAllMocks();
  push.getPushState.mockResolvedValue({ enabled: false, permission: 'default' });
});

test('unsupported browser → info message, no enable button', async () => {
  push.pushSupported.mockReturnValue(false);
  render(<SettingsPushNotificationsSection />);
  expect(await screen.findByText(/ne supporte pas les notifications push/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Activer les notifications/i })).not.toBeInTheDocument();
});

test('supported + not enabled → « Activer » button calls enablePush', async () => {
  push.pushSupported.mockReturnValue(true);
  render(<SettingsPushNotificationsSection />);
  const btn = await screen.findByRole('button', { name: /Activer les notifications sur cet appareil/i });
  fireEvent.click(btn);
  await waitFor(() => expect(push.enablePush).toHaveBeenCalledTimes(1));
});

test('supported + enabled → shows « Désactiver » + the 3 preference switches; toggling persists', async () => {
  push.pushSupported.mockReturnValue(true);
  push.getPushState.mockResolvedValue({ enabled: true, permission: 'granted' });
  render(<SettingsPushNotificationsSection />);
  expect(await screen.findByRole('button', { name: 'Désactiver' })).toBeInTheDocument();
  expect(screen.getByLabelText('Nouvelle réservation')).toBeChecked();
  expect(screen.getByLabelText('Arrivées')).toBeChecked();
  expect(screen.getByLabelText('Départs')).toBeChecked();

  fireEvent.click(screen.getByLabelText('Arrivées'));
  await waitFor(() => expect(api.updatePushPreferences).toHaveBeenCalledWith({ arrivals: false }));
});
