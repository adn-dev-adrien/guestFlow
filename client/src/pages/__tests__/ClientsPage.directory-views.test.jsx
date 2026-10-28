import { vi } from 'vitest';
/**
 * specs/clients-upcoming-past-directory.md rules 12, 13, 16-20, 22 (amendment of 2026-10-28) — the Clients
 * page renders the three views the server resolved, in the groups it ordered. The page holds the view
 * (in the URL), the search and the sort, and computes none of the rest.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getClients: vi.fn(),
    getClient: vi.fn(),
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
import { directoryClient, directoryPayload, oneGroup } from './clientsDirectoryFixtures';

function Url() {
  const loc = useLocation();
  return <div data-testid="url">{`${loc.pathname}${loc.search}`}</div>;
}

function renderPage(url = '/clients') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ThemeProvider theme={theme}>
        <Url />
        <ClientsPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const lastCall = () => api.getClientsDirectory.mock.calls[api.getClientsDirectory.mock.calls.length - 1][0];
const COUNTS = { upcoming: 9, past: 49, none: 20 };

const UPCOMING = directoryPayload({
  counts: COUNTS,
  groups: [
    { key: 'inStay', label: 'En séjour', items: [directoryClient({ id: 1, lastName: 'Morel', firstName: 'Inès', stayCount: 3, whenLabel: 'En séjour · départ le 08/11', email: 'ines@example.fr', phone: '06 12 34 56 78' })] },
    oneGroup([directoryClient({ id: 2, lastName: 'Bernard', firstName: 'Luc', whenLabel: 'Arrive dans 5 j' })]),
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getClientsDirectory.mockResolvedValue(UPCOMING);
  api.getClient.mockResolvedValue(directoryClient({ id: 77, lastName: 'Ailleurs' }));
  api.getClientDeleteImpact.mockResolvedValue({ reservations: [], devis: [] });
});

test('rule 12 — opens on « À venir » without ?vue=, tabs carry the three counts, the read asks for that view', async () => {
  renderPage();
  expect(await screen.findByRole('tab', { name: 'À venir (9)' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Passés (49)' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Sans séjour (20)' })).toBeInTheDocument();
  expect(lastCall()).toMatchObject({ view: 'upcoming', sort: 'stayDate' });
});

test('rule 12 — ?vue=passes opens Passés; switching view writes the URL and drops it for « À venir »', async () => {
  renderPage('/clients?vue=passes');
  await waitFor(() => expect(lastCall()).toMatchObject({ view: 'past' }));
  expect(await screen.findByRole('tab', { name: /^Passés/ })).toHaveAttribute('aria-selected', 'true');

  fireEvent.click(screen.getByRole('tab', { name: /^Sans séjour/ }));
  await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/clients?vue=sans-sejour'));
  await waitFor(() => expect(lastCall()).toMatchObject({ view: 'none' }));

  fireEvent.click(screen.getByRole('tab', { name: /^À venir/ }));
  await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/clients'));
  renderPage('/clients?vue=inconnu');
  await waitFor(() => expect(lastCall()).toMatchObject({ view: 'upcoming' }));
});

test('rule 13 — renders the server groups, labels and counts, in the server order, without regrouping', async () => {
  renderPage();
  await screen.findByText('Morel Inès');
  const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  expect(headings).toEqual(['En séjour1', '7 prochains jours1']);
  const names = screen.getAllByTestId('client-row').map((r) => within(r).getByRole('button').textContent);
  expect(names).toEqual(['Morel Inès', 'Bernard Luc']);
});

test('rules 14-15 — the row prints the server label, the stay, the platform and « N séjours » from 2', async () => {
  renderPage();
  const row = (await screen.findByText('Morel Inès')).closest('[data-testid="client-row"]');
  expect(within(row).getByText('En séjour · départ le 08/11')).toBeInTheDocument();
  expect(within(row).getByText('La Granja')).toBeInTheDocument();
  expect(within(row).getByText(/06\/11\/2026 → 08\/11\/2026 · 2 nuits/)).toBeInTheDocument();
  expect(within(row).getByText('Booking')).toBeInTheDocument();
  expect(within(row).getByText('3 séjours')).toBeInTheDocument();
  const other = screen.getByText('Bernard Luc').closest('[data-testid="client-row"]');
  expect(within(other).queryByText(/séjours/)).not.toBeInTheDocument();
});

test('rule 16 — a search with no match in the open view offers the view that has them', async () => {
  api.getClientsDirectory.mockResolvedValue(directoryPayload({
    counts: { upcoming: 0, past: 2, none: 0 }, elsewhere: { view: 'past', count: 2 },
  }));
  renderPage();
  fireEvent.change(await screen.findByRole('searchbox', { name: /Rechercher un client/ }), { target: { value: 'dupont' } });
  expect(await screen.findByText('Aucun résultat dans À venir')).toBeInTheDocument();
  await waitFor(() => expect(lastCall()).toMatchObject({ q: 'dupont' }));

  fireEvent.click(screen.getByRole('button', { name: '2 dans Passés' }));
  await waitFor(() => expect(lastCall()).toMatchObject({ view: 'past', q: 'dupont' }));
  expect(screen.getByTestId('url').textContent).toBe('/clients?vue=passes');
});

test('rule 17 — the « Trier » select reloads with sort=name', async () => {
  renderPage();
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: /Trier/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Nom' }));
  await waitFor(() => expect(lastCall()).toMatchObject({ sort: 'name' }));
});

test('rule 18 — the phone link does not open the sheet, the row does; no delete button in a row', async () => {
  renderPage();
  const row = (await screen.findByText('Morel Inès')).closest('[data-testid="client-row"]');
  const phone = within(row).getAllByRole('link', { name: /06 12 34 56 78|Appeler/ })[0];
  expect(phone).toHaveAttribute('href', 'tel:06 12 34 56 78');
  expect(within(row).getByRole('link', { name: 'ines@example.fr' })).toHaveAttribute('href', 'mailto:ines@example.fr');
  fireEvent.click(phone);
  expect(screen.queryByText('Modifier le client')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();

  fireEvent.click(within(row).getByRole('button', { name: /Morel/ }));
  expect(await screen.findByText('Modifier le client')).toBeInTheDocument();
});

test('rule 19 — « Nettoyer les clients » only in « Sans séjour », hidden when no client would be offered', async () => {
  renderPage();
  await screen.findByText('Morel Inès');
  expect(screen.queryByRole('button', { name: 'Nettoyer les clients' })).not.toBeInTheDocument();

  api.getClientsDirectory.mockResolvedValue(directoryPayload({
    view: 'none', orphanCount: 18, groups: [oneGroup([directoryClient({ id: 5, stay: null, bucket: 'none', whenLabel: 'Créé le 12/10/2026' })], 'Aucune réservation', 'nothing')],
  }));
  fireEvent.click(screen.getByRole('tab', { name: /^Sans séjour/ }));
  expect(await screen.findByText('18 clients sans réservation ni devis')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Nettoyer les clients' })).toBeInTheDocument();

  api.getClientsDirectory.mockResolvedValue(directoryPayload({ view: 'none', orphanCount: 0 }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'x' } });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Nettoyer les clients' })).not.toBeInTheDocument());
});

test('rule 20 — the empty views say what to do', async () => {
  api.getClientsDirectory.mockResolvedValue(directoryPayload({ counts: { upcoming: 0, past: 49, none: 0 } }));
  renderPage();
  expect(await screen.findByText('Aucune arrivée prévue.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Voir les passés (49)' }));
  await waitFor(() => expect(lastCall()).toMatchObject({ view: 'past' }));

  api.getClientsDirectory.mockResolvedValue(directoryPayload({ view: 'none' }));
  fireEvent.click(screen.getByRole('tab', { name: /^Sans séjour/ }));
  expect(await screen.findByText('Tous les clients ont un séjour.')).toBeInTheDocument();

  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
  expect(await screen.findByText('Aucun client trouvé.')).toBeInTheDocument();
});

test('rule 22 — a 120-character name stays on one line with its full value in title; an empty first name shows the last name alone', async () => {
  const long = 'Dupont-Delacroix-de-la-Tour-d-Auvergne-Lauraguais-Saint-Étienne-de-Montluc-le-Grand-Marquis-de-Carabas-Esquire-et-Co';
  api.getClientsDirectory.mockResolvedValue(directoryPayload({
    groups: [oneGroup([
      directoryClient({ id: 1, lastName: long, firstName: 'Anne-Sophie' }),
      directoryClient({ id: 2, lastName: 'Solo', firstName: '' }),
      directoryClient({ id: 3, lastName: '', firstName: '' }),
    ])],
  }));
  renderPage();
  const name = await screen.findByRole('button', { name: new RegExp(long.slice(0, 20)) });
  expect(name).toHaveAttribute('title', `${long} Anne-Sophie`);
  expect(getComputedStyle(name).whiteSpace).toBe('nowrap');
  expect(screen.getByRole('button', { name: 'Solo' })).toBeInTheDocument();
  expect(screen.getAllByText('?').length).toBe(1);
});

test('rule 12 — a ?clientId= of a client outside the open view is fetched and its sheet opens', async () => {
  renderPage('/clients?clientId=77');
  expect(await screen.findByText('Modifier le client')).toBeInTheDocument();
  expect(api.getClient).toHaveBeenCalledWith(77);
});
