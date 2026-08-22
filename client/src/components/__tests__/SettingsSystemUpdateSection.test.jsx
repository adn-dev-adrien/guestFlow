/**
 * SettingsSystemUpdateSection — « Système et mises à jour » card in Réglages.
 * specs/self-update-and-releases.md §6.4.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getSystemVersion: vi.fn(),
    checkSystemVersion: vi.fn(),
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
import SettingsSystemUpdateSection from '../SettingsSystemUpdateSection';

function versionInfo(overrides = {}) {
  return {
    current: '1.0.0',
    latest: '1.0.0',
    updateAvailable: false,
    publishedAt: '2026-08-20T10:00:00Z',
    versions: [],
    versionsTruncated: false,
    lastCheckAt: '2026-08-20T11:30:00Z',
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
  api.checkSystemVersion.mockReset();
  api.startUpdate.mockReset();
});

test('up to date: shows the installed version and offers no install button', async () => {
  api.getSystemVersion.mockResolvedValue(versionInfo());
  render(<SettingsSystemUpdateSection />);

  expect(await screen.findByText('Système et mises à jour')).toBeInTheDocument();
  expect(screen.getByText('À jour')).toBeInTheDocument();
  expect(screen.getByText('1.0.0 (déjà installée)')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Installer/ })).not.toBeInTheDocument();
});

test('update available: the badge names the version and the install button appears', async () => {
  api.getSystemVersion.mockResolvedValue(versionInfo({ latest: '1.2.0', updateAvailable: true }));
  render(<SettingsSystemUpdateSection />);

  expect(await screen.findByText('Version 1.2.0 disponible')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Installer la 1.2.0' })).toBeEnabled();
});

test('an update already running disables the install button', async () => {
  api.getSystemVersion.mockResolvedValue(versionInfo({ latest: '1.2.0', updateAvailable: true, updateInProgress: true }));
  render(<SettingsSystemUpdateSection />);

  expect(await screen.findByText('Mise à jour en cours')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Installer la 1.2.0' })).toBeDisabled();
});

test('an unsupported deployment explains itself and hides the install button', async () => {
  api.getSystemVersion.mockResolvedValue(versionInfo({
    latest: '1.2.0',
    updateAvailable: true,
    selfUpdateSupported: false,
    selfUpdateReason: "Ce déploiement n'utilise pas le lien symbolique « current » : mise à jour manuelle requise.",
  }));
  render(<SettingsSystemUpdateSection />);

  expect(await screen.findByText(/mise à jour manuelle requise/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Installer/ })).not.toBeInTheDocument();
});

test('"Vérifier maintenant" polls GitHub and refreshes the card', async () => {
  const user = userEvent.setup();
  api.getSystemVersion.mockResolvedValue(versionInfo());
  api.checkSystemVersion.mockResolvedValue(versionInfo({ latest: '1.3.0', updateAvailable: true }));
  render(<SettingsSystemUpdateSection />);

  await user.click(await screen.findByRole('button', { name: 'Vérifier maintenant' }));
  expect(api.checkSystemVersion).toHaveBeenCalled();
  expect(await screen.findByText('Version 1.3.0 disponible')).toBeInTheDocument();
});

test('a throttled check surfaces the server message instead of failing silently', async () => {
  const user = userEvent.setup();
  api.getSystemVersion.mockResolvedValue(versionInfo());
  api.checkSystemVersion.mockRejectedValue(new Error('Patientez 7 s avant de relancer une vérification.'));
  render(<SettingsSystemUpdateSection />);

  await user.click(await screen.findByRole('button', { name: 'Vérifier maintenant' }));
  expect(await screen.findByText(/Patientez 7 s/)).toBeInTheDocument();
});

test('the history lists the last outcomes, rollbacks included', async () => {
  const user = userEvent.setup();
  api.getSystemVersion.mockResolvedValue(versionInfo({
    history: [
      { from: '1.0.0', to: '1.1.0', result: 'rolled_back', at: '2026-08-19T09:00:00Z', errorCode: 'HEALTHCHECK_TIMEOUT' },
      { from: '0.9.0', to: '1.0.0', result: 'done', at: '2026-08-01T09:00:00Z', errorCode: null },
    ],
  }));
  render(<SettingsSystemUpdateSection />);

  await user.click(await screen.findByRole('button', { name: /Historique des mises à jour|Afficher l'historique/ }));
  expect(screen.getByText(/1\.0\.0 → 1\.1\.0 : annulée \(retour arrière\) \(HEALTHCHECK_TIMEOUT\)/)).toBeInTheDocument();
  expect(screen.getByText(/0\.9\.0 → 1\.0\.0 : installée/)).toBeInTheDocument();
});

test('renders nothing at all for a non-admin', async () => {
  currentUser = { id: 3, roles: ['accountant'] };
  const { container } = render(<SettingsSystemUpdateSection />);
  await waitFor(() => expect(container.firstChild).toBeNull());
  expect(api.getSystemVersion).not.toHaveBeenCalled();
});
