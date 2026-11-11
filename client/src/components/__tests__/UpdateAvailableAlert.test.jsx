// server-test-isolation.md rule 11 — a « nothing shown » check first waits for the answer that could show it.
/**
 * UpdateAvailableAlert — dashboard notification for a published GuestFlow version.
 * specs/self-update-and-releases.md §3.C rules 17-20 + §6.1. Whether it shows (not up to date, not
 * postponed, not running) and its words are the server's since 2026-10-19
 * (specs/shell-and-home-day-first.md rules 6, 8 — dashboard-attention.unit.test.js).
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
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

const ATTENTION = { key: 'update-available', severity: 'info', count: 1, title: 'GuestFlow 1.1.0 disponible', detail: 'Version installée : 1.0.0' };

function versionInfo(overrides = {}) {
  return {
    current: '1.0.0',
    latest: '1.1.0',
    updateAvailable: true,
    publishedAt: '2026-08-20T10:00:00Z',
    versions: [{ version: '1.1.0', publishedAt: '2026-08-20T10:00:00Z', summary: [], notes: [{ title: 'Ajouts', items: ['Une nouveauté'] }] }],
    versionsTruncated: false,
    lastCheckAt: '2026-08-20T11:00:00Z',
    dismissedVersion: null,
    selfUpdateSupported: true,
    selfUpdateReason: null,
    updateInProgress: false,
    history: [],
    ...overrides,
  };
}

// The buttons are disabled until the version details load (specs/server-test-isolation.md rule 11).
async function enabledButton(name) {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

beforeEach(() => {
  currentUser = { id: 1, roles: ['admin'] };
  api.getSystemVersion.mockReset();
  api.startUpdate.mockReset();
  api.dismissUpdate.mockReset();
});

test('announces the published version and the installed one', async () => {
  api.getSystemVersion.mockResolvedValue(versionInfo());
  render(<UpdateAvailableAlert attention={ATTENTION} />);
  expect(screen.getByText('GuestFlow 1.1.0 disponible')).toBeInTheDocument();
  expect(screen.getByText('Version installée : 1.0.0')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Voir les nouveautés' })).toBeEnabled());
});

test('stays silent without a subject (up to date, postponed or running — the server decides)', async () => {
  api.getSystemVersion.mockResolvedValue(versionInfo({ updateAvailable: false }));
  const { container } = render(<UpdateAvailableAlert attention={null} />);
  await act(() => api.getSystemVersion.mock.results.at(-1).value);
  expect(container.firstChild).toBeNull();
});

test('a non-admin never even calls the admin endpoint', async () => {
  currentUser = { id: 2, roles: ['reception'] };
  render(<UpdateAvailableAlert attention={null} />);
  await new Promise((r) => setTimeout(r, 10));
  expect(api.getSystemVersion).not.toHaveBeenCalled();
});

test('"Plus tard" postpones that exact version', async () => {
  const user = userEvent.setup();
  api.getSystemVersion.mockResolvedValue(versionInfo());
  api.dismissUpdate.mockResolvedValue({ dismissedVersion: '1.1.0' });
  render(<UpdateAvailableAlert attention={ATTENTION} />);

  await user.click(await enabledButton('Plus tard'));
  expect(api.dismissUpdate).toHaveBeenCalledWith('1.1.0');
});

test('nothing installs without reading the notes first: the button opens the dialog', async () => {
  const user = userEvent.setup();
  api.getSystemVersion.mockResolvedValue(versionInfo());
  render(<UpdateAvailableAlert attention={ATTENTION} />);

  await user.click(await enabledButton('Voir les nouveautés'));

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
  render(<UpdateAvailableAlert attention={ATTENTION} />);

  await user.click(await enabledButton('Voir les nouveautés'));
  expect(screen.getByText(/PM2 est introuvable/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Installer maintenant' })).toBeDisabled();
});
