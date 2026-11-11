// specs/control-plane-plans-and-access.md rules 8 and 18 — the fleet: today's alerts, the three
// counters as filters, a table on desktop and cards on a phone.
import React from 'react';
import { screen, fireEvent, within } from '@testing-library/react';
import FleetPage from '../pages/FleetPage';
import api from '../api';
import { renderAt, setWidth } from './consoleFixtures';

vi.mock('../api', () => ({ default: { fleet: vi.fn(), alerts: vi.fn() } }));

const r = (id, companyName, state, stateLabel, counters) => ({
  id, slug: companyName.toLowerCase(), url: `https://${companyName.toLowerCase()}.guestflow.fr`, companyName, planName: 'Pro', addonsCount: 0,
  state, stateLabel, endsAt: '2026-10-15', endsAtLabel: '15/10/2026', daysLeft: 16, version: null, installedCount: null, process: null, lastBackup: null, counters,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.fleet.mockResolvedValue({
    rows: [r(1, 'Aulnes', 'due', 'À renouveler', ['renew']), r(2, 'Moulin', 'grace', 'Grâce', ['late']), r(3, 'Pinede', 'active', 'Actif', [])],
    counters: [{ key: 'renew', label: 'à renouveler sous 30 jours', count: 1 }, { key: 'late', label: 'en grâce ou lecture seule', count: 1 }, { key: 'suspended', label: 'suspendus', count: 0 }],
  });
  api.alerts.mockResolvedValue({ alerts: [{ customerId: 2, severity: 'warning', text: 'Moulin passe aujourd’hui en « Grâce ».' }] });
});

it('rule 18 — today’s alerts sit above the fleet', async () => {
  setWidth(1280);
  renderAt(<FleetPage />);
  expect(await screen.findByText('Moulin passe aujourd’hui en « Grâce ».')).toBeInTheDocument();
});

it('rule 8 — a counter filters the list, a second click clears it', async () => {
  setWidth(1280);
  renderAt(<FleetPage />);
  const table = await screen.findByRole('table');
  expect(within(table).getByText('Pinede')).toBeInTheDocument();
  fireEvent.click(screen.getByText('1 en grâce ou lecture seule'));
  expect(within(screen.getByRole('table')).queryByText('Pinede')).not.toBeInTheDocument();
  expect(within(screen.getByRole('table')).getByText('Moulin')).toBeInTheDocument();
  fireEvent.click(screen.getByText('1 en grâce ou lecture seule'));
  expect(within(screen.getByRole('table')).getByText('Pinede')).toBeInTheDocument();
  expect(screen.getAllByText('—').length).toBeGreaterThan(0);
});

it('rule 8 — on a phone, one card per customer', async () => {
  setWidth(375);
  renderAt(<FleetPage />);
  expect(await screen.findByText('Aulnes')).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getAllByText(/Échéance 15\/10\/2026 \(16 j\)/)).toHaveLength(3);
});
