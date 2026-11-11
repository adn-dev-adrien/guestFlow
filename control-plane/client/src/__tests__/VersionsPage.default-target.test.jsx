// specs/hosting-h1-fleet-runtime.md rule 28 — after a forced rollback the release that failed is
// marked « En échec » and is not the default target, and no scope is preselected: the whole fleet
// is a choice the operator makes.
import React from 'react';
import { screen, fireEvent, within } from '@testing-library/react';
import VersionsPage from '../pages/VersionsPage';
import api from '../api';
import { renderAt, setWidth } from './consoleFixtures';

vi.mock('../api', () => ({ default: { versions: vi.fn(), checkVersions: vi.fn(), installRelease: vi.fn(), startUpdate: vi.fn(), pushPlugin: vi.fn() } }));

const data = {
  releases: [
    { version: '3.10.2', installedAt: '18/10/2026 01:00', count: 0, names: [], failed: true, statusLabel: 'En échec' },
    { version: '3.10.1', installedAt: '17/10/2026 08:00', count: 2, names: ['Aulnes', 'Pins'], failed: false, statusLabel: '2 instances' },
  ],
  published: null,
  install: null,
  instances: [{ id: 1, companyName: 'Aulnes', version: '3.10.1' }, { id: 2, companyName: 'Pins', version: '3.10.1' }],
  defaultTarget: '3.10.1',
  running: null,
  history: [],
  pluginPush: { available: true, plugins: [] },
};

beforeEach(() => { vi.clearAllMocks(); api.versions.mockResolvedValue(data); });

it.each([1280, 390])('rule 28 — at %ipx the failed release is marked, the target is the last good one, nothing is preselected', async (width) => {
  setWidth(width);
  renderAt(<VersionsPage />);
  expect(await screen.findByText('En échec')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Version cible' })).toHaveTextContent('3.10.1');
  expect(screen.getByRole('button', { name: 'Toute la flotte' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: 'Sélection' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: 'Mettre à jour' })).toBeDisabled();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Version cible' }));
  expect(within(await screen.findByRole('listbox')).getByText('3.10.2 — en échec')).toBeInTheDocument();
});
