import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CategoryField } from '../OptionsPage';

// specs/option-categories.md §3 rule 6, §6.2 — the « Catégorie » free-solo autocomplete.

const ITEMS = [
  { id: 1, title: 'Ménage', category: '' },
  { id: 2, title: 'Champagne', category: 'Boissons' },
  { id: 3, title: 'Jus de pomme', category: 'Boissons' },
  { id: 4, title: 'Planche S', category: 'Restauration' },
  { id: 5, title: 'Balade', category: '  Animations  ' },
];

function renderField(value = '', items = ITEMS) {
  const setForm = vi.fn();
  render(<CategoryField form={{ category: value }} setForm={setForm} items={items} />);
  return setForm;
}

test('suggests the distinct categories already in use, deduplicated and trimmed', async () => {
  const user = userEvent.setup();
  renderField();
  await user.click(screen.getByLabelText('Catégorie'));

  const suggestions = screen.getAllByRole('option').map((o) => o.textContent);
  expect(suggestions).toEqual(['Animations', 'Boissons', 'Restauration']);
});

test('typing a brand-new label is how a category gets created', async () => {
  const user = userEvent.setup();
  const setForm = renderField();
  await user.type(screen.getByLabelText('Catégorie'), 'X');
  expect(setForm).toHaveBeenCalledWith(expect.objectContaining({ category: 'X' }));
});

test('picking an existing suggestion writes it into the form', async () => {
  const user = userEvent.setup();
  const setForm = renderField();
  await user.click(screen.getByLabelText('Catégorie'));
  await user.click(screen.getByRole('option', { name: 'Boissons' }));
  expect(setForm).toHaveBeenCalledWith(expect.objectContaining({ category: 'Boissons' }));
});

test('the current value is displayed', () => {
  renderField('Boissons');
  expect(screen.getByLabelText('Catégorie')).toHaveValue('Boissons');
});

test('an empty catalogue offers no suggestion but still accepts free text', async () => {
  const user = userEvent.setup();
  const setForm = renderField('', []);
  await user.type(screen.getByLabelText('Catégorie'), 'Boissons');
  expect(setForm).toHaveBeenCalled();
});

test('the helper text explains what the field does', () => {
  renderField();
  expect(screen.getByText(/menu dépliant/i)).toBeInTheDocument();
});

test('the « Toujours visible » checkbox only appears once a category is set', async () => {
  const user = userEvent.setup();
  const { unmount } = render(<CategoryField form={{ category: '' }} setForm={vi.fn()} items={ITEMS} />);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  unmount();

  const setForm = vi.fn();
  render(<CategoryField form={{ category: 'Restauration' }} setForm={setForm} items={ITEMS} />);
  const box = screen.getByRole('checkbox');
  expect(box).not.toBeChecked();
  await user.click(box);
  expect(setForm).toHaveBeenCalledWith(expect.objectContaining({ alwaysVisible: true }));
});

test('a pinned option shows the checkbox already ticked', () => {
  render(<CategoryField form={{ category: 'Restauration', alwaysVisible: true }} setForm={vi.fn()} items={ITEMS} />);
  expect(screen.getByRole('checkbox')).toBeChecked();
});
