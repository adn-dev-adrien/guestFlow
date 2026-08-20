/**
 * UpdateProgressOverlay — the screen during a self-update.
 * specs/self-update-and-releases.md §3.F rule 37 + §6.3.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getUpdateStatus: vi.fn() },
}));

let currentUser = { id: 1, roles: ['admin'] };
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ user: currentUser }),
}));

import api from '../../api';
import UpdateProgressOverlay from '../UpdateProgressOverlay';

const reload = vi.fn();

beforeAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
});

beforeEach(() => {
  currentUser = { id: 1, roles: ['admin'] };
  api.getUpdateStatus.mockReset();
  reload.mockReset();
});

function status(overrides = {}) {
  return {
    phase: 'installing',
    label: 'Installation des dépendances…',
    terminal: false,
    fromVersion: '1.0.0',
    targetVersion: '1.1.0',
    startedAt: '2026-08-20T10:00:00Z',
    updatedAt: '2026-08-20T10:00:30Z',
    errorCode: null,
    error: null,
    logTail: [],
    ...overrides,
  };
}

test('renders nothing when no update is running', async () => {
  api.getUpdateStatus.mockResolvedValue(status({ phase: 'idle', terminal: true, label: 'Aucune mise à jour en cours' }));
  const { container } = render(<UpdateProgressOverlay />);
  await waitFor(() => expect(api.getUpdateStatus).toHaveBeenCalled());
  expect(container.firstChild).toBeNull();
});

test('a non-admin session renders nothing and never polls the admin endpoint', async () => {
  currentUser = { id: 2, roles: ['reception'] };
  const { container } = render(<UpdateProgressOverlay />);
  await waitFor(() => expect(container.firstChild).toBeNull());
  expect(api.getUpdateStatus).not.toHaveBeenCalled();
});

test('an unreachable status endpoint on mount stays silent', async () => {
  api.getUpdateStatus.mockRejectedValue(new Error('Failed to fetch'));
  const { container } = render(<UpdateProgressOverlay />);
  await waitFor(() => expect(api.getUpdateStatus).toHaveBeenCalled());
  expect(container.firstChild).toBeNull();
});

test('takes over on mount when an update is already running (reload mid-update)', async () => {
  api.getUpdateStatus.mockResolvedValue(status());
  render(<UpdateProgressOverlay />);
  expect(await screen.findByText(/Mise à jour vers la 1\.1\.0 en cours/)).toBeInTheDocument();
  expect(screen.getByText('Installation des dépendances…')).toBeInTheDocument();
  expect(screen.getByText(/La page se rechargera automatiquement/)).toBeInTheDocument();
});

test('a failing request during the restart reads as "restarting", not as a failure', async () => {
  api.getUpdateStatus.mockResolvedValue(status({ phase: 'swapping', label: 'Basculement…' }));
  render(<UpdateProgressOverlay />);
  expect(await screen.findByText('Basculement…')).toBeInTheDocument();

  // The server goes away mid-swap: every poll now throws. That is the normal middle of an update.
  api.getUpdateStatus.mockRejectedValue(new Error('Failed to fetch'));
  // The next poll only fires 2 s later, so give the query more than its default second.
  expect(await screen.findByText('Redémarrage en cours…', {}, { timeout: 5000 })).toBeInTheDocument();
  expect(screen.queryByText(/échou/i)).not.toBeInTheDocument();
});

test('reloads the page once the new version reports done', async () => {
  api.getUpdateStatus.mockResolvedValue(status({ phase: 'restarting', label: 'Redémarrage…' }));
  render(<UpdateProgressOverlay />);
  await screen.findByText('Redémarrage…');

  api.getUpdateStatus.mockResolvedValue(status({ phase: 'done', terminal: true, label: 'Mise à jour terminée' }));
  await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 5000 });
});

test('a rollback shows what happened and the log, and can be dismissed', async () => {
  const user = userEvent.setup();
  api.getUpdateStatus.mockResolvedValue(status({
    phase: 'rolled_back',
    terminal: false,
    label: 'Mise à jour annulée : la version précédente a été restaurée',
    errorCode: 'HEALTHCHECK_TIMEOUT',
    error: "La nouvelle version n'a pas répondu dans le délai imparti.",
    logTail: ['[2026-08-20T10:00:00Z] verification FAILED', '[2026-08-20T10:00:05Z] rolling back'],
  }));

  render(<UpdateProgressOverlay />);
  expect(await screen.findByText(/Mise à jour annulée/)).toBeInTheDocument();
  expect(screen.getByText(/n'a pas répondu dans le délai imparti/)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /Afficher le journal|Journal de la mise à jour/ }));
  expect(screen.getByText(/verification FAILED/)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Fermer' }));
  await waitFor(() => expect(screen.queryByText(/Mise à jour annulée/)).not.toBeInTheDocument());
});
