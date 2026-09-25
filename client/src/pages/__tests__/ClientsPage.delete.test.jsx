/**
 * ClientsPage — deletion path (specs/clients.md §3 rules 6, 10 and 11, §6).
 *
 * Rule 10 — « Supprimer » in the client sheet opens the shared confirmation.
 * Rule 11 — that confirmation closes when asked, and never re-enters on its own.
 *
 * Bug fixed 2026-09-25: the `?deleteClientId=` watch effect re-opened the confirmation dialog it
 * had just closed, because React Router flushes `setSearchParams` a render after the component's
 * own state. « Annuler » never closed, and after « Confirmer la suppression » the dialog came back
 * asking the server about a client that no longer existed — « Client non trouvé », as if the
 * deletion had already happened. The fix mirrors the edit-side `lastHandledClientIdRef`
 * (see `ClientsPage.save-cancel.test.jsx`).
 *
 * Also covers the « Supprimer » button added to the client sheet, and the removal of the Notes
 * column from the list.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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
  notes: 'Client fidèle, arrive toujours en retard',
};

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

const CONFIRM_TITLE = 'Confirmer la suppression du client';

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

describe('ClientsPage — the list no longer carries the Notes column', () => {
  test('the table headers stop at Ville + Actions, and the note is not rendered in the row', async () => {
    renderAt('/clients');
    await screen.findByText('Dupont');

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent.trim());
    expect(headers).toEqual(['Nom', 'Prénom', 'Séjour', 'Email', 'Téléphone', 'CP', 'Ville', 'Actions']);
    expect(screen.queryByText(/Client fidèle/)).not.toBeInTheDocument();
  });
});

describe('ClientsPage — deleting from the client sheet', () => {
  test('the sheet carries a « Supprimer » button that hands over to the confirmation dialog', async () => {
    const user = userEvent.setup();
    renderAt('/clients?clientId=42');
    await screen.findByText('Modifier le client');

    await user.click(screen.getByRole('button', { name: 'Supprimer' }));

    expect(await screen.findByText(CONFIRM_TITLE)).toBeInTheDocument();
    // The sheet closed and handed the client over: one dialog, one client id in the URL.
    await waitFor(() => {
      expect(screen.queryByText('Modifier le client')).not.toBeInTheDocument();
    });
    expect(getUrl()).toBe('/clients?deleteClientId=42');
    expect(api.deleteClient).not.toHaveBeenCalled();
  });

  test('a new client (no id) gets no « Supprimer » button', async () => {
    const user = userEvent.setup();
    renderAt('/clients');
    await screen.findByText('Dupont');

    await user.click(screen.getByRole('button', { name: /Nouveau client/ }));
    await screen.findByText('Nouveau client', { selector: 'h2' });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
  });
});

describe('ClientsPage — the confirmation dialog closes when asked (2026-09-25 regression)', () => {
  test('« Annuler » closes the dialog AND clears ?deleteClientId — it must not re-open', async () => {
    const user = userEvent.setup();
    renderAt('/clients');
    const row = (await screen.findByText('Dupont')).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'Supprimer' }));
    await screen.findByText(CONFIRM_TITLE);

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler' }));

    await waitFor(() => {
      expect(screen.queryByText(CONFIRM_TITLE)).not.toBeInTheDocument();
    });
    expect(getUrl()).toBe('/clients');
    // The old race re-opened the dialog, which re-fetched the impact. Give the effect a chance
    // to misbehave, then prove it stayed closed.
    await waitFor(() => expect(screen.queryByText(CONFIRM_TITLE)).not.toBeInTheDocument());
    expect(api.deleteClient).not.toHaveBeenCalled();
  });

  test('clicking the trash again on the same client re-opens the dialog', async () => {
    const user = userEvent.setup();
    renderAt('/clients');
    const row = (await screen.findByText('Dupont')).closest('tr');

    fireEvent.click(within(row).getByRole('button', { name: 'Supprimer' }));
    await screen.findByText(CONFIRM_TITLE);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByText(CONFIRM_TITLE)).not.toBeInTheDocument());

    fireEvent.click(within(row).getByRole('button', { name: 'Supprimer' }));
    expect(await screen.findByText(CONFIRM_TITLE)).toBeInTheDocument();
    expect(getUrl()).toBe('/clients?deleteClientId=42');
  });

  test('« Confirmer la suppression » deletes once and leaves no dialog behind', async () => {
    const user = userEvent.setup();
    renderAt('/clients');
    const row = (await screen.findByText('Dupont')).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'Supprimer' }));
    await screen.findByText(CONFIRM_TITLE);
    const impactCallsBeforeDelete = api.getClientDeleteImpact.mock.calls.length;
    api.getClientsDirectory.mockResolvedValue({ items: [], counts: { upcoming: 0, past: 0 } });

    await user.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));

    await waitFor(() => {
      expect(api.deleteClient).toHaveBeenCalledWith(42, { force: true });
    });
    await waitFor(() => {
      expect(screen.queryByText(CONFIRM_TITLE)).not.toBeInTheDocument();
    });
    expect(getUrl()).toBe('/clients');
    // The bug: the dialog re-opened on a deleted client and asked the server for its impact again,
    // which answered 404 « Client non trouvé ».
    expect(api.getClientDeleteImpact.mock.calls.length).toBe(impactCallsBeforeDelete);
    expect(api.deleteClient).toHaveBeenCalledTimes(1);
  });
});
