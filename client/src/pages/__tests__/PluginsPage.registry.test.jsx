// specs/plugins-phase-4-registry.md rules 9, 12–14, 16, 18, 20–22 — the Plugins page of a release:
// versions, the « Mise à jour x.y.z » chip and its dialog, « Tout mettre à jour », the refusals in
// plain French, the restart, an incompatible plugin, the rollback and the requirements confirmation.
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

const UPDATE = {
  version: '1.2.0',
  changelog: [{ version: '1.2.0', lines: ['Le stock des serviettes se lit sur la bonne semaine.'] }, { version: '1.1.0', lines: ['Une alerte de rupture.'] }],
  refusal: null,
};

const STATUS = {
  mode: 'packages', registry: { configured: true, state: 'ok', label: 'Registre lu il y a 5 min.' }, updates: 1, banner: '1 mise à jour disponible',
};

let onReload;

function renderPage({ restartTimeoutMs } = {}) {
  onReload = vi.fn();
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <DialogProvider><PluginsPage onReload={onReload} pollMs={5} restartTimeoutMs={restartTimeoutMs} /></DialogProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

const card = (name) => screen.getByText(name).closest('.MuiCard-root');

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  BUNDLE_FAILURES.clear();
  api.getPluginsStatus.mockResolvedValue(STATUS);
  api.getRuntimeVersion.mockResolvedValue({ startedAt: 'boot-1' });
  useAuth.mockReturnValue({ user: { roles: ['admin'], enabledPlugins: [] }, refresh: vi.fn().mockResolvedValue(undefined) });
});

test('rule 20: a card shows its version, the chip opens the dialog with the changelog lines in between', async () => {
  api.getPlugins.mockResolvedValue([plugin('linen', 'Linge et blanchisserie', 'active', { update: UPDATE })]);
  renderPage();
  const linen = await waitFor(() => card('Linge et blanchisserie'));
  expect(within(linen).getByText('1.0.0')).toBeInTheDocument();
  await userEvent.click(within(linen).getByText('Mise à jour 1.2.0'));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Le stock des serviettes se lit sur la bonne semaine.')).toBeInTheDocument();
  expect(within(dialog).getByText('Une alerte de rupture.')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Mettre à jour' })).toBeEnabled();
});

test('rules 13, 20: « Mettre à jour » shows « Redémarrage en cours » and reloads once the server is back', async () => {
  api.getPlugins.mockResolvedValue([plugin('linen', 'Linge et blanchisserie', 'active', { update: UPDATE })]);
  api.updatePlugin.mockResolvedValue({ restarting: true, version: '1.2.0' });
  renderPage();
  await userEvent.click(await screen.findByText('Mise à jour 1.2.0'));
  api.getRuntimeVersion.mockResolvedValue({ startedAt: 'boot-1' });
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mettre à jour' }));
  expect(api.updatePlugin).toHaveBeenCalledWith('linen');
  expect(await screen.findByText('Redémarrage en cours')).toBeInTheDocument();
  expect(onReload).not.toHaveBeenCalled();
  api.getRuntimeVersion.mockResolvedValue({ startedAt: 'boot-2' });
  await waitFor(() => expect(onReload).toHaveBeenCalled());
});

test('rule 22: a refused package is said in the dialog, never as a raw error', async () => {
  api.getPlugins.mockResolvedValue([plugin('linen', 'Linge et blanchisserie', 'active', { update: UPDATE })]);
  api.updatePlugin.mockRejectedValue(Object.assign(new Error('Le paquet reçu ne correspond pas à sa signature — rien n’a été modifié.'), { status: 422 }));
  renderPage();
  await userEvent.click(await screen.findByText('Mise à jour 1.2.0'));
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mettre à jour' }));
  expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Le paquet reçu ne correspond pas à sa signature — rien n’a été modifié.');
});

test('rule 22: an update whose version needs a newer GuestFlow shows why, and cannot be started', async () => {
  const refused = { ...UPDATE, refusal: { code: 'CORE_TOO_OLD', message: 'Nécessite GuestFlow 4.1 ou plus récent.' } };
  api.getPlugins.mockResolvedValue([plugin('linen', 'Linge et blanchisserie', 'active', { update: refused })]);
  renderPage();
  await userEvent.click(await screen.findByText('Mise à jour 1.2.0'));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Nécessite GuestFlow 4.1 ou plus récent.')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Mettre à jour' })).toBeDisabled();
});

test('rule 20: the banner « 1 mise à jour disponible » offers « Tout mettre à jour »', async () => {
  api.getPlugins.mockResolvedValue([plugin('linen', 'Linge et blanchisserie', 'active', { update: UPDATE })]);
  api.updateAllPlugins.mockResolvedValue({ restarting: true });
  renderPage();
  expect(await screen.findByText('1 mise à jour disponible')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Tout mettre à jour' }));
  expect(api.updateAllPlugins).toHaveBeenCalled();
  expect(await screen.findByText('Redémarrage en cours')).toBeInTheDocument();
});

test('rule 9: « Rechercher des mises à jour » reads the registry again; the last read is said discreetly', async () => {
  api.getPlugins.mockResolvedValue([plugin('linen', 'Linge et blanchisserie', 'active')]);
  api.getPluginsStatus.mockResolvedValue({ ...STATUS, banner: null, registry: { configured: true, state: 'unreachable', label: 'Registre injoignable, dernière lecture il y a 3 h.' } });
  api.refreshPlugins.mockResolvedValue({});
  renderPage();
  expect(await screen.findByText('Registre injoignable, dernière lecture il y a 3 h.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Rechercher des mises à jour' }));
  expect(api.refreshPlugins).toHaveBeenCalled();
});

test('rule 9: an instance without a registry says nothing about it', async () => {
  api.getPlugins.mockResolvedValue([plugin('linen', 'Linge et blanchisserie', 'active')]);
  api.getPluginsStatus.mockResolvedValue({ mode: 'packages', registry: { configured: false, label: null }, updates: 0, banner: null });
  renderPage();
  await screen.findByText('Linge et blanchisserie');
  expect(screen.queryByRole('button', { name: 'Rechercher des mises à jour' })).toBeNull();
  expect(screen.queryByText(/Registre/)).toBeNull();
});

test('rule 14: an incompatible plugin says so and offers its compatible version', async () => {
  api.getPlugins.mockResolvedValue([plugin('linen', 'Linge et blanchisserie', 'incompatible', {
    version: '2.0.0', incompatible: { code: 'CORE_TOO_OLD', message: 'Incompatible avec cette version.', compatibleVersion: '1.0.0' },
    update: { version: '1.0.0', changelog: [], refusal: null },
  })]);
  api.updatePlugin.mockResolvedValue({ restarting: true });
  renderPage();
  const linen = await waitFor(() => card('Linge et blanchisserie'));
  expect(within(linen).getByText('Incompatible avec cette version')).toBeInTheDocument();
  expect(within(linen).queryByText(/Mise à jour/)).toBeNull();
  await userEvent.click(within(linen).getByRole('button', { name: 'Installer la version 1.0.0' }));
  expect(api.updatePlugin).toHaveBeenCalledWith('linen', { version: '1.0.0' });
});

test('rule 16: « Revenir à la version précédente » is in the detail while the window is open', async () => {
  api.getPlugins.mockResolvedValue([plugin('linen', 'Linge et blanchisserie', 'active', {
    version: '1.2.0', rollback: { version: '1.0.0', label: 'Version 1.0.0, possible jusqu’au 15/10.' },
  })]);
  api.rollbackPlugin.mockResolvedValue({ restarting: true });
  renderPage();
  await userEvent.click(await screen.findByText('Linge et blanchisserie'));
  expect(screen.getByText('Version 1.0.0, possible jusqu’au 15/10.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Revenir à la version précédente' }));
  // Rule 32 — it asks first.
  expect(api.rollbackPlugin).not.toHaveBeenCalled();
  const confirm = await screen.findByRole('dialog');
  expect(confirm).toHaveTextContent('Revenir à Linge et blanchisserie 1.0.0');
  await userEvent.click(within(confirm).getByRole('button', { name: 'Revenir' }));
  expect(api.rollbackPlugin).toHaveBeenCalledWith('linen');
  expect(await screen.findByText('Redémarrage en cours')).toBeInTheDocument();
});

test('rules 12, 21: an available plugin shows its version; a missing requirement is confirmed with it', async () => {
  api.getPlugins.mockResolvedValue([plugin('sas', 'Arrivée et départ guidés', 'available', {
    version: '1.1.0',
    dependencies: { requires: [{ id: 'linen', name: 'Linge et blanchisserie', status: 'missing', label: 'non installé', updateAvailable: false }], usedBy: [] },
    offer: { version: '1.1.0', requirements: [{ id: 'linen', name: 'Linge et blanchisserie', version: '1.0.0', op: 'install' }], refusal: null },
  })]);
  api.installPlugin.mockResolvedValue({ reload: true });
  renderPage();
  const sas = await waitFor(() => card('Arrivée et départ guidés'));
  expect(within(sas).getByText('1.1.0')).toBeInTheDocument();
  expect(within(sas).getByText('non installé')).toBeInTheDocument();
  await userEvent.click(within(sas).getByRole('button', { name: 'Installer' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Installe aussi Linge et blanchisserie 1.0.0.');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Tout installer' }));
  expect(api.installPlugin).toHaveBeenCalledWith('sas', { withRequirements: true });
  await waitFor(() => expect(onReload).toHaveBeenCalled());
});

test('rule 22: an available plugin whose version needs a newer GuestFlow cannot be installed', async () => {
  api.getPlugins.mockResolvedValue([plugin('neat', 'Assurance annulation Neat', 'available', {
    version: '2.0.0', offer: { version: null, requirements: [], refusal: { code: 'CORE_TOO_OLD', message: 'Nécessite GuestFlow 4.1 ou plus récent.' } },
  })]);
  renderPage();
  const neat = await waitFor(() => card('Assurance annulation Neat'));
  expect(within(neat).getByText('Nécessite GuestFlow 4.1 ou plus récent.')).toBeInTheDocument();
  expect(within(neat).getByRole('button', { name: 'Installer' })).toBeDisabled();
});

test('rule 18: a plugin whose bundle did not load is shown failed; the page still renders', async () => {
  BUNDLE_FAILURES.set('linen', 'Failed to fetch dynamically imported module');
  api.getPlugins.mockResolvedValue([plugin('linen', 'Linge et blanchisserie', 'active'), plugin('neat', 'Assurance annulation Neat', 'active')]);
  renderPage();
  const linen = await waitFor(() => card('Linge et blanchisserie'));
  expect(within(linen).getByText('Échec du chargement.')).toBeInTheDocument();
  expect(within(card('Assurance annulation Neat')).getByText('Actif')).toBeInTheDocument();
});

test('rule 32: a restart that does not come back in time says so and offers to try again', async () => {
  api.getPlugins.mockResolvedValue([plugin('linen', 'Linge et blanchisserie', 'active', { update: UPDATE })]);
  api.updatePlugin.mockResolvedValue({ restarting: true });
  renderPage({ restartTimeoutMs: 30 });
  await userEvent.click(await screen.findByText('Mise à jour 1.2.0'));
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mettre à jour' }));
  expect(await screen.findByText('Le redémarrage est plus long que prévu.')).toBeInTheDocument();
  api.getRuntimeVersion.mockResolvedValue({ startedAt: 'boot-2' });
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(onReload).toHaveBeenCalled());
});
