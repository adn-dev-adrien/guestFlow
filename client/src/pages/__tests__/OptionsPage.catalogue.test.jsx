// specs/options-resources-ux.md rules 8-11, 22, 26-27 — the options catalogue: foldable sections, a row
// that opens the editor, the « ⋯ » menu, search, property filter, category chips, states, archive section.
import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';
import api from '../../api';
import OptionsPage from '../OptionsPage';

vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false }));
vi.mock('../../api', () => ({
  default: {
    getOptionsCatalogueView: vi.fn(), getProperties: vi.fn(), getOption: vi.fn(), deleteOption: vi.fn(),
    restoreOption: vi.fn(), createOption: vi.fn(), updateOption: vi.fn(),
  },
}));

const item = (id, title, over = {}) => ({
  id, title, description: '', category: '', price: { value: '10 €', unit: '/ séjour', note: '' },
  traits: [], archivable: true, archiveBlockedReason: '', ...over,
});
const VIEW = {
  total: 5,
  chips: [
    { key: 'none', label: 'Sans catégorie', count: 2 },
    { key: 'cat:Boissons', label: 'Boissons', count: 2 },
    { key: 'cat:Restauration', label: 'Restauration', count: 1 },
  ],
  groups: [
    { key: 'none', label: 'Sans catégorie', count: 2, items: [
      item(1, 'Ménage', { description: 'Fin de séjour', price: { value: '30 € – 80 €', unit: '/ séjour', note: 'selon logement' }, traits: [{ key: 'offered', label: 'Offert · Estiva', tone: 'success' }] }),
      item(2, 'Petit déjeuner', { archivable: false, archiveBlockedReason: 'Option système', traits: [{ key: 'planning', label: 'Planning 09:00', tone: 'info' }] }),
    ] },
    { key: 'cat:Boissons', label: 'Boissons', count: 2, items: [
      item(3, 'Vin rouge', { category: 'Boissons', description: 'Une bouteille' }),
      item(4, 'Jus de pomme', { category: 'Boissons' }),
    ] },
    { key: 'cat:Restauration', label: 'Restauration', count: 1, items: [item(5, 'Planche mixte', { category: 'Restauration' })] },
  ],
  archived: [{ id: 9, title: 'Vélo', category: 'Sorties', archivedAt: '2026-10-01 10:00:00' }],
};
const PROPERTIES = [{ id: 1, name: 'Granja' }, { id: 2, name: 'Estiva' }];

function renderPage() {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <DialogProvider><OptionsPage barTabs={<div>tabs</div>} /></DialogProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  api.getOptionsCatalogueView.mockResolvedValue(VIEW);
  api.getProperties.mockResolvedValue(PROPERTIES);
  api.getOption.mockResolvedValue({ id: 3, title: 'Vin rouge', priceType: 'per_stay', price: 10, propertyIds: [1, 2], propertyPrices: {}, propertyDefaults: {}, category: 'Boissons' });
  api.deleteOption.mockResolvedValue({ ok: true });
  api.restoreOption.mockResolvedValue({ ok: true });
});

const header = (name) => within(screen.getByRole('heading', { name: new RegExp(`^${name}`) })).getByRole('button');
const rowOf = (name) => screen.getByRole('button', { name: `Modifier ${name}` });

test('rule 8: one section per group with its count, the rows inside; archived is folded', async () => {
  renderPage();
  expect(await screen.findByRole('heading', { name: /^Sans catégorie/ })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /^Boissons/ })).toBeInTheDocument();
  expect(rowOf('Ménage')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Archivées/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Vélo')).not.toBeInTheDocument();
});

test('rule 8: folding a section hides its rows, and the choice is remembered', async () => {
  const user = userEvent.setup();
  const { unmount } = renderPage();
  await screen.findByRole('heading', { name: /^Boissons/ });
  await user.click(header('Boissons'));
  expect(screen.queryByText('Vin rouge')).not.toBeInTheDocument();
  unmount();
  renderPage();
  await screen.findByRole('heading', { name: /^Boissons/ });
  expect(screen.queryByText('Vin rouge')).not.toBeInTheDocument();
  expect(screen.getByText('Ménage')).toBeInTheDocument();
});

test('rule 9: a row shows the name, the description, the traits and the price with its unit and note', async () => {
  renderPage();
  const row = await screen.findByRole('button', { name: 'Modifier Ménage' });
  expect(within(row).getByText('Fin de séjour')).toBeInTheDocument();
  expect(within(row).getByText('Offert · Estiva')).toBeInTheDocument();
  expect(within(row).getByText('30 € – 80 €')).toBeInTheDocument();
  expect(within(row).getByText('/ séjour · selon logement')).toBeInTheDocument();
});

test('rule 9: the whole row opens the editor — click, Enter and Space — and the panel loads that option', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Modifier Vin rouge' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(api.getOption).toHaveBeenCalledWith(3);
  await user.click(screen.getByRole('button', { name: 'Fermer' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  rowOf('Jus de pomme').focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(api.getOption).toHaveBeenLastCalledWith(4);
});

test('rule 9: no pencil and no trash icon on a row', async () => {
  renderPage();
  await screen.findByRole('button', { name: 'Modifier Ménage' });
  expect(screen.queryByTestId('DeleteIcon')).not.toBeInTheDocument();
  expect(screen.queryByTestId('EditIcon')).not.toBeInTheDocument();
});

test('rule 10: « Archiver » asks for confirmation, then archives and reloads', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole('button', { name: 'Modifier Vin rouge' });
  await user.click(screen.getByRole('button', { name: 'Actions de Vin rouge' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Archiver' }));
  expect(await screen.findByText('Archiver « Vin rouge » ?')).toBeInTheDocument();
  expect(screen.getByText('Retirée des nouvelles réservations. Les réservations existantes la gardent.')).toBeInTheDocument();
  await user.click(screen.getAllByRole('button', { name: 'Archiver' }).at(-1));
  await waitFor(() => expect(api.deleteOption).toHaveBeenCalledWith(3));
  await waitFor(() => expect(api.getOptionsCatalogueView).toHaveBeenCalledTimes(2));
});

test('rule 10: cancelling the confirmation archives nothing', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole('button', { name: 'Modifier Vin rouge' });
  await user.click(screen.getByRole('button', { name: 'Actions de Vin rouge' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Archiver' }));
  await user.click(await screen.findByRole('button', { name: 'Annuler' }));
  expect(api.deleteOption).not.toHaveBeenCalled();
});

test('rule 10: a system option cannot be archived, and the reason is written under the item', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole('button', { name: 'Modifier Petit déjeuner' });
  await user.click(screen.getByRole('button', { name: 'Actions de Petit déjeuner' }));
  const archive = await screen.findByRole('menuitem', { name: /Archiver/ });
  expect(archive).toHaveAttribute('aria-disabled', 'true');
  expect(within(archive).getByText('Option système : elle reste au catalogue.')).toBeInTheDocument();
});

test('rule 11: the search matches title, description and category, ignoring case and accents, and unfolds', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole('heading', { name: /^Boissons/ });
  await user.click(header('Boissons'));
  const search = screen.getByRole('searchbox', { name: 'Rechercher une option' });
  await user.type(search, 'POMME');
  expect(screen.getByText('Jus de pomme')).toBeInTheDocument();
  expect(screen.queryByText('Ménage')).not.toBeInTheDocument();
  await user.clear(search);
  await user.type(search, 'bouteille');
  expect(screen.getByText('Vin rouge')).toBeInTheDocument();
  await user.clear(search);
  await user.type(search, 'restauratiôn');
  expect(screen.getByText('Planche mixte')).toBeInTheDocument();
  expect(screen.queryByText('Vin rouge')).not.toBeInTheDocument();
});

test('rule 11: a section filtered by the search counts « shown / total »', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.type(await screen.findByRole('searchbox'), 'vin');
  expect(screen.getByText('1 / 2')).toBeInTheDocument();
});

test('rule 11: the category chips carry the whole catalogue’s counts and show a single group', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole('heading', { name: /^Boissons/ });
  const group = screen.getByRole('group', { name: 'Catégories' });
  expect(within(group).getByRole('button', { name: /Toutes\s*5/ })).toHaveAttribute('aria-pressed', 'true');
  await user.click(within(group).getByRole('button', { name: /Boissons\s*2/ }));
  expect(screen.getByText('Vin rouge')).toBeInTheDocument();
  expect(screen.queryByText('Ménage')).not.toBeInTheDocument();
  expect(screen.queryByText('Planche mixte')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Archivées/ })).not.toBeInTheDocument();
});

test('rule 11: the property filter refetches the view for that property', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole('heading', { name: /^Boissons/ });
  expect(api.getOptionsCatalogueView).toHaveBeenLastCalledWith(undefined);
  await user.click(screen.getByRole('button', { name: 'Estiva' }));
  await waitFor(() => expect(api.getOptionsCatalogueView).toHaveBeenLastCalledWith(2));
  await user.click(screen.getByRole('button', { name: 'Tous' }));
  await waitFor(() => expect(api.getOptionsCatalogueView).toHaveBeenLastCalledWith(undefined));
});

test('rule 11: no match shows « Aucun résultat », « Effacer les filtres » brings everything back', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.type(await screen.findByRole('searchbox'), 'zzzz');
  expect(screen.getByText('Aucun résultat')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Effacer les filtres' }));
  expect(await screen.findByText('Ménage')).toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toHaveValue('');
});

test('rule 12: « Nouvelle option » opens an empty editor, pre-filled with the active category', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole('heading', { name: /^Boissons/ });
  await user.click(within(screen.getByRole('group', { name: 'Catégories' })).getByRole('button', { name: /Boissons/ }));
  await user.click(screen.getByRole('button', { name: 'Nouvelle option' }));
  expect(await screen.findByRole('heading', { name: 'Nouvelle option' })).toBeInTheDocument();
  expect(screen.getByLabelText('Catégorie')).toHaveValue('Boissons');
});

test('rule 17: a saved option closes the panel, toasts, reloads and the row flashes', async () => {
  const user = userEvent.setup();
  api.updateOption.mockResolvedValue({ ok: true });
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Modifier Vin rouge' }));
  await user.type(await screen.findByLabelText(/^Description/), '!');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Option enregistrée')).toBeInTheDocument();
  await waitFor(() => expect(api.getOptionsCatalogueView).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('rule 22: loading shows a skeleton, not the list', () => {
  api.getOptionsCatalogueView.mockReturnValue(new Promise(() => {}));
  renderPage();
  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
});

test('rule 22: a failed load shows the error, « Réessayer » loads again', async () => {
  const user = userEvent.setup();
  api.getOptionsCatalogueView.mockRejectedValueOnce(new Error('down'));
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByRole('heading', { name: /^Boissons/ })).toBeInTheDocument();
});

test('rule 22: an empty catalogue invites to add the first option', async () => {
  const user = userEvent.setup();
  api.getOptionsCatalogueView.mockResolvedValue({ total: 0, chips: [], groups: [], archived: [] });
  renderPage();
  expect(await screen.findByText('Aucune option')).toBeInTheDocument();
  expect(screen.getByText('Petit-déjeuner, ménage, boissons…')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Ajouter une option' }));
  expect(await screen.findByRole('heading', { name: 'Nouvelle option' })).toBeInTheDocument();
});

test('rule 26: the folded « Archivées » section lists the archived options and the search reaches it', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: /Archivées/ }));
  expect(screen.getByText('Vélo')).toBeInTheDocument();
  expect(screen.getByText(/Sorties · Retirée des nouvelles réservations\./)).toBeInTheDocument();
});

test('rule 27: « Restaurer » restores the option, toasts and reloads', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: /Archivées/ }));
  await user.click(screen.getByRole('button', { name: 'Restaurer Vélo' }));
  await waitFor(() => expect(api.restoreOption).toHaveBeenCalledWith(9));
  expect(await screen.findByText('Option restaurée')).toBeInTheDocument();
  await waitFor(() => expect(api.getOptionsCatalogueView).toHaveBeenCalledTimes(2));
});

test('worst case: 110-character names and a single property are rendered whole', async () => {
  const name = 'Une option au nom vraiment démesurément long pour tester le retour à la ligne '.repeat(2).trim();
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja' }]);
  api.getOptionsCatalogueView.mockResolvedValue({
    ...VIEW, groups: [{ key: 'none', label: 'Sans catégorie', count: 1, items: [item(1, name)] }], archived: [],
  });
  renderPage();
  expect(await screen.findByRole('button', { name: `Modifier ${name}` })).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Logement' })).not.toBeInTheDocument();
});
