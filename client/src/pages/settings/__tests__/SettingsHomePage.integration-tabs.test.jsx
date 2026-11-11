// specs/integrations-tab-per-plugin.md rule 8 — the summary's search finds the Intégrations row with
// the words its active plugins bring, and a word of one plugin opens that plugin's tab.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../../theme';

let enabledPlugins = [];
vi.mock('../../../api', () => ({ __esModule: true, default: { getSettingsSummary: vi.fn() } }));
vi.mock('../../../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ user: { roles: ['admin'], enabledPlugins, supportAccessEnabled: false } }),
}));

import api from '../../../api';
import SettingsHomePage from '../SettingsHomePage';

function Where() {
  const { pathname, search } = useLocation();
  return <p>{`Ouvert : ${pathname}${search}`}</p>;
}

function draw() {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsHomePage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  api.getSettingsSummary.mockResolvedValue({ lines: {} });
  enabledPlugins = ['website-booking', 'neat', 'weather-alerts'];
});

test('rule 8: « neat » finds Intégrations through the Neat plugin and opens its tab', async () => {
  draw();
  await userEvent.type(screen.getByRole('searchbox', { name: 'Chercher un réglage' }), 'neat');
  const row = screen.getByRole('link', { name: /Intégrations/ });
  expect(row).toHaveTextContent('Contient : Neat');
  await userEvent.click(row);
  expect(screen.getByText('Ouvert : /settings/integrations?tab=neat')).toBeInTheDocument();
});

test('rule 8: a word of an inactive plugin finds nothing on Intégrations', async () => {
  draw();
  await userEvent.type(screen.getByRole('searchbox', { name: 'Chercher un réglage' }), 'sowel');
  expect(screen.queryByRole('link', { name: /Intégrations/ })).toBeNull();
});

test('rule 8: the row found by its own name opens the page on its first tab', async () => {
  draw();
  await userEvent.type(screen.getByRole('searchbox', { name: 'Chercher un réglage' }), 'intégrations');
  await userEvent.click(screen.getByRole('link', { name: /Intégrations/ }));
  expect(screen.getByText('Ouvert : /settings/integrations')).toBeInTheDocument();
});
