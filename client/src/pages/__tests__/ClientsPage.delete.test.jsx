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
 * Also covers the « Supprimer » button of the client sheet — the only way to delete since the
 * amendment of 2026-10-28 (clients.md rule 15: no trash icon in the list rows) — and the removal of
 * the Notes column from the list.
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
import { directoryClient, directoryPayload, oneGroup } from './clientsDirectoryFixtures';

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

// The list has no trash icon any more: the confirmation is reached through the client sheet.
async function openDeleteDialogFromSheet(user) {
  fireEvent.click(await screen.findByRole('button', { name: /Dupont/ }));
  await screen.findByText('Modifier le client');
  await user.click(screen.getByRole('button', { name: 'Supprimer' }));
  await screen.findByText(CONFIRM_TITLE);
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn?.mockReset?.());
  api.getClientsDirectory.mockResolvedValue(directoryPayload({ groups: [oneGroup([directoryClient(SAMPLE_CLIENT)])] }));
  api.getClient.mockResolvedValue(SAMPLE_CLIENT);
  api.getClientDeleteImpact.mockResolvedValue({
    client: SAMPLE_CLIENT, reservationsCount: 0, reservations: [], devisCount: 0, devis: [],
  });
  api.updateClient.mockResolvedValue(SAMPLE_CLIENT);
  api.createClient.mockResolvedValue(SAMPLE_CLIENT);
  api.deleteClient.mockResolvedValue({ ok: true });
});

describe('ClientsPage — the list rows carry no note and no delete icon (clients.md rule 15)', () => {
  test('a row shows the name and its stay, never the note, and has no « Supprimer » button', async () => {
    renderAt('/clients');
    await screen.findByText(/Dupont/);

    expect(screen.queryByText(/Client fidèle/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
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
    await screen.findByText(/Dupont/);

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
    await openDeleteDialogFromSheet(user);

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

  test('deleting again from the sheet of the same client re-opens the dialog', async () => {
    const user = userEvent.setup();
    renderAt('/clients');
    await openDeleteDialogFromSheet(user);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByText(CONFIRM_TITLE)).not.toBeInTheDocument());

    await openDeleteDialogFromSheet(user);
    expect(screen.getByText(CONFIRM_TITLE)).toBeInTheDocument();
    expect(getUrl()).toBe('/clients?deleteClientId=42');
  });

  test('« Confirmer la suppression » deletes once and leaves no dialog behind', async () => {
    const user = userEvent.setup();
    renderAt('/clients');
    await openDeleteDialogFromSheet(user);
    const impactCallsBeforeDelete = api.getClientDeleteImpact.mock.calls.length;
    api.getClientsDirectory.mockResolvedValue(directoryPayload());

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

// specs/clients.md rule 16 — cancelled and set-aside stays are listed with a badge, and a delete the
// server will refuse shows its refusal instead of the confirmation lists.
describe('ClientsPage — protected history (clients.md rule 16)', () => {
  const stay = (over) => ({
    id: 1, clientId: 42, propertyId: 1, propertyName: 'Gîte', startDate: '2099-06-01', endDate: '2099-06-04',
    nights: 3, platform: 'Direct', finalPrice: 300, adults: 2, children: 0, teens: 0, babies: 0, kind: 'reservation', ...over,
  });

  test('the sheet badges a cancelled and a set-aside stay, and not a live one', async () => {
    api.getClientDeleteImpact.mockResolvedValue({
      client: SAMPLE_CLIENT,
      reservationsCount: 3,
      reservations: [stay({ id: 1 }), stay({ id: 2, kind: 'cancelled' }), stay({ id: 3, kind: 'superseded' })],
      devisCount: 0, devis: [], blocker: null,
    });
    renderAt('/clients?clientId=42');
    await screen.findByText('Modifier le client');

    expect(await screen.findByText('Annulée')).toBeInTheDocument();
    expect(screen.getByText('Écartée')).toBeInTheDocument();
    expect(screen.getAllByText('Gîte')).toHaveLength(3);
  });

  test('a delete the server refuses shows the refusal before any confirmation, and cannot be confirmed', async () => {
    const user = userEvent.setup();
    api.getClientDeleteImpact.mockResolvedValue({
      client: SAMPLE_CLIENT,
      reservationsCount: 1,
      reservations: [stay({ id: 2, kind: 'cancelled' })],
      devisCount: 0, devis: [], blocker: 'Ce client a une réservation annulée.',
    });
    renderAt('/clients');
    await openDeleteDialogFromSheet(user);

    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('Ce client a une réservation annulée.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/Réservations qui seront supprimées/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Confirmer la suppression' })).toBeDisabled();
    expect(api.deleteClient).not.toHaveBeenCalled();
  });
});
