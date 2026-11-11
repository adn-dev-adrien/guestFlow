// specs/hosting-h1-fleet-runtime.md rules 15–16 — the fleet shows the probe's real values: version,
// process, last backup, last verified restore, disk and certificate, with the late or close ones
// marked; the host alerts sit with the others. On a phone, each card carries them.
import React from 'react';
import { screen, within } from '@testing-library/react';
import FleetPage from '../pages/FleetPage';
import api from '../api';
import { renderAt, setWidth } from './consoleFixtures';

vi.mock('../api', () => ({ default: { fleet: vi.fn(), alerts: vi.fn() } }));

const row = (over) => ({
  id: 1, slug: 'aulnes', url: 'https://aulnes.guestflow.fr', companyName: 'Aulnes', planName: 'Pro', addonsCount: 0,
  state: 'active', stateLabel: 'Actif', endsAt: '2027-10-01', endsAtLabel: '01/10/2027', daysLeft: 358, installedCount: 4, counters: [],
  version: '3.9.0', process: 'En marche', processSeverity: 'success', lastBackup: 'il y a 2 min', lastBackupAt: '2026-10-08T09:58:00Z',
  lastBackupSeverity: null, verified: '04/10', verifiedAt: '2026-10-04T03:00:00Z', disk: '48 Mo', diskBytes: 50331648,
  cert: '02/01/2027', certAt: '2027-01-02T10:00:00Z', certSeverity: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.fleet.mockResolvedValue({
    rows: [
      row(),
      row({ id: 2, slug: 'moulin', companyName: 'Moulin', process: 'Ne répond pas', processSeverity: 'error', lastBackup: 'il y a 1 h 12', lastBackupSeverity: 'error', cert: '19/10/2026', certSeverity: 'warning' }),
    ],
    counters: [],
  });
  api.alerts.mockResolvedValue({ alerts: [{ customerId: 2, severity: 'error', text: 'Moulin ne répond plus depuis 3 minutes.' }, { customerId: null, severity: 'warning', text: 'Disque de l’hôte rempli à 88 %.', link: '/versions' }] });
});

it('rule 15 — every row carries version, process, backup, verified restore, disk and certificate', async () => {
  setWidth(1280);
  renderAt(<FleetPage />);
  const table = await screen.findByRole('table');
  for (const h of ['Version', 'Processus', 'Sauvegarde', 'Vérifiée', 'Disque', 'Certificat']) expect(within(table).getByText(h)).toBeInTheDocument();
  const aulnes = within(table).getByText('Aulnes').closest('tr');
  for (const v of ['3.9.0', 'En marche', 'il y a 2 min', '04/10', '48 Mo', '02/01/2027']) expect(within(aulnes).getByText(v)).toBeInTheDocument();
  const moulin = within(table).getByText('Moulin').closest('tr');
  expect(within(moulin).getByText('Ne répond pas')).toBeInTheDocument();
});

it('rule 16 — the host alerts sit with the console’s other alerts', async () => {
  setWidth(1280);
  renderAt(<FleetPage />);
  expect(await screen.findByText('Moulin ne répond plus depuis 3 minutes.')).toBeInTheDocument();
  expect(screen.getByText('Disque de l’hôte rempli à 88 %.')).toBeInTheDocument();
});

it('rule 15 — on a phone, each card carries the measures', async () => {
  setWidth(375);
  renderAt(<FleetPage />);
  expect(await screen.findByText('Aulnes')).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByText('Sauvegarde il y a 2 min · vérifiée le 04/10')).toBeInTheDocument();
  expect(screen.getByText('48 Mo · certificat 02/01/2027')).toBeInTheDocument();
});
