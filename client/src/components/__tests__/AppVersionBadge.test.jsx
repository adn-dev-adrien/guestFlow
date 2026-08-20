/**
 * AppVersionBadge — the installed version in the top bar, and its update affordance.
 * specs/self-update-and-releases.md §3.C rules 17-20b + §6.5.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getSystemVersion: vi.fn(),
    startUpdate: vi.fn(),
    dismissUpdate: vi.fn(),
  },
}));

let currentUser = { id: 1, roles: ['admin'] };
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ user: currentUser }),
}));

import api from '../../api';
import AppVersionBadge from '../AppVersionBadge';

const UPDATE_BUTTON = /est disponible/;

function versionInfo(overrides = {}) {
  return {
    current: '1.0.0',
    latest: '1.1.0',
    updateAvailable: true,
    publishedAt: '2026-08-20T10:00:00Z',
    notes: [{ title: 'Ajouts', items: ['Une nouveauté'] }],
    lastCheckAt: '2026-08-20T11:00:00Z',
    dismissedVersion: null,
    selfUpdateSupported: true,
    selfUpdateReason: null,
    updateInProgress: false,
    history: [],
    ...overrides,
  };
}

beforeEach(() => {
  currentUser = { id: 1, roles: ['admin'] };
  api.getSystemVersion.mockReset();
  api.startUpdate.mockReset();
});

test('shows the installed version, not a build identifier', async () => {
  api.getSystemVersion.mockResolvedValue(versionInfo({ updateAvailable: false, latest: '1.0.0' }));
  render(<AppVersionBadge />);
  expect(await screen.findByText('v1.0.0')).toBeInTheDocument();
});

test('up to date: the version stands alone, with nothing to click', async () => {
  api.getSystemVersion.mockResolvedValue(versionInfo({ updateAvailable: false, latest: '1.0.0' }));
  render(<AppVersionBadge />);
  await screen.findByText('v1.0.0');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('stays silent for a non-admin — and never even calls the admin endpoint', async () => {
  currentUser = { id: 2, roles: ['reception'] };
  const { container } = render(<AppVersionBadge />);
  await waitFor(() => expect(container.firstChild).toBeNull());
  expect(api.getSystemVersion).not.toHaveBeenCalled();
});

test('renders nothing rather than an error when the version cannot be read', async () => {
  api.getSystemVersion.mockRejectedValue(new Error('boom'));
  const { container } = render(<AppVersionBadge />);
  await waitFor(() => expect(container.firstChild).toBeNull());
});

test('a published version adds an icon that opens the notes before anything installs', async () => {
  const user = userEvent.setup();
  api.getSystemVersion.mockResolvedValue(versionInfo());
  render(<AppVersionBadge />);

  await user.click(await screen.findByRole('button', { name: UPDATE_BUTTON }));

  expect(await screen.findByText('Mise à jour vers GuestFlow 1.1.0')).toBeInTheDocument();
  expect(screen.getByText('Une nouveauté')).toBeInTheDocument();
  expect(api.startUpdate).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Installer maintenant' }));
  expect(api.startUpdate).toHaveBeenCalledWith('1.1.0');
});

test('postponing the dashboard alert does not take the way back with it', async () => {
  api.getSystemVersion.mockResolvedValue(versionInfo({ dismissedVersion: '1.1.0' }));
  render(<AppVersionBadge />);
  expect(await screen.findByRole('button', { name: UPDATE_BUTTON })).toBeInTheDocument();
});

test('an update already running hides the icon — the overlay owns the screen', async () => {
  api.getSystemVersion.mockResolvedValue(versionInfo({ updateInProgress: true }));
  render(<AppVersionBadge />);
  await screen.findByText('v1.0.0');
  expect(screen.queryByRole('button', { name: UPDATE_BUTTON })).not.toBeInTheDocument();
});
