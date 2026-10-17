// specs/hosting-h1-fleet-runtime.md rules 1, 2 and 14 — the customer page follows a running creation
// live, offers « Reprendre » on a failed step, shows the instance's measures, and restores to a date
// within the window the server gives (refused before a date is chosen).
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import CustomerPage from '../pages/CustomerPage';
import api from '../api';
import { renderAt, setWidth, customerFixture } from './consoleFixtures';

vi.mock('../api', () => ({ default: {
  customer: vi.fn(), stepAction: vi.fn(), restoreWindow: vi.fn(), restore: vi.fn(), licenceUrl: (id) => `/api/customers/${id}/licence`,
} }));

const hosting = {
  version: '3.9.0', port: 4407, canRestore: true,
  lines: [{ label: 'Version', value: '3.9.0' }, { label: 'Processus', value: 'En marche' }, { label: 'Dernière sauvegarde', value: 'il y a 2 min' }],
};
const page = () => renderAt(<CustomerPage />, { path: '/clients/:id', route: '/clients/3' });

beforeEach(() => { setWidth(1280); vi.clearAllMocks(); });

it('rule 1 — a running creation is followed live until it ends', async () => {
  const running = { ...customerFixture, provisioningRunning: true, steps: [{ step: 'process', label: 'Processus', kind: 'auto', status: 'running', detail: 'En cours…', action: null }] };
  const done = { ...customerFixture, provisioningRunning: false, steps: [{ step: 'process', label: 'Processus', kind: 'auto', status: 'ok', detail: 'En marche.', action: null }] };
  api.customer.mockResolvedValueOnce(running).mockResolvedValueOnce(done);
  page();
  expect(await screen.findByText('En cours…')).toBeInTheDocument();
  expect(await screen.findByText('En marche.', {}, { timeout: 3000 })).toBeInTheDocument();
  expect(api.customer).toHaveBeenCalledTimes(2);
});

it('rule 2 — « Reprendre » resumes a failed creation step', async () => {
  api.customer.mockResolvedValue(customerFixture);
  api.stepAction.mockResolvedValue({ ...customerFixture, provisioningRunning: true });
  page();
  fireEvent.click(await screen.findByRole('button', { name: 'Reprendre' }));
  await waitFor(() => expect(api.stepAction).toHaveBeenCalledWith('3', 'route', 'resume'));
});

it('rule 14 — « Restaurer à une date » shows the window and sends the chosen moment', async () => {
  api.customer.mockResolvedValue({ ...customerFixture, hosting });
  api.restoreWindow.mockResolvedValue({ available: true, text: 'Du 08/09/2026 10:00 au 08/10/2026 12:00.' });
  api.restore.mockResolvedValue({ ...customerFixture, hosting, notice: 'Base restaurée (12 réservation(s)).' });
  page();
  expect(await screen.findByText('il y a 2 min')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Restaurer à une date' }));
  expect(await screen.findByText('Du 08/09/2026 10:00 au 08/10/2026 12:00.')).toBeInTheDocument();
  const go = screen.getByRole('button', { name: 'Restaurer' });
  expect(go).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Date et heure'), { target: { value: '2026-10-07T09:30' } });
  expect(go).toBeEnabled();
  fireEvent.click(go);
  await waitFor(() => expect(api.restore).toHaveBeenCalledWith(3, new Date('2026-10-07T09:30').toISOString()));
  expect(await screen.findByText('Base restaurée (12 réservation(s)).')).toBeInTheDocument();
});

it('rule 14 — a refused restore shows the server’s reason and keeps the dialog', async () => {
  api.customer.mockResolvedValue({ ...customerFixture, hosting });
  api.restoreWindow.mockResolvedValue({ available: true, text: 'Du 08/09/2026 10:00 au 08/10/2026 12:00.' });
  api.restore.mockRejectedValue(new Error('Mise à jour de la flotte en cours : restauration impossible avant sa fin.'));
  page();
  fireEvent.click(await screen.findByRole('button', { name: 'Restaurer à une date' }));
  fireEvent.change(await screen.findByLabelText('Date et heure'), { target: { value: '2026-10-07T09:30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Restaurer' }));
  expect(await screen.findByText('Mise à jour de la flotte en cours : restauration impossible avant sa fin.')).toBeInTheDocument();
  expect(screen.getByLabelText('Date et heure')).toBeInTheDocument();
});
