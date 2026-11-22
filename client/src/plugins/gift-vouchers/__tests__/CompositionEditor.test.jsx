// specs/gift-voucher-campaigns.md rules 4, 46 — the composition editor: « Ajouter un élément » opens a searchable picker over the server's catalogue, grouped, the elements
// that cannot be sold greyed with the server's reason; an hourly resource offers its tariff modes (rate, hours, degressivity) from the server, then its included minutes;
// options carry a quantity; one hourly resource only; the server's refusal of a value is shown on its field.
import React, { useState } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CompositionEditor from '../CompositionEditor';
import { CATALOGUE, renderWithShell } from './giftVoucherFixtures';

function Harness({ initial = null, errors = [], onChange = vi.fn() }) {
  const [value, setValue] = useState(initial);
  return <CompositionEditor value={value} elements={CATALOGUE} errors={errors} onChange={(next) => { setValue(next); onChange(next); }} />;
}

beforeEach(() => { vi.clearAllMocks(); });

const pickerClosed = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

test('an empty composition invites to add an element', () => {
  renderWithShell(<Harness />);
  expect(screen.getByText(/Aucun élément/)).toBeInTheDocument();
});

test('the picker lists the catalogue grouped, greys what cannot be sold with the server reason, and filters by search', async () => {
  renderWithShell(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter un élément' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Ressources à l’heure')).toBeInTheDocument();
  expect(within(dialog).getByText('Restauration')).toBeInTheDocument();
  const greyed = within(dialog).getByRole('button', { name: /Petit-déjeuner/ });
  expect(greyed).toHaveAttribute('aria-disabled', 'true');
  expect(within(dialog).getByText(/a besoin d’un séjour/)).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText('Rechercher'), 'planche');
  expect(within(dialog).queryByText('Boisson')).not.toBeInTheDocument();
  expect(within(dialog).getByText('Planche apéro')).toBeInTheDocument();
});

test('choosing the hourly resource shows its modes from the server, selects the first open one and its minimum minutes', async () => {
  const onChange = vi.fn();
  renderWithShell(<Harness onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter un élément' }));
  await userEvent.click(await screen.findByRole('button', { name: /Bain nordique/ }));
  await pickerClosed();
  expect(onChange).toHaveBeenLastCalledWith({ resourceId: 1, band: 'day', minutes: 60, options: [] });
  expect(screen.getByText(/Extérieur · journée · 50,00.€.\/ h/)).toBeInTheDocument();
  expect(screen.getByText('de 10:00 à 19:00')).toBeInTheDocument();
  expect(screen.getByText('Dégressif : −10 % dès la 2e heure, −20 % dès la 3e')).toBeInTheDocument();
  expect(screen.getByText('Par tranches de 60 min, 60 min au minimum.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: 'Extérieur · soirée' }));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ band: 'evening' }));
});

test('the included minutes step by the band’s slot, and a typed value the server refuses shows its sentence', async () => {
  const onChange = vi.fn();
  renderWithShell(
    <Harness
      initial={{ resourceId: 1, band: 'day', minutes: 120, options: [] }} onChange={onChange}
      errors={[{ field: 'composition.minutes', message: 'Durée incluse : « Bain nordique » se réserve par tranches de 60 min : 30 min ne convient pas.' }]}
    />,
  );
  expect(screen.getByText(/30 min ne convient pas/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Augmenter' }));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ minutes: 180 }));
});

test('an option is added with a quantity of 1, shows its price type, takes a quantity and is removed', async () => {
  const onChange = vi.fn();
  renderWithShell(<Harness initial={{ resourceId: 1, band: 'day', minutes: 120, options: [] }} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter un élément' }));
  await userEvent.click(await screen.findByRole('button', { name: /Planche apéro/ }));
  await pickerClosed();
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ options: [{ articleRef: 'option:10', qty: 1 }] }));
  expect(screen.getAllByText('Forfait').length).toBeGreaterThan(0);
  await userEvent.click(screen.getAllByRole('button', { name: 'Augmenter' })[1]);
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ options: [{ articleRef: 'option:10', qty: 2 }] }));
  await userEvent.click(screen.getByRole('button', { name: 'Retirer Planche apéro' }));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ options: [] }));
});

test('a second hourly resource is not added: the sentence says one only', async () => {
  const onChange = vi.fn();
  renderWithShell(<Harness initial={{ resourceId: 1, band: 'day', minutes: 120, options: [] }} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter un élément' }));
  await userEvent.click(await screen.findByRole('button', { name: /Bain nordique/ }));
  await pickerClosed();
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByText('Un bon comprend une seule ressource à l’heure.')).toBeInTheDocument();
});

test('the server refusal of an option’s quantity is shown on its row', () => {
  renderWithShell(
    <Harness
      initial={{ resourceId: 1, band: 'day', minutes: 120, options: [{ articleRef: 'option:10', qty: 30 }] }}
      errors={[{ field: 'composition.options[0].qty', message: 'Compris dans le bon : la quantité de « Planche apéro » va de 1 à 20.' }]}
    />,
  );
  expect(screen.getByText(/va de 1 à 20/)).toBeInTheDocument();
});
