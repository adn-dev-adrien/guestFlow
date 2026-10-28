// specs/options-resources-ux.md rules 18, 20, 21, 22 — the resource cards: stock, price lines, the lines a
// plugin adds, the editor sections, validation, deletion with its impact.
import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';
import api from '../../api';
import ResourcesPage from '../ResourcesPage';

let hourlyOn = true;
let slots = [];
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => hourlyOn }));
vi.mock('../../plugins/sdk', () => ({ useSlot: () => slots }));
vi.mock('../../api', () => ({
  default: {
    getResourcesCatalogueView: vi.fn(), getProperties: vi.fn(), getResource: vi.fn(), createResource: vi.fn(),
    updateResource: vi.fn(), deleteResource: vi.fn(), getResourceDeleteImpact: vi.fn(),
  },
}));

const PROPERTIES = [{ id: 1, name: 'Granja' }, { id: 2, name: 'Estiva' }];
const BED = {
  id: 1, name: 'Lit bébé', description: '', stock: { value: 3, label: 'en stock' }, deletable: false, footer: '',
  lines: [{ label: 'Prix', value: 'Gratuit' }, { label: 'Logements', value: 'Tous' }],
};
const BATH = {
  id: 2, name: 'Bain nordique', description: 'Chauffé au bois', stock: { value: 1, label: 'en service' }, deletable: true,
  lines: [
    { label: 'Prix', value: '30 € / h' }, { label: 'Logements', value: 'Tous' },
    { label: 'Soir', value: '50 € / h après 20:00' }, { label: 'Extérieurs', value: '50 € / h · soir 70 € / h' },
  ],
  footer: 'À l’heure · 11:00–22:00 · 1 h minimum',
};
const stored = (over = {}) => ({
  id: 2, name: 'Bain nordique', note: 'Chauffé au bois', quantity: 1, price: 30, basePrice: 30, priceType: 'per_hour',
  propertyIds: [], propertyPricing: { 2: { price: 40, freeMinutes: 60 } }, isComplex: 1, openTime: '11:00', closeTime: '22:00',
  minimumUsageMinutes: 60, ...over,
});

function renderPage() {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter><DialogProvider><ResourcesPage barTabs={<div>tabs</div>} /></DialogProvider></MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hourlyOn = true;
  slots = [];
  api.getResourcesCatalogueView.mockResolvedValue({ items: [BED, BATH] });
  api.getProperties.mockResolvedValue(PROPERTIES);
  api.getResource.mockResolvedValue(stored());
  api.getResourceDeleteImpact.mockResolvedValue({ reservationsCount: 0, bookingsCount: 0 });
  api.deleteResource.mockResolvedValue({ ok: true });
  api.updateResource.mockResolvedValue({ ok: true });
  api.createResource.mockResolvedValue({ id: 5 });
});

test('rule 18: a card shows the stock with its label and the lines the server shaped', async () => {
  renderPage();
  const card = await screen.findByRole('button', { name: 'Modifier Bain nordique' });
  expect(within(card).getByText('en service')).toBeInTheDocument();
  expect(within(card).getByText('Soir')).toBeInTheDocument();
  expect(within(card).getByText('50 € / h après 20:00')).toBeInTheDocument();
  expect(within(card).getByText('50 € / h · soir 70 € / h')).toBeInTheDocument();
  expect(within(card).getByText('À l’heure · 11:00–22:00 · 1 h minimum')).toBeInTheDocument();
  expect(within(screen.getByRole('button', { name: 'Modifier Lit bébé' })).getByText('en stock')).toBeInTheDocument();
});

test('rule 18: a stock of 1 284 is written with a French thousands separator', async () => {
  api.getResourcesCatalogueView.mockResolvedValue({ items: [{ ...BED, stock: { value: 1284, label: 'en stock' } }] });
  renderPage();
  expect(await screen.findByText(/^1\s284$/)).toBeInTheDocument();
});

test('rule 22: loading, error with retry, and the empty invitation', async () => {
  const user = userEvent.setup();
  api.getResourcesCatalogueView.mockRejectedValueOnce(new Error('down'));
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('Lit bébé')).toBeInTheDocument();
});

test('rule 22: no resource shows « Aucune ressource » and a way to add one', async () => {
  const user = userEvent.setup();
  api.getResourcesCatalogueView.mockResolvedValue({ items: [] });
  renderPage();
  expect(await screen.findByText('Aucune ressource')).toBeInTheDocument();
  expect(screen.getByText('Lit bébé, bain nordique, vélos…')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Ajouter une ressource' }));
  expect(await screen.findByRole('heading', { name: 'Nouvelle ressource' })).toBeInTheDocument();
});

test('rule 20: a card opens the editor with Général, Prix and Mails; the quantity reads « En service » for an hourly resource', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Modifier Bain nordique' }));
  expect(await screen.findByRole('heading', { name: 'Bain nordique', level: 2 })).toBeInTheDocument();
  expect(api.getResource).toHaveBeenCalledWith(2);
  const nav = screen.getByRole('navigation', { name: 'Sections' });
  expect(nav.textContent).toBe('GénéralPrixMails');
  expect(screen.getByLabelText('En service')).toHaveValue('1');
});

test('rule 20: the per-property lines carry the price and « 1re heure offerte » for an hourly resource', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Modifier Bain nordique' }));
  expect(await screen.findByLabelText('Prix · Estiva')).toHaveValue('40');
  const estiva = screen.getByRole('group', { name: 'Estiva' });
  expect(within(estiva).getByRole('checkbox', { name: '1re heure offerte' })).toBeChecked();
  expect(within(screen.getByRole('group', { name: 'Granja' })).getByRole('checkbox', { name: '1re heure offerte' })).not.toBeChecked();
});

test('rule 20: a plugin that has fields for the resource gets its own « Horaires » section', async () => {
  const user = userEvent.setup();
  slots = [{ key: 'hourly', pluginId: 'hourly-resources', appliesTo: () => true, Component: () => <div>champs horaires</div> }];
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Modifier Bain nordique' }));
  expect(await screen.findByText('champs horaires')).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Sections' }).textContent).toBe('GénéralPrixHorairesMails');
});

test('rule 20: saving sends the payload and toasts', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Modifier Bain nordique' }));
  const price = await screen.findByLabelText('Prix de base');
  await user.clear(price);
  await user.type(price, '35,5');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateResource).toHaveBeenCalled());
  const [id, payload] = api.updateResource.mock.calls[0];
  expect(id).toBe(2);
  expect(payload.price).toBe(35.5);
  expect(payload.propertyPricing).toEqual({ 2: { price: 40, freeMinutes: 60 } });
  expect(await screen.findByText('Ressource enregistrée')).toBeInTheDocument();
});

test('rule 20: a property line with a free hour and no price keeps the base price as its price', async () => {
  const user = userEvent.setup();
  api.getResource.mockResolvedValue(stored({ propertyPricing: {} }));
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Modifier Bain nordique' }));
  await user.click(within(await screen.findByRole('group', { name: 'Granja' })).getByRole('checkbox', { name: '1re heure offerte' }));
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateResource).toHaveBeenCalled());
  expect(api.updateResource.mock.calls[0][1].propertyPricing).toEqual({ 1: { price: 30, freeMinutes: 60 } });
});

test('rule 21: name, quantity and prices are checked inline and block saving', async () => {
  const user = userEvent.setup();
  api.getResource.mockResolvedValue(stored({ priceType: 'per_stay' }));
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Modifier Bain nordique' }));
  const quantity = await screen.findByLabelText('En stock');
  await user.clear(quantity);
  await user.type(quantity, '1,5');
  expect(screen.getByText('Nombre entier attendu')).toBeInTheDocument();
  await user.clear(screen.getByLabelText(/^Nom/));
  expect(screen.getByText('Nom requis')).toBeInTheDocument();
  await user.type(screen.getByLabelText('Prix · Estiva'), '-1');
  expect(screen.getByText('3 champs à corriger')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

test('rule 21: a server 422 lands on its field', async () => {
  const user = userEvent.setup();
  api.updateResource.mockRejectedValue(Object.assign(new Error('VALIDATION_FAILED'), {
    status: 422, details: [{ field: 'quantity', message: 'Positif ou nul' }],
  }));
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Modifier Bain nordique' }));
  await user.type(await screen.findByLabelText(/^Description/), '!');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Positif ou nul')).toBeInTheDocument();
});

test('rule 20: deleting a free resource asks once, then deletes', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole('button', { name: 'Modifier Bain nordique' });
  await user.click(screen.getByRole('button', { name: 'Actions de Bain nordique' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Supprimer' }));
  expect(await screen.findByText('Supprimer « Bain nordique » ?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Supprimer' }));
  await waitFor(() => expect(api.deleteResource).toHaveBeenCalledWith(2, undefined));
});

test('rule 20: a resource in use states its impact and is force-deleted on confirmation', async () => {
  const user = userEvent.setup();
  api.getResourceDeleteImpact.mockResolvedValue({ reservationsCount: 2, bookingsCount: 1 });
  renderPage();
  await screen.findByRole('button', { name: 'Modifier Bain nordique' });
  await user.click(screen.getByRole('button', { name: 'Actions de Bain nordique' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Supprimer' }));
  expect(await screen.findByText(/2 réservation\(s\) et 1 créneau\(x\)/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Supprimer' }));
  await waitFor(() => expect(api.deleteResource).toHaveBeenCalledWith(2, { force: true }));
});

test('rule 20: the baby bed cannot be deleted', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole('button', { name: 'Modifier Lit bébé' });
  await user.click(screen.getByRole('button', { name: 'Actions de Lit bébé' }));
  expect(await screen.findByRole('menuitem', { name: /Supprimer/ })).toHaveAttribute('aria-disabled', 'true');
});

test('rule 20: without the hourly plugin the price type « Par heure » is not offered', async () => {
  const user = userEvent.setup();
  hourlyOn = false;
  api.getResource.mockResolvedValue(stored({ priceType: 'per_stay', name: 'Vélo' }));
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Modifier Bain nordique' }));
  await user.click(await screen.findByRole('combobox', { name: 'Type de prix' }));
  expect(screen.queryByRole('option', { name: 'Par heure' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Prix fixe' })).toBeInTheDocument();
});
