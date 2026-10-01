import { vi } from 'vitest';
/**
 * « Indemnités d'annulation » — specs/plugins-phase-2-hosts.md rule 21 (P7). The core page of Suivi
 * financier: a month picker in the action bar, the admin's actions, the accountant's read-only view.
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getCancellationCompensations: vi.fn(),
    receiveCancellationCompensation: vi.fn(),
    updateCancellationCompensation: vi.fn(),
    createCancellationCompensation: vi.fn(),
    reopenCancellationCompensation: vi.fn(),
    deleteCancellationCompensation: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: vi.fn() }));

import api from '../../api';
import { useAuth } from '../../hooks/useAuth';
import CompensationsPage from '../CompensationsPage';

const PAYLOAD = {
  pending: [{
    id: 1, status: 'pending', clientName: 'Claire Notin', propertyName: 'Le Lodge', platform: 'Booking',
    startDate: '2026-11-14', endDate: '2026-11-16', expectedAmount: 48, expectedDate: '2026-10-12',
    receivedAmount: null, receivedDate: null, overdue: false, notes: '',
  }],
  received: [{
    id: 2, status: 'received', clientName: 'Paul Nguyen', propertyName: 'Le Lodge', platform: 'Airbnb',
    startDate: '2026-09-01', endDate: '2026-09-05', expectedAmount: 120, expectedDate: '2026-09-15',
    receivedAmount: 120, receivedDate: '2026-09-18', overdue: false, notes: '',
  }],
  totals: { pendingExpected: 48, receivedInMonth: 120 },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getCancellationCompensations.mockResolvedValue(PAYLOAD);
  api.deleteCancellationCompensation.mockResolvedValue({ ok: true });
});

function renderPage(roles) {
  useAuth.mockReturnValue({ user: { roles } });
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/finance/indemnites?month=9&year=2026']}>
        <DialogProvider><CompensationsPage /></DialogProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

test('specs/plugins-phase-2-hosts.md rule 21 — the month picker drives the banked list; the pending list ignores it', async () => {
  const user = userEvent.setup();
  renderPage(['admin']);
  await waitFor(() => expect(api.getCancellationCompensations).toHaveBeenCalledWith(9, 2026));
  expect(await screen.findByText('Encaissées en septembre 2026')).toBeInTheDocument();
  expect(screen.getAllByText('Septembre 2026').length).toBeGreaterThan(0);

  // The control exists twice in the DOM — centred in the bar on sm+, on its own strip on xs.
  await user.click(screen.getAllByRole('button', { name: 'Mois suivant' })[0]);
  await waitFor(() => expect(api.getCancellationCompensations).toHaveBeenLastCalledWith(10, 2026));
  expect(await screen.findByText('Encaissées en octobre 2026')).toBeInTheDocument();

  await user.click(screen.getAllByRole('button', { name: 'Mois précédent' })[0]);
  await user.click(screen.getAllByRole('button', { name: 'Mois précédent' })[0]);
  await waitFor(() => expect(api.getCancellationCompensations).toHaveBeenLastCalledWith(8, 2026));
  expect(screen.getByText(/Claire Notin/)).toBeInTheDocument();
});

test('specs/plugins-phase-2-hosts.md rule 21 — the admin adds from the bar, and banks, reopens, edits and deletes in the lists', async () => {
  const user = userEvent.setup();
  renderPage(['admin']);
  expect(await screen.findByText(/Paul Nguyen/)).toBeInTheDocument();

  expect(screen.getAllByRole('button', { name: /encaisser/i }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole('button', { name: /rouvrir/i }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole('button', { name: /modifier/i }).length).toBeGreaterThan(0);

  await user.click(screen.getAllByRole('button', { name: /supprimer/i })[0]);
  const confirm = await screen.findByRole('dialog', { name: /supprimer cette indemnité/i });
  await user.click(within(confirm).getByRole('button', { name: 'Supprimer' }));
  await waitFor(() => expect(api.deleteCancellationCompensation).toHaveBeenCalledWith(1));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  await user.click(screen.getByRole('button', { name: 'Ajouter' }));
  expect(await screen.findByText("Ajouter une indemnité d'annulation")).toBeInTheDocument();
});

test('specs/plugins-phase-2-hosts.md rule 21 — the accountant reads both lists, with no action anywhere', async () => {
  renderPage(['accountant']);
  expect(await screen.findByText(/Paul Nguyen/)).toBeInTheDocument();
  expect(screen.getByText(/Claire Notin/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
  for (const name of [/encaisser/i, /rouvrir/i, /modifier/i, /supprimer/i]) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  }
  // The month still moves for them.
  expect(screen.getAllByRole('button', { name: 'Mois suivant' }).length).toBeGreaterThan(0);
});
