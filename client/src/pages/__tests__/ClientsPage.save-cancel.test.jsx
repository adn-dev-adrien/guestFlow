/**
 * ClientsPage — regression coverage for the Save / Cancel race fix (PR #132, 2026-06-06).
 *
 * Bug: the URL-watch effect re-opened the edit dialog mid-close because React Router's
 * `setSearchParams` is async; the new effect tracks the last clientId acted on via
 * `lastHandledClientIdRef` so a reload caused by `useCrudResource.reload` no longer
 * re-triggers `handleOpen`.
 *
 * We assert the four scenarios live-verified in PR #132's description:
 *   t0_auto_open       — mount on /clients?clientId=N → dialog opens
 *   t1_after_save      — Enregistrer closes the dialog AND clears the URL
 *   t2_after_cancel    — Annuler closes the dialog AND clears the URL
 *   t3_reopen_same_id  — after a clean close, re-mounting with ?clientId=N reopens
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getClients: vi.fn(),
    getClientsDirectory: vi.fn(),
    getClient: vi.fn(),
    getClientDeleteImpact: vi.fn(),
    cleanupOrphanClients: vi.fn(),
    getOrphanClientsPreview: vi.fn(),
    cleanupOrphanClientsByIds: vi.fn(),
    createClient: vi.fn(),
    updateClient: vi.fn(),
    deleteClient: vi.fn(),
  },
}));

vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => ({
    confirm: vi.fn().mockResolvedValue(false),
    alert: vi.fn().mockResolvedValue(),
  }),
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}));

import api from '../../api';
import ClientsPage from '../ClientsPage';

const SAMPLE_CLIENT = {
  id: 42,
  lastName: 'Dupont',
  firstName: 'Jean',
  streetNumber: '12',
  street: 'rue des fleurs',
  postalCode: '75001',
  city: 'Paris',
  address: '12 rue des fleurs',
  phone: '0612345678',
  email: 'jean@dupont.fr',
  notes: '',
};

// Sentinel that prints the live URL so the test can assert URL state after close handlers.
function UrlSentinel() {
  const loc = useLocation();
  return <div data-testid="url">{`${loc.pathname}${loc.search}`}</div>;
}

function renderAt(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ThemeProvider theme={theme}>
      <Routes>
        <Route
          path="/clients"
          element={(
            <>
              <UrlSentinel />
              <ClientsPage />
            </>
          )}
        />
      </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

function getUrl() {
  return screen.getByTestId('url').textContent;
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn?.mockReset?.());
  api.getClientsDirectory.mockResolvedValue({ items: [SAMPLE_CLIENT], counts: { upcoming: 1, past: 0 } });
  api.getClient.mockResolvedValue(SAMPLE_CLIENT);
  api.getClientDeleteImpact.mockResolvedValue({
    client: SAMPLE_CLIENT, reservationsCount: 0, reservations: [], devisCount: 0, devis: [],
  });
  api.updateClient.mockResolvedValue(SAMPLE_CLIENT);
  api.createClient.mockResolvedValue(SAMPLE_CLIENT);
  api.deleteClient.mockResolvedValue({ ok: true });
});

describe('ClientsPage — Save / Cancel race regression (PR #132)', () => {
  test('t0: mounting on /clients?clientId=42 auto-opens the edit dialog', async () => {
    renderAt('/clients?clientId=42');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText('Modifier le client')).toBeInTheDocument();
    // Field bound to the loaded client.
    expect(await screen.findByDisplayValue('Dupont')).toBeInTheDocument();
  });

  test('t1: clicking "Enregistrer" closes the dialog AND clears ?clientId from the URL', async () => {
    const user = userEvent.setup();
    renderAt('/clients?clientId=42');
    await screen.findByText('Modifier le client');
    // The auto-open path loaded the reservations once. Snapshot the call count so the
    // post-save assertion can prove the close-handler did NOT cause a re-open + re-load.
    const reservationsCallsAfterOpen = api.getClientDeleteImpact.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(api.updateClient).toHaveBeenCalledTimes(1);
    });
    // Critical regression: the URL must clear AND the dialog must stay closed —
    // the old effect would re-open it because `clients` reloaded mid-await.
    await waitFor(() => {
      expect(screen.queryByText('Modifier le client')).not.toBeInTheDocument();
    });
    expect(getUrl()).toBe('/clients');
    // A regression of the old race would re-open the dialog → handleOpen re-fetches
    // the impact. If that ever creeps back in, this assertion fails.
    expect(api.getClientDeleteImpact.mock.calls.length).toBe(reservationsCallsAfterOpen);
  });

  test('t2: clicking "Annuler" closes the dialog AND clears ?clientId from the URL', async () => {
    const user = userEvent.setup();
    renderAt('/clients?clientId=42');
    await screen.findByText('Modifier le client');

    await user.click(screen.getByRole('button', { name: 'Annuler' }));

    await waitFor(() => {
      expect(screen.queryByText('Modifier le client')).not.toBeInTheDocument();
    });
    expect(getUrl()).toBe('/clients');
    // No write API was called.
    expect(api.updateClient).not.toHaveBeenCalled();
    expect(api.createClient).not.toHaveBeenCalled();
  });

  test('t3: re-clicking the same client row after a clean close re-opens the dialog', async () => {
    const user = userEvent.setup();
    renderAt('/clients?clientId=42');
    await screen.findByText('Modifier le client');

    // Close once.
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    await waitFor(() => {
      expect(screen.queryByText('Modifier le client')).not.toBeInTheDocument();
    });

    // Re-click the row — `lastHandledClientIdRef` was reset on URL clear, so this MUST re-open.
    const lastNameCell = await screen.findByText('Dupont');
    const row = lastNameCell.closest('tr');
    fireEvent.click(row);

    expect(await screen.findByText('Modifier le client')).toBeInTheDocument();
    expect(getUrl()).toBe('/clients?clientId=42');
  });
});
