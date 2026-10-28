// SearchField — generic contract (specs/options-resources-ux.md §4.2): labelled, 16 px, clear button, Escape.
import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchField from '../SearchField';

function Harness({ initial = '', onChange = () => {} }) {
  const [value, setValue] = useState(initial);
  return <SearchField label="Rechercher une option" value={value} onChange={(v) => { setValue(v); onChange(v); }} />;
}

test('is named by its label, which is also the placeholder', () => {
  render(<Harness />);
  const input = screen.getByRole('searchbox', { name: 'Rechercher une option' });
  expect(input).toHaveAttribute('placeholder', 'Rechercher une option');
});

test('reports each keystroke', async () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  await userEvent.setup().type(screen.getByRole('searchbox'), 'jus');
  expect(onChange).toHaveBeenLastCalledWith('jus');
});

test('shows a clear button only when there is text, and clearing empties the field', async () => {
  const user = userEvent.setup();
  render(<Harness initial="vin" />);
  await user.click(screen.getByRole('button', { name: 'Effacer' }));
  expect(screen.getByRole('searchbox')).toHaveValue('');
  expect(screen.queryByRole('button', { name: 'Effacer' })).not.toBeInTheDocument();
});

test('Escape clears a non-empty field and does nothing on an empty one', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness initial="vin" onChange={onChange} />);
  await user.type(screen.getByRole('searchbox'), '{Escape}');
  expect(screen.getByRole('searchbox')).toHaveValue('');
  onChange.mockClear();
  await user.type(screen.getByRole('searchbox'), '{Escape}');
  expect(onChange).not.toHaveBeenCalled();
});

test('the clear label can be changed', () => {
  render(<SearchField label="Chercher" clearLabel="Vider" value="x" onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Vider' })).toBeInTheDocument();
});
