// specs/platform-settings-relay-and-review.md rule 10 — the summary's search words of a plugin's feature
// come from the plugin: its `settings.menu` entry (`keywords`) or its `settings.keywords` contribution to
// a core page. A word of an inactive plugin finds nothing, and the core names no operator's resource.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
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

function search(word) {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/settings']}><SettingsHomePage /></MemoryRouter>
    </ThemeProvider>,
  );
  return userEvent.type(screen.getByRole('searchbox', { name: 'Chercher un réglage' }), word);
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  api.getSettingsSummary.mockResolvedValue({ lines: {} });
  enabledPlugins = [];
});

test('« sauna » finds Options & ressources while hourly resources are live, and only then', async () => {
  enabledPlugins = ['hourly-resources'];
  await search('sauna');
  expect(screen.getByRole('link', { name: /Options & ressources/ })).toHaveTextContent('Contient : Sauna');
});

test('without the plugin, its word finds nothing; an operator’s own resource name was never a core word', async () => {
  await search('sauna');
  expect(screen.queryByRole('link', { name: /Options & ressources/ })).toBeNull();
});

test('« planche » (an operator’s option) is no core word', async () => {
  enabledPlugins = ['hourly-resources'];
  await search('planche');
  expect(screen.queryByRole('link', { name: /Options & ressources/ })).toBeNull();
});

test('« code portail » finds Établissement through the SAS', async () => {
  enabledPlugins = ['sas'];
  await search('code portail');
  expect(screen.getByRole('link', { name: /Établissement/ })).toHaveTextContent('Contient : Code portail');
});

test('« code portail » without the SAS finds nothing', async () => {
  await search('code portail');
  expect(screen.queryByRole('link', { name: /Établissement/ })).toBeNull();
});

test('a plugin page is found by the words of its own menu entry', async () => {
  enabledPlugins = ['online-payment', 'linen', 'tariff-recipes'];
  await search('qonto');
  expect(screen.getByRole('link', { name: /Paiements en ligne/ })).toHaveTextContent('Contient : Qonto');
});
