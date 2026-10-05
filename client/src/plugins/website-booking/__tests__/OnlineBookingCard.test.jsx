/**
 * OnlineBookingCard — the website-booking part of Paramètres › Conditions générales: the
 * closed-booking and outdated-plugin alerts, and the emergency switch (specs/terms-acceptance-record.md
 * §3.4, rules 16-18). Moved from TermsSettingsPage.test.jsx with the card
 * (specs/plugins-phase-2-hosts.md rule 25): every verdict comes from GET /api/terms/online-booking.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getOnlineBooking: vi.fn(),
    updateTermsEnforcement: vi.fn(),
  },
}));

vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast };
});

import api from '../../../api';
import OnlineBookingCard from '../OnlineBookingCard';

const view = (over = {}) => ({
  requireTermsAcceptance: true,
  lastSeenPluginVersion: '1.8.0',
  minPluginVersion: '1.8.0',
  pluginOutdated: false,
  bookingClosed: false,
  outdatedPluginBlocks: false,
  ...over,
});

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.getOnlineBooking.mockResolvedValue(view());
});

test('no published version → the closed-booking alert', async () => {
  api.getOnlineBooking.mockResolvedValue(view({ bookingClosed: true }));
  render(<OnlineBookingCard placement="alerts" currentVersion={null} />);
  expect(await screen.findByText(/réservation en ligne fermée/)).toBeInTheDocument();
});

test('an outdated plugin with the enforcement on → the blocking warning', async () => {
  api.getOnlineBooking.mockResolvedValue(view({ lastSeenPluginVersion: '1.7.0', pluginOutdated: true, outdatedPluginBlocks: true }));
  render(<OnlineBookingCard placement="alerts" currentVersion={1} />);
  expect(await screen.findByText(/Le site utilise le plugin 1.7.0/)).toBeInTheDocument();
});

test('turning the enforcement off asks for confirmation first', async () => {
  api.updateTermsEnforcement.mockResolvedValue(view({ requireTermsAcceptance: false }));
  render(<OnlineBookingCard placement="card" currentVersion={1} />);
  const toggle = await screen.findByRole('switch', { name: 'Exiger l’acceptation des CGV sur le site' });
  fireEvent.click(toggle);
  expect(api.updateTermsEnforcement).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Désactiver' })); });
  expect(api.updateTermsEnforcement).toHaveBeenCalledWith(false);
});

test('the card names the last plugin version seen on a request', async () => {
  render(<OnlineBookingCard placement="card" currentVersion={1} />);
  expect(await screen.findByText('Dernière demande reçue du plugin WordPress 1.8.0.')).toBeInTheDocument();
});

test('a failed read is said, with « Réessayer », instead of the card and its switch vanishing', async () => {
  api.getOnlineBooking.mockRejectedValueOnce(new Error('down'));
  render(<OnlineBookingCard placement="card" currentVersion={7} />);
  expect(await screen.findByText('Réservation en ligne : état illisible.')).toBeInTheDocument();
  api.getOnlineBooking.mockResolvedValueOnce(view());
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByRole('switch')).toBeInTheDocument();
});
