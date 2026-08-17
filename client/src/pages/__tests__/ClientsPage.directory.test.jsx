import { vi } from 'vitest';
/**
 * specs/clients-upcoming-past-directory.md §3 (issue #19) — the Clients page reads two lists from the
 * server: « À venir » / « Passés » as tabs (with their counts), a « Séjour » column, and sortable
 * headers. The page holds only the tab, the search and the sort — everything else is server-shaped.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getClients: vi.fn(),
    getClientsDirectory: vi.fn(),
    getClientDeleteImpact: vi.fn(),
    createClient: vi.fn(),
    updateClient: vi.fn(),
    deleteClient: vi.fn(),
    getOrphanClientsPreview: vi.fn(),
    cleanupOrphanClientsByIds: vi.fn(),
  },
}));

vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => ({ confirm: vi.fn().mockResolvedValue(false), alert: vi.fn().mockResolvedValue() }),
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

import api from '../../api';
import ClientsPage from '../ClientsPage';

const UPCOMING = {
  items: [
    { id: 1, lastName: 'Proche', firstName: 'Alice', email: 'a@x.fr', phone: '', city: '', postalCode: '', bucket: 'upcoming', stayDate: '2026-08-20' },
    { id: 2, lastName: 'Sansdate', firstName: 'Bob', email: '', phone: '', city: '', postalCode: '', bucket: 'upcoming', stayDate: null },
  ],
  counts: { upcoming: 2, past: 7 },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <ClientsPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const lastCall = () => api.getClientsDirectory.mock.calls[api.getClientsDirectory.mock.calls.length - 1][0];

beforeEach(() => {
  vi.clearAllMocks();
  api.getClientsDirectory.mockResolvedValue(UPCOMING);
});

test('opens on « À venir », both tabs carry their count, and the read asks the server for it', async () => {
  renderPage();
  expect(await screen.findByRole('tab', { name: 'À venir (2)' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Passés (7)' })).toBeInTheDocument();
  // Default order of the « à venir » tab: the soonest arrival first.
  expect(lastCall()).toMatchObject({ bucket: 'upcoming', sort: 'stayDate', dir: 'asc' });
});

test('the « Séjour » column shows the qualifying date, and « — » without one', async () => {
  renderPage();
  expect(await screen.findByText('20/08/2026')).toBeInTheDocument();
  expect(screen.getAllByText('—').length).toBeGreaterThan(0);
});

test('switching to « Passés » reloads that bucket on its own default order', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('tab', { name: 'Passés (7)' }));
  await waitFor(() => expect(lastCall()).toMatchObject({ bucket: 'past', sort: 'stayDate', dir: 'desc' }));
});

test('clicking a column header sorts server-side and flips the direction on the second click', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Nom/ }));
  await waitFor(() => expect(lastCall()).toMatchObject({ sort: 'lastName', dir: 'asc' }));
  fireEvent.click(screen.getByRole('button', { name: /Nom/ }));
  await waitFor(() => expect(lastCall()).toMatchObject({ sort: 'lastName', dir: 'desc' }));
});

test('the search rides the same read, so both counts describe it', async () => {
  renderPage();
  await screen.findByText('Proche');
  fireEvent.change(screen.getByPlaceholderText(/Rechercher un client/), { target: { value: 'dupont' } });
  await waitFor(() => expect(lastCall()).toMatchObject({ q: 'dupont', bucket: 'upcoming' }));
});
