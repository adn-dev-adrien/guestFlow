import { vi } from 'vitest';
/**
 * ClientsPage — DS phase-6 sweep (specs/ds-sweep-reservations.md rule 15): the DataPageScaffold now
 * receives useCrudResource's loading/error, so a failed list surfaces a retryable ErrorAlert instead
 * of a silently-empty table.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
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
import { directoryPayload } from './clientsDirectoryFixtures';

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <ClientsPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

test('a failed clients list shows the retryable ErrorAlert (not a silent empty table)', async () => {
  api.getClientsDirectory.mockRejectedValue(new Error('boom'));
  renderPage();
  expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  // The empty-table copy must NOT be what the operator sees on a failure.
  expect(screen.queryByText('Aucune arrivée prévue.')).not.toBeInTheDocument();
});

test('an empty clients list shows the empty state, not an error', async () => {
  api.getClientsDirectory.mockResolvedValue(directoryPayload());
  renderPage();
  expect(await screen.findByText('Aucune arrivée prévue.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
});

// specs/ds-components.md rule 25 — the button speaks French: « Nettoyer les clients », not « Cleanup clients ».
// Since the amendment of 2026-10-28 (rule 19) it lives in the « Sans séjour » view.
test('the cleanup button is labelled in French', async () => {
  api.getClientsDirectory.mockResolvedValue(directoryPayload({ view: 'none', orphanCount: 2 }));
  render(
    <MemoryRouter initialEntries={['/clients?vue=sans-sejour']}>
      <ThemeProvider theme={theme}>
        <ClientsPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByRole('button', { name: 'Nettoyer les clients' })).toBeInTheDocument();
  expect(screen.queryByText('Cleanup clients')).not.toBeInTheDocument();
});
