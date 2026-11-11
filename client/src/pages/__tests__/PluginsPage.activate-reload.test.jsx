// specs/plugins-phase-4-registry.md rule 46 — an activation that brought a dependant up answers `reload`:
// the page reloads so the revived plugin's bundle is imported.
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

test('rule 46: an activation answering reload reloads the page', async () => {
  api.getPlugins.mockResolvedValue([plugin('sas', 'Arrivée et départ guidés', 'inactive', {
    actions: { activate: { allowed: true, blockedBy: null, alsoActivates: [], confirm: null }, deactivate: { allowed: false, alsoDeactivates: [] }, uninstall: { allowed: true } },
  })]);
  api.activatePlugin.mockResolvedValue({ reload: true, revived: ['google-vacation-rentals'] });
  const onReload = vi.fn();
  render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <DialogProvider><PluginsPage onReload={onReload} pollMs={5} /></DialogProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  const sas = await waitFor(() => screen.getByText('Arrivée et départ guidés').closest('.MuiCard-root'));
  await userEvent.click(within(sas).getByRole('button', { name: 'Activer' }));
  await waitFor(() => expect(onReload).toHaveBeenCalled());
});
