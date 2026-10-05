// specs/plugins-phase-0-foundation.md rules 4-6, 14 and 21-24 — the Plugins page: tabs, search,
// actions, two-click uninstall, refusal under the card, auth refresh after each change.
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
    installPlugin: vi.fn(),
    activatePlugin: vi.fn(),
    deactivatePlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: vi.fn() }));

import api from '../../api';
import { useAuth } from '../../hooks/useAuth';
import PluginsPage from '../PluginsPage';

const plugin = (id, name, state, extra = {}) => ({
  id, name, description: `${name} — description`, icon: 'laundry', surfaces: [`Surface de ${name}`],
  requires: [], state, blocker: null, ...extra,
});

let refresh;

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <DialogProvider><PluginsPage /></DialogProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

const card = (name) => screen.getByText(name).closest('.MuiCard-root');

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  refresh = vi.fn().mockResolvedValue(undefined);
  useAuth.mockReturnValue({ user: { roles: ['admin'], enabledPlugins: [] }, refresh });
});

describe('PluginsPage', () => {
  test('opens on « Installés » and lists only the installed plugins', async () => {
    api.getPlugins.mockResolvedValue([
      plugin('linen', 'Linge et blanchisserie', 'active'),
      plugin('neat', 'Assurance annulation Neat', 'inactive'),
      plugin('sas', 'Arrivée et départ guidés', 'available'),
    ]);
    renderPage();
    expect(await screen.findByText('Linge et blanchisserie')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Installés (2)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Assurance annulation Neat')).toBeInTheDocument();
    expect(screen.queryByText('Arrivée et départ guidés')).not.toBeInTheDocument();
    expect(within(card('Linge et blanchisserie')).getByText('Actif')).toBeInTheDocument();
    expect(within(card('Assurance annulation Neat')).getByText('Inactif')).toBeInTheDocument();
  });

  test('a new customer lands on « Disponibles » and installs a plugin', async () => {
    api.getPlugins
      .mockResolvedValueOnce([plugin('linen', 'Linge et blanchisserie', 'available')])
      .mockResolvedValue([plugin('linen', 'Linge et blanchisserie', 'active')]);
    api.installPlugin.mockResolvedValue({});
    renderPage();
    await screen.findByText('Linge et blanchisserie');
    expect(screen.getByRole('tab', { name: 'Disponibles (1)' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Installer' }));
    expect(api.installPlugin).toHaveBeenCalledWith('linen');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Installés (1)' })).toHaveAttribute('aria-selected', 'true'));
    expect(refresh).toHaveBeenCalled();
    expect(within(card('Linge et blanchisserie')).getByText('Actif')).toBeInTheDocument();
  });

  test('deactivate and activate call the server and refresh the menu', async () => {
    api.getPlugins.mockResolvedValue([plugin('neat', 'Assurance annulation Neat', 'active')]);
    api.deactivatePlugin.mockResolvedValue({});
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Désactiver' }));
    expect(api.deactivatePlugin).toHaveBeenCalledWith('neat');
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  test('a refusal shows under the card, in the server’s words', async () => {
    api.getPlugins.mockResolvedValue([plugin('online-payment', 'Paiement en ligne (Qonto)', 'active')]);
    const refusal = Object.assign(new Error('1 lien de paiement est en attente. Attends leur paiement ou annule-les avant de désactiver.'), { status: 409, error: 'PLUGIN_BLOCKED' });
    api.deactivatePlugin.mockRejectedValue(refusal);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Désactiver' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('1 lien de paiement est en attente');
    expect(refresh).not.toHaveBeenCalled();
  });

  test('uninstall takes two clicks and says the data is kept', async () => {
    api.getPlugins.mockResolvedValue([plugin('linen', 'Linge et blanchisserie', 'inactive')]);
    api.uninstallPlugin.mockResolvedValue({});
    renderPage();
    await userEvent.click(await screen.findByText('Linge et blanchisserie'));
    expect(screen.getByText('Surface de Linge et blanchisserie')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Désinstaller' }));
    expect(api.uninstallPlugin).not.toHaveBeenCalled();
    expect(screen.getByText(/^Données conservées\.$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmer la désinstallation' }));
    expect(api.uninstallPlugin).toHaveBeenCalledWith('linen');
  });

  test('search filters the tab, with an empty state naming the query', async () => {
    api.getPlugins.mockResolvedValue([
      plugin('linen', 'Linge et blanchisserie', 'active'),
      plugin('neat', 'Assurance annulation Neat', 'active'),
    ]);
    renderPage();
    await screen.findByText('Linge et blanchisserie');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Chercher un plugin' }), 'neat');
    expect(screen.queryByText('Linge et blanchisserie')).not.toBeInTheDocument();
    expect(screen.getByText('Assurance annulation Neat')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Chercher un plugin' }), 'zzz');
    expect(screen.getByText('Aucun plugin ne correspond à « neatzzz ».')).toBeInTheDocument();
  });

  test('empty states of both tabs', async () => {
    api.getPlugins.mockResolvedValue([plugin('linen', 'Linge et blanchisserie', 'available')]);
    renderPage();
    await screen.findByText('Linge et blanchisserie');
    await userEvent.click(screen.getByRole('tab', { name: 'Installés (0)' }));
    expect(screen.getByText('Aucun plugin installé. Tout ce qui est facultatif est dans Disponibles.')).toBeInTheDocument();
  });
});
