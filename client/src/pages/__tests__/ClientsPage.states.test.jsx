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
  expect(screen.queryByText('Aucun client trouvé')).not.toBeInTheDocument();
});

test('an empty clients list shows the empty state, not an error', async () => {
  api.getClientsDirectory.mockResolvedValue({ items: [], counts: { upcoming: 0, past: 0 } });
  renderPage();
  expect(await screen.findByText('Aucun client trouvé')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
});
