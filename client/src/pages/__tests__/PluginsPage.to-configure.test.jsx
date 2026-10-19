// specs/plugins-phase-0-foundation.md rule 25 — « À configurer (n) » keeps only the plugins that lack
// something (n is the server's count); « Configurer » opens the plugin's settings place.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getPlugins: vi.fn(), getPluginsStatus: vi.fn() },
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ refresh: vi.fn() }) }));

import api from '../../api';
import PluginsPage from '../PluginsPage';

const card = (id, name, setup) => ({
  id, name, description: `${name} — description`, icon: 'event', surfaces: [], requires: [], state: 'active', blocker: null, setup,
});

function Where() {
  const { pathname, hash } = useLocation();
  return <p>{`Ouvert : ${pathname}${hash}`}</p>;
}

beforeEach(() => {
  api.getPlugins.mockResolvedValue([
    card('google-calendar', 'Google Agenda', { needed: true, label: 'Actif · à connecter', path: '/settings/integrations#plugin-google-calendar', action: 'Configurer' }),
    card('linen', 'Linge et blanchisserie', { needed: false, label: 'Actif', path: '/parametres/stock-blanchisserie', action: 'Réglages' }),
  ]);
  api.getPluginsStatus.mockResolvedValue({ registry: { configured: false }, updates: 0, banner: null, toConfigure: 1 });
});

function draw() {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/parametres/plugins']}>
        <Routes>
          <Route path="/parametres/plugins" element={<PluginsPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

test('rule 25: the filter keeps the plugins to configure, and clears', async () => {
  draw();
  const chip = await screen.findByRole('button', { name: 'À configurer (1)' });
  expect(screen.getByText('Linge et blanchisserie')).toBeInTheDocument();
  await userEvent.click(chip);
  expect(screen.queryByText('Linge et blanchisserie')).toBeNull();
  expect(screen.getByText('Google Agenda')).toBeInTheDocument();
  await userEvent.click(chip);
  expect(screen.getByText('Linge et blanchisserie')).toBeInTheDocument();
});

test('rule 25: « Configurer » opens the section of Intégrations', async () => {
  draw();
  await userEvent.click(await screen.findByRole('button', { name: 'Configurer' }));
  expect(screen.getByText('Ouvert : /settings/integrations#plugin-google-calendar')).toBeInTheDocument();
});
