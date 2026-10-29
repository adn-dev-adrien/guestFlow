// specs/plugin-dependencies.md rule 22 — a confirmation the server found stale (the closure moved
// since the click) shows the refusal and re-reads the list, so the next click carries the new ids.
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
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
    installPlugin: vi.fn(),
    activatePlugin: vi.fn(),
    deactivatePlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
    updatePlugin: vi.fn(),
    updateAllPlugins: vi.fn(),
    rollbackPlugin: vi.fn(),
    refreshPlugins: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: vi.fn() }));

import api from '../../api';
import { useAuth } from '../../hooks/useAuth';
import { BUNDLE_FAILURES } from '../../plugins/runtimeModules';
import PluginsPage from '../PluginsPage';

const plugin = (id, name, state, extra = {}) => ({
  id, name, description: `${name} — description`, icon: 'laundry', surfaces: [`Surface de ${name}`],
  requires: [], state, blocker: null, version: '1.0.0', update: null, offer: null, incompatible: null, rollback: null, ...extra,
});

const STATUS = { mode: 'packages', registry: { configured: false }, updates: 0, banner: null };

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  BUNDLE_FAILURES.clear();
  api.getPluginsStatus.mockResolvedValue(STATUS);
  api.getRuntimeVersion.mockResolvedValue({ startedAt: 'boot-1' });
  useAuth.mockReturnValue({ user: { roles: ['admin'], enabledPlugins: [] }, refresh: vi.fn().mockResolvedValue(undefined) });
});

test('rule 22: a stale confirmation shows the refusal and reloads the list', async () => {
  api.getPlugins.mockResolvedValue([plugin('sas', 'Arrivée et départ guidés', 'available', {
    offer: { version: '1.1.0', requirements: [{ id: 'linen', name: 'Linge et blanchisserie', version: '1.0.0', op: 'install' }], refusal: null,
      confirm: { title: 'Installer Arrivée et départ guidés', message: 'Installe aussi Linge et blanchisserie 1.0.0.', label: 'Tout installer' } },
  })]);
  api.installPlugin.mockRejectedValue(new Error('La liste a changé : relire, puis confirmer à nouveau.'));
  render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <DialogProvider><PluginsPage onReload={vi.fn()} pollMs={5} /></DialogProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  const sas = await waitFor(() => screen.getByText('Arrivée et départ guidés').closest('.MuiCard-root'));
  await userEvent.click(within(sas).getByRole('button', { name: 'Installer' }));
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Tout installer' }));
  expect(await screen.findByText('La liste a changé : relire, puis confirmer à nouveau.')).toBeInTheDocument();
  expect(api.getPlugins).toHaveBeenCalledTimes(2);
});
