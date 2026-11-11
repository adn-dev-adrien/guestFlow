// specs/ui-review-2026-10-19-operations.md rule 39 — an older list answering last never brings the previous state back
// (audit R23-P3: « Rechercher » still on its way, « Activer » answered first).
import React from 'react';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getPlugins: vi.fn(), getPluginsStatus: vi.fn(), getRuntimeVersion: vi.fn(), activatePlugin: vi.fn(), refreshPlugins: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: vi.fn() }));

import api from '../../api';
import { useAuth } from '../../hooks/useAuth';
import PluginsPage from '../PluginsPage';

const plugin = (state) => ({
  id: 'sas', name: 'Arrivée et départ guidés', description: 'description', icon: 'laundry', surfaces: ['Surface'],
  requires: [], state, blocker: null, version: '1.0.0', update: null, offer: null, incompatible: null, rollback: null,
  actions: { activate: { allowed: true, blockedBy: null, alsoActivates: [], confirm: null }, deactivate: { allowed: true, alsoDeactivates: [] }, uninstall: { allowed: true } },
});

test('rule 39: the older list answering last does not put « Activer » back on an active plugin', async () => {
  api.getPluginsStatus.mockResolvedValue({ mode: 'packages', registry: { configured: true }, updates: 0, banner: null });
  api.getRuntimeVersion.mockResolvedValue({ startedAt: 'boot-1' });
  api.refreshPlugins.mockResolvedValue({});
  api.activatePlugin.mockResolvedValue({});
  useAuth.mockReturnValue({ user: { roles: ['admin'], enabledPlugins: [] }, refresh: vi.fn().mockResolvedValue(undefined) });
  api.getPlugins.mockResolvedValueOnce([plugin('inactive')]);
  render(<MemoryRouter><ThemeProvider theme={theme}><DialogProvider><PluginsPage /></DialogProvider></ThemeProvider></MemoryRouter>);
  const card = () => screen.getByText('Arrivée et départ guidés').closest('.MuiCard-root');
  await waitFor(() => within(card()).getByRole('button', { name: 'Activer' }));

  let answerOlder;
  api.getPlugins.mockImplementationOnce(() => new Promise((resolve) => { answerOlder = resolve; }));
  await userEvent.click(screen.getByRole('button', { name: /Rechercher des mises à jour/ }));
  await waitFor(() => expect(api.getPlugins).toHaveBeenCalledTimes(2));

  api.getPlugins.mockResolvedValueOnce([plugin('active')]);
  await userEvent.click(within(card()).getByRole('button', { name: 'Activer' }));
  await waitFor(() => expect(within(card()).queryByRole('button', { name: 'Activer' })).toBeNull());

  await act(async () => { answerOlder([plugin('inactive')]); });
  expect(within(card()).queryByRole('button', { name: 'Activer' })).toBeNull();
});
