/**
 * UpdateAvailableAlert — dashboard notification for a published GuestFlow version.
 * specs/self-update-and-releases.md §3.C rules 17-20 + §6.1.
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
import UpdateAvailableAlert from '../UpdateAvailableAlert';

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
  api.dismissUpdate.mockReset();
});

test('announces the published version and the installed one', async () => {
  api.getSystemVersion.mockResolvedValue(versionInfo());
  render(<UpdateAvailableAlert />);
  expect(await screen.findByText('GuestFlow 1.1.0 est disponible')).toBeInTheDocument();
  expect(screen.getByText(/Vous utilisez la version 1\.0\.0/)).toBeInTheDocument();
});

test('stays silent for a non-admin — and never even calls the admin endpoint', async () => {
  currentUser = { id: 2, roles: ['reception'] };
  const { container } = render(<UpdateAvailableAlert />);
  await waitFor(() => expect(container.firstChild).toBeNull());
  expect(api.getSystemVersion).not.toHaveBeenCalled();
});

test('stays silent when up to date, when postponed, and while an update is running', async () => {
  const cases = [
    versionInfo({ updateAvailable: false }),
    versionInfo({ dismissedVersion: '1.1.0' }),
    versionInfo({ updateInProgress: true }),
  ];
  for (const info of cases) {
    api.getSystemVersion.mockResolvedValue(info);
    const { container, unmount } = render(<UpdateAvailableAlert />);
    await waitFor(() => expect(api.getSystemVersion).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
    unmount();
    api.getSystemVersion.mockReset();
  }
});

test('renders nothing rather than an error when the API call fails', async () => {
  api.getSystemVersion.mockRejectedValue(new Error('boom'));
  const { container } = render(<UpdateAvailableAlert />);
  await waitFor(() => expect(container.firstChild).toBeNull());
});

test('"Plus tard" postpones that exact version', async () => {
  const user = userEvent.setup();
  api.getSystemVersion.mockResolvedValue(versionInfo());
  api.dismissUpdate.mockResolvedValue({ dismissedVersion: '1.1.0' });
  render(<UpdateAvailableAlert />);

  await user.click(await screen.findByRole('button', { name: 'Plus tard' }));
  expect(api.dismissUpdate).toHaveBeenCalledWith('1.1.0');
});

test('nothing installs without reading the notes first: the button opens the dialog', async () => {
  const user = userEvent.setup();
  api.getSystemVersion.mockResolvedValue(versionInfo());
  render(<UpdateAvailableAlert />);

  await user.click(await screen.findByRole('button', { name: 'Voir les nouveautés' }));

  expect(await screen.findByText('Une nouveauté')).toBeInTheDocument();
  expect(screen.getByText(/sauvegarde de la base/i)).toBeInTheDocument();
  expect(api.startUpdate).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Installer maintenant' }));
  expect(api.startUpdate).toHaveBeenCalledWith('1.1.0');
});

test('when the deployment cannot self-update, the dialog explains and blocks the install', async () => {
  const user = userEvent.setup();
  api.getSystemVersion.mockResolvedValue(versionInfo({
    selfUpdateSupported: false,
    selfUpdateReason: 'PM2 est introuvable : le redémarrage automatique est impossible.',
  }));
  render(<UpdateAvailableAlert />);

  await user.click(await screen.findByRole('button', { name: 'Voir les nouveautés' }));
  expect(screen.getByText(/PM2 est introuvable/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Installer maintenant' })).toBeDisabled();
});
