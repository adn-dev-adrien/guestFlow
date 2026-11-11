// specs/plugins-phase-4-registry.md rules 13, 20, 32 — « Tout mettre à jour » follows the server's
// answer as a single update does (restart, reload, or the refreshed list), and a restart whose former
// start time could not be read never reloads on the old process's answer.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getPlugins: vi.fn(),
    getPluginsStatus: vi.fn(),
    getRuntimeVersion: vi.fn(),
    updateAllPlugins: vi.fn(),
    refreshPlugins: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: vi.fn() }));

import api from '../../api';
import { useAuth } from '../../hooks/useAuth';
import PluginsPage from '../PluginsPage';

const LINEN = {
  id: 'linen', name: 'Linge et blanchisserie', description: 'Linge', icon: 'laundry', surfaces: [], requires: [],
  state: 'active', blocker: null, version: '1.0.0', update: null, offer: null, incompatible: null, rollback: null,
};
const STATUS = { mode: 'packages', registry: { configured: true, state: 'ok', label: '' }, updates: 1, banner: '1 mise à jour disponible' };

let onReload;
let refresh;

function renderPage(props = {}) {
  onReload = vi.fn();
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <DialogProvider><PluginsPage onReload={onReload} pollMs={5} {...props} /></DialogProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  refresh = vi.fn().mockResolvedValue(undefined);
  useAuth.mockReturnValue({ user: { roles: ['admin'], enabledPlugins: [] }, refresh });
  api.getPlugins.mockResolvedValue([LINEN]);
  api.getPluginsStatus.mockResolvedValue(STATUS);
  api.getRuntimeVersion.mockResolvedValue({ startedAt: 'boot-1' });
});

test('« Tout mettre à jour » reloads the page when the server says so', async () => {
  api.updateAllPlugins.mockResolvedValue({ reload: true });
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Tout mettre à jour' }));
  await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
});

test('« Tout mettre à jour » without restart nor reload reads the list and the session again', async () => {
  api.updateAllPlugins.mockResolvedValue({ updated: [] });
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Tout mettre à jour' }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(api.getPlugins).toHaveBeenCalledTimes(2);
  expect(onReload).not.toHaveBeenCalled();
});

test('an unknown former start time waits for the server to go down before reloading', async () => {
  api.getRuntimeVersion.mockRejectedValueOnce(new Error('réseau'));
  api.updateAllPlugins.mockResolvedValue({ restarting: true });
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Tout mettre à jour' }));
  expect(await screen.findByText('Redémarrage en cours')).toBeInTheDocument();
  await wait(40);
  expect(onReload).not.toHaveBeenCalled();
  api.getRuntimeVersion.mockRejectedValue(new Error('down'));
  await wait(20);
  api.getRuntimeVersion.mockResolvedValue({ startedAt: 'boot-2' });
  await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
});

test('an unknown former start time and no visible restart: « Réessayer » accepts the next answer', async () => {
  api.getRuntimeVersion.mockRejectedValueOnce(new Error('réseau'));
  api.updateAllPlugins.mockResolvedValue({ restarting: true });
  renderPage({ restartTimeoutMs: 30 });
  await userEvent.click(await screen.findByRole('button', { name: 'Tout mettre à jour' }));
  expect(await screen.findByText('Le redémarrage est plus long que prévu.')).toBeInTheDocument();
  expect(onReload).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
});

test('« À configurer » is a 44 px touch target', async () => {
  api.getPluginsStatus.mockResolvedValue({ ...STATUS, toConfigure: 1 });
  renderPage();
  const chip = await screen.findByRole('button', { name: 'À configurer (1)' });
  expect(getComputedStyle(chip).minHeight).toBe('44px');
});
