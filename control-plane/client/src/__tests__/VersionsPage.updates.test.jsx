// specs/hosting-h1-fleet-runtime.md rules 8 and 10 — « Versions »: the releases installed on the
// host and the instances on each, the published one to install, an update of the fleet or of a
// selection (a customer page preselects its customer), followed one instance at a time, with the
// rolled back one shown.
import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import VersionsPage from '../pages/VersionsPage';
import api from '../api';
import { renderAt, setWidth } from './consoleFixtures';

vi.mock('../api', () => ({ default: { versions: vi.fn(), checkVersions: vi.fn(), installRelease: vi.fn(), startUpdate: vi.fn(), pushPlugin: vi.fn() } }));

const base = {
  releases: [
    { version: '3.10.0', installedAt: '08/10/2026 09:12', count: 0, names: [] },
    { version: '3.9.0', installedAt: '01/10/2026 08:00', count: 2, names: ['Aulnes', 'Moulin'] },
  ],
  published: { version: '3.11.0', installed: false, newer: true, checkedAt: '08/10/2026 10:00' },
  install: null,
  instances: [{ id: 1, companyName: 'Aulnes', version: '3.9.0' }, { id: 2, companyName: 'Moulin', version: '3.9.0' }],
  defaultTarget: '3.10.0',
  running: null,
  history: [],
  pluginPush: { available: false, plugins: [] },
};
const running = {
  id: 7, kind: 'release', title: '3.10.0', scopeLabel: 'toute la flotte', state: 'running', stateLabel: 'En cours', startedAt: '08/10/2026 10:05', error: null,
  items: [
    { customerId: 1, companyName: 'Aulnes', state: 'done', stateLabel: 'Fait', detail: '3.10.0 répond.' },
    { customerId: 2, companyName: 'Moulin', state: 'running', stateLabel: 'En cours', detail: 'Contrôle de santé' },
  ],
};

beforeEach(() => { setWidth(1280); vi.clearAllMocks(); api.versions.mockResolvedValue(base); });

it('rule 8 — the installed releases with their instances, and the published one to install', async () => {
  api.installRelease.mockResolvedValue({ ...base, install: { version: '3.11.0', state: 'running', label: 'Téléchargement…' } });
  renderAt(<VersionsPage />);
  expect(await screen.findByText('2 instances')).toBeInTheDocument();
  expect(screen.getByText(/Aulnes, Moulin/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Installer la 3.11.0' }));
  await waitFor(() => expect(api.installRelease).toHaveBeenCalledWith('3.11.0'));
  expect(await screen.findByText('Téléchargement…')).toBeInTheDocument();
});

it('rule 10 — the whole fleet, after a confirmation; the progress shows one instance at a time', async () => {
  api.startUpdate.mockResolvedValue({ ...base, running });
  renderAt(<VersionsPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Mettre à jour' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/Toute la flotte, une instance après l’autre/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Mettre à jour' }));
  await waitFor(() => expect(api.startUpdate).toHaveBeenCalledWith('3.10.0', null));
  expect(await screen.findByText('3.10.0 répond.')).toBeInTheDocument();
  expect(screen.getByText('Contrôle de santé')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mettre à jour' })).toBeDisabled());
});

it('rule 10 — a customer page opens « Versions » with that customer selected', async () => {
  api.startUpdate.mockResolvedValue(base);
  renderAt(<VersionsPage />, { path: '/versions', route: '/versions?client=2' });
  expect(await screen.findByLabelText('Moulin — 3.9.0')).toBeChecked();
  expect(screen.getByLabelText('Aulnes — 3.9.0')).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mettre à jour' }));
  await waitFor(() => expect(api.startUpdate).toHaveBeenCalledWith('3.10.0', [2]));
});

it('rule 10 — an empty selection cannot start; a stopped update names the instance put back', async () => {
  api.versions.mockResolvedValue({
    ...base,
    history: [{ ...running, state: 'failed', stateLabel: 'Arrêtée', error: 'Moulin : aucune réponse de /api/version en 60 s.',
      items: [running.items[0], { customerId: 2, companyName: 'Moulin', state: 'rolled_back', stateLabel: 'Revenue en arrière', detail: 'aucune réponse ; retour en 3.9.0, base de l’instantané remise.' }] }],
  });
  renderAt(<VersionsPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sélection' }));
  expect(screen.getByRole('button', { name: 'Mettre à jour' })).toBeDisabled();
  expect(screen.getByText('Moulin : aucune réponse de /api/version en 60 s.')).toBeInTheDocument();
  expect(screen.getByText('Revenue en arrière')).toBeInTheDocument();
});
