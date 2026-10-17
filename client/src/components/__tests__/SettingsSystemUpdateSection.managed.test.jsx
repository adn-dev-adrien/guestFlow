/**
 * SettingsSystemUpdateSection on a hosted instance — specs/hosting-h1-fleet-runtime.md rule 9: the
 * version and « Mises à jour gérées par l’hébergeur », nothing to press. A self-hosted install keeps
 * its buttons (specs/self-update-and-releases.md §6.4, covered by SettingsSystemUpdateSection.test.jsx).
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getSystemVersion: vi.fn(), checkSystemVersion: vi.fn(), startUpdate: vi.fn(), dismissUpdate: vi.fn() },
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { id: 1, roles: ['admin'] } }) }));

import api from '../../api';
import SettingsSystemUpdateSection from '../SettingsSystemUpdateSection';

const info = (over) => ({
  current: '3.9.0', latest: null, updateAvailable: false, publishedAt: null, versions: [], versionsTruncated: false,
  lastCheckAt: null, dismissedVersion: null, selfUpdateSupported: false, selfUpdateReason: null, updateInProgress: false, history: [], ...over,
});

test('rule 9 — a managed instance shows its version and « Mises à jour gérées par l’hébergeur », with no button', async () => {
  api.getSystemVersion.mockResolvedValue(info({ managed: true, managedLabel: 'Mises à jour gérées par l’hébergeur' }));
  render(<SettingsSystemUpdateSection />);
  expect(await screen.findByText('Mises à jour gérées par l’hébergeur')).toBeInTheDocument();
  expect(screen.getByText('3.9.0')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('rule 9 — a self-hosted install keeps « Vérifier maintenant »', async () => {
  api.getSystemVersion.mockResolvedValue(info({ managed: false, managedLabel: null, selfUpdateSupported: true }));
  render(<SettingsSystemUpdateSection />);
  expect(await screen.findByRole('button', { name: 'Vérifier maintenant' })).toBeInTheDocument();
  expect(screen.queryByText('Mises à jour gérées par l’hébergeur')).not.toBeInTheDocument();
});
