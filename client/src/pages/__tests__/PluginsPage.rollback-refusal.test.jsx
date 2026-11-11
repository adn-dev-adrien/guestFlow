// specs/plugins-phase-4-registry.md rule 59 — a rollback an active dependant's range refuses is disabled on the
// card and says why in place of the window label.
import React from 'react';
import { render, screen } from '@testing-library/react';
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
    rollbackPlugin: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: vi.fn() }));

import api from '../../api';
import { useAuth } from '../../hooks/useAuth';
import PluginsPage from '../PluginsPage';

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  useAuth.mockReturnValue({ user: { id: 1, role: 'admin', roles: ['admin'] } });
  api.getPluginsStatus.mockResolvedValue({ mode: 'packages', registry: { configured: true, state: 'ok', label: '' }, updates: 0, banner: null });
});

test('rule 59: the rollback button is disabled and the refusal replaces the label', async () => {
  api.getPlugins.mockResolvedValue([{
    id: 'sas', name: 'Arrivée et départ guidés', description: 'd', icon: 'laundry', surfaces: ['s'], requires: [], state: 'active',
    blocker: null, version: '1.7.0', update: null, offer: null, incompatible: null,
    rollback: {
      version: '1.6.0', label: 'Version 1.6.0, possible jusqu’au 15/10.',
      refusal: { code: 'REQUIRED_BY_RANGE', message: 'Vigilance nécessite Arrivée et départ guidés 1.7 ou plus récente : à mettre à jour d’abord.' },
    },
  }]);
  render(
    <MemoryRouter><ThemeProvider theme={theme}><DialogProvider><PluginsPage onReload={vi.fn()} pollMs={5} /></DialogProvider></ThemeProvider></MemoryRouter>
  );
  await userEvent.click(await screen.findByText('Arrivée et départ guidés'));
  expect(screen.getByRole('button', { name: 'Revenir à la version précédente' })).toBeDisabled();
  expect(screen.getByText(/1\.7 ou plus récente : à mettre à jour d’abord\./)).toBeInTheDocument();
  expect(screen.queryByText('Version 1.6.0, possible jusqu’au 15/10.')).toBeNull();
});
