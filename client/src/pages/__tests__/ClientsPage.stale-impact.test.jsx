/**
 * ClientsPage — a late answer about the client the operator has left (specs/clients.md §3 rules 17, 18).
 *
 * Audit R18-C1: `handleDelete(id)` merged the `delete-impact` answer into whatever confirmation was on
 * screen. When client A's answer arrived after the operator had cancelled it and opened client B's
 * confirmation, the dialog showed A's name, stays, devis and blocker while « Confirmer la suppression »
 * deleted B. The client sheet had the same race on its stay list: B's sheet listed A's stays, and a
 * click opened A's fiche. Every answer now lands only on the request that is still the latest one.
 *
 * Rule 18 (review of PR #932): a forced deletion that fails after the operator moved on is still
 * reported, as a toast; a late orphan preview no longer reopens a cleanup popup the operator closed.
 */

import React from 'react';
import { vi } from 'vitest';
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));

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
  useToast: () => toast,
}));

import api from '../../api';
import ClientsPage from '../ClientsPage';
import { directoryClient, directoryPayload, oneGroup } from './clientsDirectoryFixtures';

const A = { id: 41, lastName: 'Alpha', firstName: 'Anne', email: '', phone: '', postalCode: '', city: '' };
const B = { id: 42, lastName: 'Bravo', firstName: 'Bob', email: '', phone: '', postalCode: '', city: '' };

const deferred = () => {
  let resolve;
  let reject;
  const p = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { p, resolve, reject };
};

const isoInDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const stay = (id, propertyName) => ({
  id, propertyName, startDate: isoInDays(30), endDate: isoInDays(34), nights: 4,
});

// Lets a late answer reach the page (and React render it) before the test looks at the screen.
const settle = () => act(() => new Promise((r) => { setTimeout(r, 30); }));

const EMPTY_SHEET = { client: null, reservations: [], devis: [] };

function renderAt(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/clients" element={<ClientsPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

function listBoth() {
  api.getClientsDirectory.mockResolvedValue(directoryPayload({ groups: [oneGroup([
    directoryClient({ ...A, stay: { ...directoryClient().stay, reservationId: 11 } }),
    directoryClient({ ...B, stay: { ...directoryClient().stay, reservationId: 12 } }),
  ])] }));
}

/**
 * `getClientDeleteImpact(id)` answers an empty impact at once, until `arm(id, promise)`: from then on
 * every call for that client returns `promise`. Arming right before « Supprimer » hands the delete
 * confirmation its own deferred answer, whatever number of calls the sheet made before.
 */
function impactAnswers() {
  const armed = {};
  api.getClientDeleteImpact.mockImplementation((id) => armed[id] || Promise.resolve(EMPTY_SHEET));
  return (id, promise) => { armed[id] = promise; };
}

async function openSheet(name) {
  fireEvent.click(await screen.findByRole('button', { name }));
  await screen.findByText('Modifier le client');
}

async function openDeleteConfirmation(user, name, arm, id, promise) {
  await openSheet(name);
  arm(id, promise);
  await user.click(screen.getByRole('button', { name: 'Supprimer' }));
  await screen.findByText('Confirmer la suppression du client');
}

async function cancelDeleteConfirmation(user) {
  await user.click(screen.getByRole('button', { name: 'Annuler' }));
  await waitFor(() => expect(screen.queryByText('Confirmer la suppression du client')).not.toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  listBoth();
  api.deleteClient.mockResolvedValue({ ok: true });
});

describe('ClientsPage — rule 17: an answer about a client the operator has left is dropped', () => {
  test('a late delete-impact answer for A never lands in B\'s confirmation, and the confirm deletes B with B\'s impact', async () => {
    const user = userEvent.setup();
    const aDelete = deferred();
    const bDelete = deferred();
    const arm = impactAnswers();
    renderAt('/clients');

    await openDeleteConfirmation(user, /Alpha/, arm, 41, aDelete.p);
    await cancelDeleteConfirmation(user);
    await openDeleteConfirmation(user, /Bravo/, arm, 42, bDelete.p);

    bDelete.resolve({ client: B, reservations: [stay(900, 'La Granja')], devis: [] });
    await screen.findByText(/Réservations qui seront supprimées \(1\)/);
    aDelete.resolve({ client: A, reservations: [], devis: [] });
    await aDelete.p;
    await settle();

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Bob Bravo');
    expect(dialog.textContent).not.toContain('Anne Alpha');
    expect(within(dialog).getByText(/Réservations qui seront supprimées \(1\)/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Confirmer la suppression' }));
    await waitFor(() => expect(api.deleteClient).toHaveBeenCalledTimes(1));
    expect(api.deleteClient).toHaveBeenCalledWith(42, { force: true });
  });

  test('B\'s confirmation stays loading (confirm disabled) when A answers first, then shows B\'s own answer', async () => {
    const user = userEvent.setup();
    const aDelete = deferred();
    const bDelete = deferred();
    const arm = impactAnswers();
    renderAt('/clients');

    await openDeleteConfirmation(user, /Alpha/, arm, 41, aDelete.p);
    await cancelDeleteConfirmation(user);
    await openDeleteConfirmation(user, /Bravo/, arm, 42, bDelete.p);

    aDelete.resolve({ client: A, reservations: [], devis: [], blocker: 'Ce client a une réservation annulée.' });
    await aDelete.p;
    await settle();

    let dialog = screen.getByRole('dialog');
    expect(dialog.textContent).not.toContain('Anne Alpha');
    expect(screen.queryByText('Suppression impossible')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Confirmer la suppression' })).toBeDisabled();

    bDelete.resolve({ client: B, reservations: [], devis: [] });
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmer la suppression' })).toBeEnabled());
    dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Bob Bravo');
  });

  test('a late delete-impact failure for A shows no error in B\'s confirmation', async () => {
    const user = userEvent.setup();
    const aDelete = deferred();
    const bDelete = deferred();
    const arm = impactAnswers();
    renderAt('/clients');

    await openDeleteConfirmation(user, /Alpha/, arm, 41, aDelete.p);
    await cancelDeleteConfirmation(user);
    await openDeleteConfirmation(user, /Bravo/, arm, 42, bDelete.p);

    bDelete.resolve({ client: B, reservations: [], devis: [] });
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Confirmer la suppression' })).toBeEnabled());
    aDelete.reject(new Error('Réseau indisponible'));
    await aDelete.p.catch(() => {});
    await settle();

    expect(screen.queryByText('Réseau indisponible')).not.toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmer la suppression' })).toBeEnabled();
  });

  test('a deletion of A that ends after the operator opened B\'s confirmation neither closes it nor shows A\'s failure in it', async () => {
    const user = userEvent.setup();
    const arm = impactAnswers();
    const aDeletion = deferred();
    api.deleteClient.mockReturnValueOnce(aDeletion.p);
    renderAt('/clients');

    await openDeleteConfirmation(user, /Alpha/, arm, 41, Promise.resolve({ client: A, reservations: [], devis: [] }));
    const dialogA = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialogA).getByRole('button', { name: 'Confirmer la suppression' })).toBeEnabled());
    await user.click(within(dialogA).getByRole('button', { name: 'Confirmer la suppression' }));
    await cancelDeleteConfirmation(user);
    await openDeleteConfirmation(user, /Bravo/, arm, 42, Promise.resolve({ client: B, reservations: [], devis: [] }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmer la suppression' })).toBeEnabled());

    aDeletion.reject(new Error('Suppression refusée'));
    await aDeletion.p.catch(() => {});
    await settle();

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Bob Bravo');
    expect(screen.queryByText('Suppression refusée')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Confirmer la suppression' })).toBeEnabled();
    expect(api.deleteClient).toHaveBeenCalledTimes(1);
    expect(api.deleteClient).toHaveBeenCalledWith(41, { force: true });
  });

  test('the sheet of B never lists A\'s stays when A\'s stay list answers late', async () => {
    const user = userEvent.setup();
    const aSheet = deferred();
    const bSheet = deferred();
    const arm = impactAnswers();
    arm(41, aSheet.p);
    arm(42, bSheet.p);
    renderAt('/clients');

    await openSheet(/Alpha/);
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByText('Modifier le client')).not.toBeInTheDocument());

    await openSheet(/Bravo/);

    aSheet.resolve({ client: A, reservations: [stay(901, 'Chalet Alpha')], devis: [] });
    await aSheet.p;
    await settle();
    expect(screen.queryByText(/Chalet Alpha/)).not.toBeInTheDocument();
    expect(screen.queryByText('Aucune réservation.')).not.toBeInTheDocument();

    bSheet.resolve({ client: B, reservations: [stay(902, 'Cabane Bravo')], devis: [] });
    expect(await screen.findByText(/Cabane Bravo/)).toBeInTheDocument();
    expect(screen.queryByText(/Chalet Alpha/)).not.toBeInTheDocument();
  });
});

describe('ClientsPage — rule 18: a superseded deletion still reports its failure, a closed cleanup popup stays closed', () => {
  test('a deletion of A that fails after the operator opened B\'s confirmation is reported as a toast', async () => {
    const user = userEvent.setup();
    const arm = impactAnswers();
    const aDeletion = deferred();
    api.deleteClient.mockReturnValueOnce(aDeletion.p);
    renderAt('/clients');

    await openDeleteConfirmation(user, /Alpha/, arm, 41, Promise.resolve({ client: A, reservations: [], devis: [] }));
    const dialogA = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialogA).getByRole('button', { name: 'Confirmer la suppression' })).toBeEnabled());
    await user.click(within(dialogA).getByRole('button', { name: 'Confirmer la suppression' }));
    await cancelDeleteConfirmation(user);
    await openDeleteConfirmation(user, /Bravo/, arm, 42, Promise.resolve({ client: B, reservations: [], devis: [] }));

    aDeletion.reject(new Error('Suppression refusée'));
    await aDeletion.p.catch(() => {});
    await settle();

    expect(toast.showError).toHaveBeenCalledTimes(1);
    expect(toast.showError).toHaveBeenCalledWith('Suppression refusée');
    expect(within(screen.getByRole('dialog')).queryByText('Suppression refusée')).not.toBeInTheDocument();
  });

  test('a deletion that fails while its own confirmation is still open shows in it, without a toast', async () => {
    const user = userEvent.setup();
    const arm = impactAnswers();
    api.deleteClient.mockRejectedValueOnce(new Error('Suppression refusée'));
    renderAt('/clients');

    await openDeleteConfirmation(user, /Alpha/, arm, 41, Promise.resolve({ client: A, reservations: [], devis: [] }));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Confirmer la suppression' })).toBeEnabled());
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer la suppression' }));

    expect(await within(dialog).findByText('Suppression refusée')).toBeInTheDocument();
    expect(toast.showError).not.toHaveBeenCalled();
  });

  test('a late orphan preview does not reopen the cleanup popup the operator closed', async () => {
    const user = userEvent.setup();
    const preview = deferred();
    api.getOrphanClientsPreview.mockReturnValueOnce(preview.p);
    api.getClientsDirectory.mockResolvedValue(directoryPayload({
      view: 'none',
      orphanCount: 1,
      groups: [oneGroup([directoryClient({ ...A, stay: null, bucket: 'none' })], 'Aucune réservation', 'nothing')],
    }));
    renderAt('/clients?vue=sans-sejour');

    await user.click(await screen.findByRole('button', { name: 'Nettoyer les clients' }));
    const popup = await screen.findByRole('dialog');
    expect(within(popup).getByText('Nettoyer la base clients')).toBeInTheDocument();
    await user.click(within(popup).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByText('Nettoyer la base clients')).not.toBeInTheDocument());

    preview.resolve({ orphans: [{ id: 41, firstName: 'Anne', lastName: 'Alpha', email: '', phone: '' }] });
    await preview.p;
    await settle();

    expect(screen.queryByText('Nettoyer la base clients')).not.toBeInTheDocument();
  });

  test('a late orphan preview failure after the popup was closed shows no toast', async () => {
    const user = userEvent.setup();
    const preview = deferred();
    api.getOrphanClientsPreview.mockReturnValueOnce(preview.p);
    api.getClientsDirectory.mockResolvedValue(directoryPayload({
      view: 'none',
      orphanCount: 1,
      groups: [oneGroup([directoryClient({ ...A, stay: null, bucket: 'none' })], 'Aucune réservation', 'nothing')],
    }));
    renderAt('/clients?vue=sans-sejour');

    await user.click(await screen.findByRole('button', { name: 'Nettoyer les clients' }));
    const popup = await screen.findByRole('dialog');
    await user.click(within(popup).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByText('Nettoyer la base clients')).not.toBeInTheDocument());

    preview.reject(new Error('Réseau indisponible'));
    await preview.p.catch(() => {});
    await settle();

    expect(toast.showError).not.toHaveBeenCalled();
  });
});
