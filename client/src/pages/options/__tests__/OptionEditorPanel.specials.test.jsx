// specs/options-resources-ux.md rule 13 — every type-specific setting of the former dialog is still
// reachable from the panel: breakfast time and notice, planning card, bed linen, towels, bath mats,
// insurance note, « Visible du client », category and « Toujours visible ». Replaces the former
// OptionsPage.percent / .category suites (ported, not dropped).
import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../../api';
import { renderEditor, storedOption } from './optionEditorFixtures';

const enabled = new Set(['linen']);
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: (id) => enabled.has(id) }));
vi.mock('../../../api', () => ({
  default: { getOption: vi.fn(), createOption: vi.fn(), updateOption: vi.fn(), getOptionPropertyDefaults: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  enabled.clear();
  enabled.add('linen');
  api.updateOption.mockResolvedValue({ ok: true });
  api.getOptionPropertyDefaults.mockResolvedValue([{ propertyId: 1, propertyName: 'Granja', offered: true }]);
});

const open = async (over = {}, user = userEvent.setup()) => {
  api.getOption.mockResolvedValue(storedOption(over));
  renderEditor();
  await screen.findByRole('heading', { name: over.title || 'Ménage', level: 2 });
  return user;
};
const sent = async (user) => {
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  return api.updateOption.mock.calls[0][1];
};
const chips = () => screen.getByRole('navigation', { name: 'Sections' }).textContent;

test('breakfast: its own section with the default time and the push notice, both saved', async () => {
  const user = await open({ title: 'Petit déjeuner', autoOptionType: 'breakfast', breakfastTime: '09:00', breakfastNotifyLeadMinutes: 30 });
  expect(chips()).toContain('Petit-déjeuner');
  expect(screen.queryByText('Afficher une carte dans le planning')).not.toBeInTheDocument();
  const notice = screen.getByLabelText('Préavis de notification (minutes)');
  await user.clear(notice);
  await user.type(notice, '45');
  const payload = await sent(user);
  expect(payload.breakfastTime).toBe('09:00');
  expect(Number(payload.breakfastNotifyLeadMinutes)).toBe(45);
});

test('planning card: a manual option can show a card; the slots are saved', async () => {
  const user = await open({ showsPlanningCard: 1, cardRepeat: 'multiple_per_day', planningCardTimes: ['12:00', '19:30'] });
  expect(screen.getByRole('switch', { name: 'Afficher une carte dans le planning' })).toBeChecked();
  expect(screen.getByLabelText('Créneau 1')).toHaveValue('12:00');
  await user.click(screen.getByRole('button', { name: 'Ajouter un créneau' }));
  expect(screen.getByLabelText('Créneau 3')).toBeInTheDocument();
  const payload = await sent(user);
  expect(payload.showsPlanningCard).toBe(true);
  expect(payload.cardRepeat).toBe('multiple_per_day');
  expect(payload.planningCardTimes).toEqual(['12:00', '19:30', '09:00']);
});

test('planning card: off by default, the switch reveals the repetition', async () => {
  const user = await open();
  expect(screen.queryByLabelText('Créneau 1')).not.toBeInTheDocument();
  await user.click(screen.getByRole('switch', { name: 'Afficher une carte dans le planning' }));
  expect(screen.getByLabelText('Heure (par défaut)')).toHaveValue('09:00');
});

test('bed linen: the bed types that travel to the laundry, only with the linen plugin', async () => {
  const user = await open({ title: 'Linge de lit', countsAsBedLinen: 1, linenIncludesBaby: 1 });
  expect(chips()).toContain('Linge');
  await user.click(screen.getByRole('checkbox', { name: 'Drap bébé' }));
  expect((await sent(user)).linenIncludesBaby).toBe(false);
});

test('bed linen: the read-only mirror of the properties that include it by default', async () => {
  await open({ title: 'Linge de lit', countsAsBedLinen: 1 });
  expect(await screen.findByText('Logements par défaut')).toBeInTheDocument();
  expect(api.getOptionPropertyDefaults).toHaveBeenCalledWith(7);
});

test('towels: the per-person counts', async () => {
  const user = await open({ title: 'Linge de toilette', countsAsBathroomLinen: 1, towelLargePerPerson: 1, towelMediumPerPerson: 0, towelSmallPerPerson: 1 });
  const medium = screen.getByLabelText('Moyennes');
  await user.clear(medium);
  await user.type(medium, '2');
  expect((await sent(user)).towelMediumPerPerson).toBe(2);
});

test('bath mats: a quantity per property, zero dropped', async () => {
  const user = await open({ title: 'Tapis de bain', countsAsBathMat: 1, propertyBathMats: { 1: 2 }, displayToClient: 0 });
  expect(chips()).toContain('Tapis de bain');
  await user.type(screen.getByRole('spinbutton', { name: 'Estiva' }), '0');
  expect((await sent(user)).propertyBathMats).toEqual({ 1: 2 });
});

test('the linen plugin off hides the linen and bath-mat blocks', async () => {
  enabled.clear();
  await open({ title: 'Linge de lit', countsAsBedLinen: 1, countsAsBathMat: 1 });
  expect(chips()).not.toContain('Linge');
  expect(chips()).not.toContain('Tapis de bain');
});

test('insurance: its note, and the flag survives a save', async () => {
  const user = await open({ title: 'Assurance annulation', isCancellationInsurance: 1, priceType: 'percent_of_stay', price: 4 });
  expect(screen.getByText('Assurance annulation : proposée seulement avec un tarif supérieur à 0.')).toBeInTheDocument();
  await user.type(screen.getByLabelText(/^Description/), '!');
  expect((await sent(user)).isCancellationInsurance).toBe(true);
});

test('« Visible du client »: on by default; off explains what the option stops being', async () => {
  const user = await open();
  const toggle = screen.getByRole('switch', { name: 'Visible du client' });
  expect(toggle).toBeChecked();
  await user.click(toggle);
  expect(screen.getByText('Interne : absente de la fiche, des mails, du devis.')).toBeInTheDocument();
  expect((await sent(user)).displayToClient).toBe(false);
});

test('« Visible du client » off on a linen option says it is still counted in the laundry', async () => {
  await open({ title: 'Linge de lit', countsAsBedLinen: 1, displayToClient: 0 });
  expect(screen.getByText(/toujours comptée dans le linge/)).toBeInTheDocument();
});

test('category: the existing labels are one-tap suggestions; « Toujours visible » follows the category', async () => {
  const user = await open();
  expect(screen.queryByRole('checkbox', { name: /Toujours visible/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Boissons' }));
  expect(screen.getByLabelText('Catégorie')).toHaveValue('Boissons');
  await user.click(screen.getByRole('checkbox', { name: /Toujours visible/ }));
  const payload = await sent(user);
  expect(payload.category).toBe('Boissons');
  expect(payload.alwaysVisible).toBe(true);
});

test('category: typing a brand-new label is how a category is created', async () => {
  const user = await open();
  await user.type(screen.getByLabelText('Catégorie'), 'Sorties');
  expect((await sent(user)).category).toBe('Sorties');
});

test('category: a 90-character label is cut on its suggestion with the whole label as title', async () => {
  const long = 'Catégorie au nom démesurément long '.repeat(3).trim();
  api.getOption.mockResolvedValue(storedOption());
  renderEditor({ props: { categories: [long] } });
  await screen.findByRole('heading', { name: 'Ménage' });
  expect(screen.getByTitle(long).textContent.endsWith('…')).toBe(true);
});

test('percent option: percentage wording and the accommodation-only helper', async () => {
  await open({ title: 'Assurance', priceType: 'percent_of_stay', price: 4, propertyPrices: { 2: 6 } });
  expect(screen.getByLabelText('Pourcentage de base')).toHaveValue('4');
  expect(screen.getByLabelText('Pourcentage · Estiva')).toHaveValue('6');
  expect(screen.queryByLabelText('Prix de base')).not.toBeInTheDocument();
});

test('no English title field in the editor (translation-catalogue rule 19)', async () => {
  await open();
  expect(screen.queryByLabelText(/anglais/i)).not.toBeInTheDocument();
});
