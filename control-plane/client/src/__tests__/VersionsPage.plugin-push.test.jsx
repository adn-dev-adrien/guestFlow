// specs/hosting-h1-fleet-runtime.md rule 11 — a plugin version from the registry is pushed, after a
// confirmation, to the instances that have the plugin; the versions offered are the registry's
// newer ones, a version that rolled back marked « en échec » and never preselected.
import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import VersionsPage from '../pages/VersionsPage';
import api from '../api';
import { renderAt, setWidth } from './consoleFixtures';

vi.mock('../api', () => ({ default: { versions: vi.fn(), checkVersions: vi.fn(), installRelease: vi.fn(), startUpdate: vi.fn(), pushPlugin: vi.fn() } }));

const data = {
  releases: [{ version: '3.10.1', installedAt: '17/10/2026 08:00', count: 2, names: ['Aulnes', 'Pins'], failed: false, statusLabel: '2 instances' }],
  published: null,
  install: null,
  instances: [{ id: 1, companyName: 'Aulnes', version: '3.10.1' }, { id: 2, companyName: 'Pins', version: '3.10.1' }],
  defaultTarget: '3.10.1',
  running: null,
  history: [],
  pluginPush: {
    available: true,
    plugins: [
      { id: 'linen', name: 'Linge', count: 2, runningLabel: '1.0.1 × 2', versions: [{ version: '1.0.3', failed: true, label: '1.0.3 — en échec' }, { version: '1.0.2', failed: false, label: '1.0.2' }], defaultVersion: '1.0.2' },
      { id: 'sas', name: 'Sas', count: 1, runningLabel: '1.0.0 × 1', versions: [], defaultVersion: null },
    ],
  },
};

beforeEach(() => { vi.clearAllMocks(); api.versions.mockResolvedValue(data); api.pushPlugin.mockResolvedValue(data); });

it.each([1280, 390])('rules 11, 30, 31 — at %ipx the newest registry version is offered and pushed after a confirmation', async (width) => {
  setWidth(width);
  renderAt(<VersionsPage />);
  expect(await screen.findByText('Linge')).toBeInTheDocument();
  expect(screen.getByText('1.0.1 × 2')).toBeInTheDocument();
  expect(screen.getByText('Aucune version plus récente au registre.')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Version' })).toHaveTextContent('1.0.2');
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Version' }));
  expect(await screen.findByRole('option', { name: '1.0.3 — en échec' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Pousser' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/Les instances qui l’ont \(2\)/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Pousser' }));
  await waitFor(() => expect(api.pushPlugin).toHaveBeenCalledWith('linen', '1.0.2'));
});
