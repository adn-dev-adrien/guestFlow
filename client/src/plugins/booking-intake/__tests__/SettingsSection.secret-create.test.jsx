// specs/booking-extranet-intake.md rule 25 — the secret is created by an explicit action: without one,
// the card offers « Créer le secret » and no install link (the script would be refused); once created,
// the install link and « Régénérer le secret » appear.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

const api = vi.hoisted(() => ({
  getPluginSettings: vi.fn(), savePluginSettings: vi.fn(), getProperties: vi.fn(), getBookingIntakeLog: vi.fn(),
  regenerateBookingIntakeSecret: vi.fn(), createBookingIntakeSecret: vi.fn(),
}));
vi.mock('../../sdk', () => ({ api, displayDate: (iso) => iso, useAppDialogs: () => ({ confirm: vi.fn() }) }));

import SettingsSection from '../SettingsSection';

beforeEach(() => {
  api.getProperties.mockResolvedValue([]);
  api.getBookingIntakeLog.mockResolvedValue([]);
});
afterEach(() => vi.clearAllMocks());

test('specs/booking-extranet-intake.md rule 25: without a secret, only « Créer le secret » is offered, and it creates it', async () => {
  api.getPluginSettings.mockResolvedValue({ hotelIds: '{}', sourceKeys: '["booking"]', keySet: false });
  api.createBookingIntakeSecret.mockResolvedValue({ ok: true, created: true });
  render(<SettingsSection />);
  const create = await screen.findByRole('button', { name: 'Créer le secret' });
  expect(screen.queryByRole('link', { name: 'Installer le script' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Régénérer le secret' })).not.toBeInTheDocument();

  await userEvent.click(create);
  expect(api.createBookingIntakeSecret).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole('link', { name: 'Installer le script' })).toHaveAttribute('href', '/api/booking-intake/userscript.user.js');
  expect(screen.getByRole('button', { name: 'Régénérer le secret' })).toBeInTheDocument();
  expect(screen.getByText('Secret créé. Installer le script.')).toBeInTheDocument();
});

test('specs/booking-extranet-intake.md rule 25: a failed creation says so and keeps the button', async () => {
  api.getPluginSettings.mockResolvedValue({ hotelIds: '{}', sourceKeys: '[]', keySet: false });
  api.createBookingIntakeSecret.mockRejectedValue(new Error('Accès refusé'));
  render(<SettingsSection />);
  await userEvent.click(await screen.findByRole('button', { name: 'Créer le secret' }));
  expect(await screen.findByText('Accès refusé')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Créer le secret' })).toBeInTheDocument();
});
