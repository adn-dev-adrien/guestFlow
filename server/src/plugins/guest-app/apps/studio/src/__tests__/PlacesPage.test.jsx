// specs/guest-app/guest-app-local-amenities.md rules 14, 15, 16 — Réglages › Pratique: the list by category with its counts (« masquée aux
// clients » at 0), « À revérifier », the publish switch, and the dialog: every refusal comes from the server and sits under its
// field; the dialog stays open until the place is accepted.
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlacesPage from '../pages/PlacesPage';
import { api } from '../services/api';
import { renderStudio } from './studioFixtures';

vi.mock('../services/api', () => ({
  api: {
    places: vi.fn(), createPlace: vi.fn(), savePlace: vi.fn(), deletePlace: vi.fn(), saveSettings: vi.fn(),
  },
}));

const CATEGORIES = [
  ['dechets', 'Déchets'], ['boulangerie', 'Boulangeries'], ['pharmacie', 'Pharmacie'], ['boucherie', 'Boucheries'], ['epicerie', 'Épiceries'],
  ['tabac', 'Tabac-presse'], ['poste', 'La Poste'], ['distributeur', 'Distributeur de billets'], ['carburant', 'Carburant et recharge'],
].map(([key, label]) => ({ key, label }));

const place = (over = {}) => ({
  id: 3, category: 'boulangerie', nameFr: 'Maison Roux', nameEn: null, commune: 'Satillieu', position: '45.15123, 4.6163', lat: 45.15123, lng: 4.6163, driveMinutes: 4, driveLabel: '4 min en voiture', verifiedLabel: 'vérifié le 1 juil. 2099',
  wasteKind: null, accepts: null, energies: null, phone: null, noteFr: null, noteEn: null, hours: null, published: true, verifiedOn: '2099-07-01', needsReview: false, ...over, // date-literal-ok: a calendar day the server sends
});

function listOf(places, over = {}) {
  const groups = CATEGORIES.map((c) => {
    const own = places.filter((p) => p.category === c.key);
    const published = own.filter((p) => p.published).length;
    return {
      ...c, count: own.length, publishedCount: published, hiddenFromGuests: published === 0, places: own,
    };
  });
  return {
    estate: { lat: 45.16369, lng: 4.63184, position: '45.16369, 4.63184', communes: ['Satillieu', 'Saint-Romain-d’Ay', 'Saint-Alban-d’Ay'], maxKm: 15 },
    categories: CATEGORIES,
    wasteKinds: [{ key: 'point', label: 'Point de collecte' }, { key: 'decheterie', label: 'Déchèterie' }],
    accepts: ['om:Ordures ménagères', 'emballages:Emballages', 'verre:Verre', 'papier:Papier', 'textile:Textile', 'vegetaux:Végétaux', 'encombrants:Encombrants'].map((p) => ({ key: p.split(':')[0], label: p.split(':')[1] })),
    energies: [{ key: 'essence', label: 'Essence' }, { key: 'gazole', label: 'Gazole' }, { key: 'recharge', label: 'Recharge électrique' }],
    groups,
    reviewCount: places.filter((p) => p.needsReview).length,
    ...over,
  };
}

function setup(places = [place(), place({ id: 4, nameFr: 'Boulangerie ancienne', needsReview: true, verifiedOn: '2097-01-01' })]) { // date-literal-ok: a calendar day the server sends
  let current = places;
  api.places.mockImplementation(async () => listOf(current));
  api.createPlace.mockImplementation(async (body) => { current = [...current, place({ id: 9, nameFr: body.nameFr, category: body.category })]; return current[current.length - 1]; });
  api.savePlace.mockImplementation(async (id, body) => ({ ...current.find((p) => p.id === id), ...body }));
  api.deletePlace.mockResolvedValue({ ok: true });
  renderStudio(<PlacesPage />);
}

const refusal = (fields) => Object.assign(new Error('Corrigez les champs signalés.'), { status: 400, code: 'INVALID_PLACE', fields });

describe('PlacesPage — the list (rules 14, 15)', () => {
  it('groups the places by category with their counts; a category with nothing published says « masquée aux clients »', async () => {
    setup();
    expect(await screen.findByRole('group', { name: 'Boulangeries' })).toBeInTheDocument();
    const bakeries = screen.getByRole('group', { name: 'Boulangeries' });
    expect(within(bakeries).getByLabelText('2 lieux')).toBeInTheDocument();
    expect(within(bakeries).queryByText('masquée aux clients')).toBeNull();
    const pharmacy = screen.getByRole('group', { name: 'Pharmacie' });
    expect(within(pharmacy).getByLabelText('0 lieu')).toBeInTheDocument();
    expect(within(pharmacy).getByText('masquée aux clients')).toBeInTheDocument();
  });

  it('flags a place not verified for 12 months « À revérifier » and says how many', async () => {
    setup();
    const bakeries = await screen.findByRole('group', { name: 'Boulangeries' });
    expect(within(bakeries).getAllByText('À revérifier')).toHaveLength(1);
    expect(screen.getByText(/1 lieu n’a pas été vérifié depuis 12 mois/)).toBeInTheDocument();
  });

  it('the publish switch changes the publication and nothing else', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('switch', { name: 'Publier Maison Roux' }));
    await waitFor(() => expect(api.savePlace).toHaveBeenCalledWith(3, { published: false }));
  });

  it('deleting asks first, then removes the place', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Supprimer Maison Roux' }));
    expect(api.deletePlace).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(api.deletePlace).toHaveBeenCalledWith(3));
  });
});

describe('PlacesPage — the dialog shows what the server refuses (rule 16)', () => {
  const fill = async (user, { name = 'Boulangerie du Lac', position = 'Satillieu', drive = '' } = {}) => {
    await user.click(await screen.findByRole('button', { name: 'Ajouter un lieu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter un lieu' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Nom' }), name);
    await user.type(within(dialog).getByRole('textbox', { name: /^Position/ }), position);
    if (drive) await user.type(within(dialog).getByRole('spinbutton'), drive);
    return dialog;
  };

  it('puts each refusal under its field and keeps the dialog open; a corrected form is saved', async () => {
    setup();
    const user = userEvent.setup();
    api.createPlace.mockRejectedValueOnce(refusal({
      position: 'Position non reconnue : collez « 45.1502, 4.6151 » ou un lien Google Maps qui contient les coordonnées.',
      driveMinutes: 'Indiquez le temps en voiture depuis le domaine, en minutes (1 à 60).',
    }));
    const dialog = await fill(user);
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText(/Position non reconnue/)).toBeInTheDocument();
    expect(within(dialog).getByText('Indiquez le temps en voiture depuis le domaine, en minutes (1 à 60).')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /^Position/ })).toBeInvalid();
    expect(screen.getByRole('dialog', { name: 'Ajouter un lieu' })).toBeInTheDocument();

    const position = within(dialog).getByRole('textbox', { name: /^Position/ });
    await user.clear(position);
    await user.type(position, '45.1502, 4.6151');
    await user.type(within(dialog).getByRole('spinbutton'), '6');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.createPlace).toHaveBeenCalledTimes(2));
    expect(api.createPlace).toHaveBeenLastCalledWith(expect.objectContaining({
      category: 'dechets', nameFr: 'Boulangerie du Lac', commune: 'Satillieu', position: '45.1502, 4.6151', driveMinutes: 6, hours: null, published: true,
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ajouter un lieu' })).toBeNull());
  });

  it('shows the 15 km refusal as the server worded it', async () => {
    setup();
    const user = userEvent.setup();
    api.createPlace.mockRejectedValueOnce(refusal({ position: 'Ce lieu est à 66 km du domaine : la carte couvre 15 km autour.' }));
    const dialog = await fill(user, { position: '45.75, 4.85', drive: '9' });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Ce lieu est à 66 km du domaine : la carte couvre 15 km autour.')).toBeInTheDocument();
  });

  it('a waste place asks what can be dropped, a fuel place which energies; the refusals sit under the checkboxes', async () => {
    setup();
    const user = userEvent.setup();
    const dialog = await fill(user, { position: '45.1502, 4.6151', drive: '5' });
    expect(within(dialog).getByRole('checkbox', { name: 'Verre' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox', { name: 'Gazole' })).toBeNull();
    api.createPlace.mockRejectedValueOnce(refusal({ accepts: 'Cochez au moins ce qu’on peut y déposer.' }));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Cochez au moins ce qu’on peut y déposer.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('checkbox', { name: 'Verre' }));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.createPlace).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'dechets', wasteKind: 'point', accepts: ['verre'] })));

    await user.click(await screen.findByRole('button', { name: 'Ajouter un lieu' }));
    const second = await screen.findByRole('dialog', { name: 'Ajouter un lieu' });
    await user.click(within(second).getByRole('combobox', { name: 'Catégorie' }));
    await user.click(await screen.findByRole('option', { name: 'Carburant et recharge' }));
    expect(within(second).getByRole('checkbox', { name: 'Recharge électrique' })).toBeInTheDocument();
    expect(within(second).queryByRole('checkbox', { name: 'Verre' })).toBeNull();
  });

  it('sends the week as minutes, Sunday first, and nothing at all when no day has a range', async () => {
    setup();
    const user = userEvent.setup();
    const dialog = await fill(user, { position: '45.1502, 4.6151', drive: '5' });
    await user.click(within(within(dialog).getByRole('group', { name: 'Lundi' })).getByRole('button', { name: 'Ajouter une plage' }));
    await user.click(within(dialog).getByRole('button', { name: 'Copier le lundi du mardi au samedi' }));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.createPlace).toHaveBeenCalled());
    const { hours } = api.createPlace.mock.calls[0][0];
    expect(hours).toHaveLength(7);
    expect(hours[0]).toEqual([]);
    expect([1, 2, 3, 4, 5, 6].every((day) => JSON.stringify(hours[day]) === '[[480,720]]')).toBe(true);
  });

  it('« Copier le lundi du mardi au samedi » leaves Sunday as it is', async () => {
    setup([place({ hours: [[[600, 700]], [[480, 720]], [], [], [], [], []] })]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Modifier Maison Roux' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier le lieu' });
    await user.click(within(dialog).getByRole('button', { name: 'Copier le lundi du mardi au samedi' }));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.savePlace).toHaveBeenCalled());
    const { hours } = api.savePlace.mock.calls[0][1];
    expect(hours[0]).toEqual([[600, 700]]);
    expect(hours.slice(1).every((day) => JSON.stringify(day) === '[[480,720]]')).toBe(true);
  });

  it('a closing at 23:59 stays 1439 — only midnight is 1440 — and a place that closes at midnight keeps it', async () => {
    setup([place({ hours: [[], [[480, 1439]], [[480, 1440]], [], [], [], []] })]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Modifier Maison Roux' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier le lieu' });
    expect(within(dialog).getByRole('combobox', { name: 'Lundi, plage 1, fin' })).toHaveTextContent('23 h 59');
    expect(within(dialog).getByRole('combobox', { name: 'Mardi, plage 1, fin' })).toHaveTextContent('minuit');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.savePlace).toHaveBeenCalled());
    const { hours } = api.savePlace.mock.calls[0][1];
    expect([hours[1], hours[2]]).toEqual([[[480, 1439]], [[480, 1440]]]);
  });

  it('the checkboxes and the kinds come from the server\'s closed sets, not from the page', async () => {
    api.places.mockImplementation(async () => listOf([], { accepts: [{ key: 'om', label: 'Bacs gris' }], wasteKinds: [{ key: 'point', label: 'Colonne' }, { key: 'decheterie', label: 'Grande déchèterie' }] }));
    renderStudio(<PlacesPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ajouter un lieu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter un lieu' });
    expect(within(dialog).getByRole('checkbox', { name: 'Bacs gris' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox', { name: 'Verre' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Grande déchèterie' })).toBeInTheDocument();
  });

  it('a row reads the drive and verification wording the server sent', async () => {
    setup([place({ driveLabel: '4 min en voiture', verifiedLabel: 'vérifié le 1 juil. 2099' })]);
    expect(await screen.findByText('Satillieu · 4 min en voiture · vérifié le 1 juil. 2099')).toBeInTheDocument();
  });

  it('editing a place keeps its commune, position and publication, and saves under its id', async () => {
    setup([place({ commune: 'Lalouvesc' })]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Modifier Maison Roux' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier le lieu' });
    expect(within(dialog).getByRole('textbox', { name: /^Position/ })).toHaveValue('45.15123, 4.6163');
    expect(within(dialog).getByRole('textbox', { name: 'Nom de la commune' })).toHaveValue('Lalouvesc');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.savePlace).toHaveBeenCalledWith(3, expect.objectContaining({ commune: 'Lalouvesc', position: '45.15123, 4.6163', published: true, driveMinutes: 4 })));
  });
});

describe('PlacesPage — the estate position (rule 12)', () => {
  it('saves the position and shows the server\'s refusal when it is not one', async () => {
    setup();
    const user = userEvent.setup();
    const field = await screen.findByRole('textbox', { name: 'Position du domaine' });
    expect(field).toHaveValue('45.16369, 4.63184');
    api.saveSettings.mockRejectedValueOnce(new Error('Position non reconnue : collez « 45.1502, 4.6151 » ou un lien Google Maps qui contient les coordonnées.'));
    await user.clear(field);
    await user.type(field, 'Satillieu');
    await user.click(screen.getByRole('button', { name: 'Enregistrer la position' }));
    expect(await screen.findByText(/Position non reconnue/)).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, '45.2, 4.7');
    api.saveSettings.mockResolvedValueOnce({});
    await user.click(screen.getByRole('button', { name: 'Enregistrer la position' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenLastCalledWith({ estatePosition: '45.2, 4.7' }));
  });
});
