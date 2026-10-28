// specs/options-resources-ux.md rule 14 — « Logements et prix »: one line per property (Proposée, Prix,
// Inclus, Offert), blank price = base price, free / progressive / auto-timed variants.
import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../../api';
import { renderEditor, storedOption } from './optionEditorFixtures';

vi.mock('../../../api', () => ({
  default: { getOption: vi.fn(), createOption: vi.fn(), updateOption: vi.fn(), getOptionPropertyDefaults: vi.fn() },
}));
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

beforeEach(() => {
  vi.clearAllMocks();
  api.updateOption.mockResolvedValue({ ok: true });
});

const open = async (over = {}) => {
  api.getOption.mockResolvedValue(storedOption(over));
  const view = renderEditor();
  await screen.findByRole('heading', { name: over.title || 'Ménage' });
  return view;
};
const price = (name) => screen.getByLabelText(`Prix · ${name}`);
const save = async (user) => {
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  return api.updateOption.mock.calls[0][1];
};

test('rule 14: one line per property, with Proposée, Prix, Inclus and Offert', async () => {
  await open();
  for (const name of ['Granja', 'Estiva']) {
    expect(screen.getByRole('group', { name })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: `Proposée · ${name}` })).toBeChecked();
    expect(price(name)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: `Inclus · ${name}` })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: `Offert · ${name}` })).toBeDisabled();
  }
});

test('rule 14: a blank price shows the base price as placeholder; typing one is an override, sent as a number', async () => {
  const user = userEvent.setup();
  await open({ price: 30 });
  expect(price('Granja')).toHaveAttribute('placeholder', '30');
  await user.type(price('Estiva'), '85,5');
  const payload = await save(user);
  expect(payload.propertyPrices).toEqual({ 2: 85.5 });
  expect(payload.price).toBe(30);
});

test('rule 14: 0 is an override (free there), not a blank', async () => {
  const user = userEvent.setup();
  await open();
  await user.type(price('Granja'), '0');
  expect((await save(user)).propertyPrices).toEqual({ 1: 0 });
});

test('rule 14: Offert needs Inclus; turning Inclus on enables it', async () => {
  const user = userEvent.setup();
  await open();
  await user.click(screen.getByRole('switch', { name: 'Inclus · Granja' }));
  expect(screen.getByRole('switch', { name: 'Offert · Granja' })).toBeEnabled();
  await user.click(screen.getByRole('switch', { name: 'Offert · Granja' }));
  const payload = await save(user);
  expect(payload.propertyDefaults).toEqual({ 1: { default: true, offered: true } });
});

test('rule 14: turning Proposée off greys the line and clears its default', async () => {
  const user = userEvent.setup();
  await open({ propertyDefaults: { 2: { offered: true } } });
  expect(screen.getByRole('switch', { name: 'Inclus · Estiva' })).toBeChecked();
  await user.click(screen.getByRole('switch', { name: 'Proposée · Estiva' }));
  expect(price('Estiva')).toBeDisabled();
  expect(screen.getByRole('switch', { name: 'Inclus · Estiva' })).toBeDisabled();
  expect(screen.getByRole('switch', { name: 'Inclus · Estiva' })).not.toBeChecked();
  const payload = await save(user);
  expect(payload.propertyIds).toEqual([1]);
  expect(payload.propertyDefaults).toEqual({});
});

test('rule 14: the help line says the base applies nowhere once every proposed property has its own price', async () => {
  const user = userEvent.setup();
  await open({ price: 8, propertyPrices: { 1: 10 } });
  expect(screen.getByText('Repris par les logements dont la case prix est vide.')).toBeInTheDocument();
  await user.type(price('Estiva'), '10');
  expect(screen.getByText('Chaque logement a son propre prix : le prix de base ne s’applique nulle part.')).toBeInTheDocument();
});

test('rule 14: a free option has no price column, and its stored override is not sent', async () => {
  const user = userEvent.setup();
  await open({ priceType: 'free', price: 0, propertyPrices: { 1: 5 } });
  expect(screen.queryByLabelText('Prix · Granja')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Prix de base')).not.toBeInTheDocument();
  await user.click(screen.getByRole('switch', { name: 'Inclus · Granja' }));
  expect((await save(user)).propertyPrices).toEqual({});
});

test('rule 14: a progressive option shows its tier editor instead of a price column', async () => {
  const user = userEvent.setup();
  await open({ priceType: 'per_participant_progressive', optionProgressiveTiers: [{ participantNumber: 1, unitPrice: 20 }] });
  expect(screen.queryByLabelText('Prix · Granja')).not.toBeInTheDocument();
  expect(screen.getByText(/Tableau tarif degressif/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Ajouter un palier' }));
  expect(screen.getAllByLabelText('Participant n')).toHaveLength(2);
});

test('rule 14: an auto-timed option has no Inclus / Offert', async () => {
  await open({ autoEnabled: 1, autoOptionType: 'early_check_in', title: 'Arrivée anticipée' });
  expect(screen.queryByRole('switch', { name: 'Inclus · Granja' })).not.toBeInTheDocument();
  expect(price('Granja')).toBeInTheDocument();
});

test('rule 14: a percentage option asks for percentages, capped by the help of the base', async () => {
  await open({ priceType: 'percent_of_stay', price: 4 });
  expect(screen.getByLabelText('Pourcentage de base')).toHaveValue('4');
  expect(screen.getByLabelText('Pourcentage · Granja')).toBeInTheDocument();
  expect(screen.getByText(/hors options, ressources et taxe de séjour/)).toBeInTheDocument();
});

test('rule 14: a long property name wraps in its line', async () => {
  api.getOption.mockResolvedValue(storedOption());
  const name = 'Le gîte au nom de propriété excessivement long de la colline';
  renderEditor({ props: { properties: [{ id: 1, name }, { id: 2, name: 'Estiva' }] } });
  expect(await screen.findByRole('group', { name })).toBeInTheDocument();
});
