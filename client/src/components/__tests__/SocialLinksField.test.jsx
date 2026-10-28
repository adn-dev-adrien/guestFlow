// specs/settings-input-guards.md rules 35, 37, 38 — the ordered social links of the e-mail settings.
import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';
import SocialLinksField from '../SocialLinksField';

const NETWORKS = ['instagram', 'facebook', 'tiktok', 'youtube', 'pinterest', 'linkedin', 'x'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));

function Harness({ initial = [], errors = {}, onChange }) {
  const [links, setLinks] = useState(initial);
  return <SocialLinksField links={links} networks={NETWORKS} errors={errors} onChange={(next) => { onChange?.(next); setLinks(next); }} />;
}
const rows = () => screen.queryAllByRole('listitem');

test('rule 35: an empty list shows the add button and the J+1 helper', () => {
  render(<Harness />);
  expect(rows()).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Ajouter un réseau' })).toBeEnabled();
  expect(screen.getByText('Proposés dans le mail de remerciement (J+1).')).toBeInTheDocument();
});

test('rule 35: adding a row takes the first network not yet used; the URL stays editable', () => {
  const onChange = vi.fn();
  render(<Harness initial={[{ network: 'instagram', url: 'https://instagram.com/a' }]} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter un réseau' }));
  expect(onChange).toHaveBeenLastCalledWith([{ network: 'instagram', url: 'https://instagram.com/a' }, { network: 'facebook', url: '' }]);
  fireEvent.change(screen.getAllByLabelText('Adresse du lien')[1], { target: { value: 'https://facebook.com/a' } });
  expect(onChange).toHaveBeenLastCalledWith([{ network: 'instagram', url: 'https://instagram.com/a' }, { network: 'facebook', url: 'https://facebook.com/a' }]);
});

test('rule 38: up and down reorder, the first cannot go up and the last cannot go down', () => {
  const onChange = vi.fn();
  render(<Harness initial={[{ network: 'instagram', url: 'a' }, { network: 'facebook', url: 'b' }]} onChange={onChange} />);
  expect(within(rows()[0]).getByRole('button', { name: 'Monter' })).toBeDisabled();
  expect(within(rows()[1]).getByRole('button', { name: 'Descendre' })).toBeDisabled();
  fireEvent.click(within(rows()[1]).getByRole('button', { name: 'Monter' }));
  expect(onChange).toHaveBeenLastCalledWith([{ network: 'facebook', url: 'b' }, { network: 'instagram', url: 'a' }]);
});

test('rule 35: a row is removed', () => {
  const onChange = vi.fn();
  render(<Harness initial={[{ network: 'instagram', url: 'a' }, { network: 'facebook', url: 'b' }]} onChange={onChange} />);
  fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Retirer' }));
  expect(onChange).toHaveBeenLastCalledWith([{ network: 'facebook', url: 'b' }]);
  expect(rows()).toHaveLength(1);
});

test('rule 36: a network already used is disabled in the other rows\' pickers', () => {
  render(<Harness initial={[{ network: 'instagram', url: 'a' }, { network: 'facebook', url: 'b' }]} />);
  fireEvent.mouseDown(within(rows()[1]).getByRole('combobox'));
  const list = screen.getByRole('listbox');
  expect(within(list).getByRole('option', { name: 'Instagram' })).toHaveAttribute('aria-disabled', 'true');
  expect(within(list).getByRole('option', { name: 'Facebook' })).not.toHaveAttribute('aria-disabled', 'true');
  expect(within(list).getByRole('option', { name: 'Tiktok' })).not.toHaveAttribute('aria-disabled', 'true');
});

test('rule 35: the button is disabled once every network is used', () => {
  render(<Harness initial={NETWORKS.map((n) => ({ network: n.value, url: 'u' }))} />);
  expect(screen.getByRole('button', { name: 'Ajouter un réseau' })).toBeDisabled();
});

test('rule 35: the button is disabled at the maximum, whatever the catalogue', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ value: `n${i}`, label: `N${i}` }));
  render(<SocialLinksField links={many.slice(0, 8).map((n) => ({ network: n.value, url: 'u' }))} networks={many} onChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Ajouter un réseau' })).toBeDisabled();
});

test('rule 37: a server error lands under the right row, the list error under the title', () => {
  render(<Harness
    initial={[{ network: 'instagram', url: 'https://instagram.com/a' }, { network: 'facebook', url: 'https://instagram.com/b' }]}
    errors={{ 'socialLinks.1.url': "Lien d'un autre réseau.", socialLinks: '8 liens au plus.' }}
  />);
  expect(within(rows()[1]).getByText("Lien d'un autre réseau.")).toBeInTheDocument();
  expect(within(rows()[0]).queryByText("Lien d'un autre réseau.")).toBeNull();
  expect(screen.getByText('8 liens au plus.')).toBeInTheDocument();
});
