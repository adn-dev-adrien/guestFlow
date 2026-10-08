// specs/plugins-phase-p-productisation.md rule 7 — one mention: section, options, price, two texts.
import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import MentionEditor from '../MentionEditor';

const OPTIONS = [{ id: 1, title: 'Cidre 1 L' }, { id: 2, title: 'Cidre 25 cl' }];
let last;
function Harness({ initial, error }) {
  const [value, setValue] = useState(initial);
  last = value;
  return <MentionEditor value={value} onChange={setValue} options={OPTIONS} error={error} />;
}
const BASE = { section: 'local', optionIds: [1, 2], priceSource: 'min', priceOptionId: null, offerFr: '', offerEn: '', bookedFr: '', bookedEn: '' };

test('the price of one option can be chosen only among the cited options', () => {
  render(<Harness initial={BASE} />);
  fireEvent.click(screen.getByLabelText("Prix d'une option"));
  fireEvent.mouseDown(screen.getByLabelText('Option dont le prix est cité'));
  const list = within(screen.getByRole('listbox'));
  expect(list.getAllByRole('option').map((o) => o.textContent)).toEqual(['Cidre 1 L', 'Cidre 25 cl']);
  fireEvent.click(list.getByText('Cidre 1 L'));
  expect(last.priceSource).toBe('option');
  expect(last.priceOptionId).toBe(1);
});

test('the proposal offers {{price}}, the confirmation no token; a refusal lands on its field', () => {
  render(<Harness initial={BASE} error={{ field: 'bookedFr', message: 'Variable inconnue : {{price}}' }} />);
  expect(screen.getAllByText('{{price}}')).toHaveLength(1);
  expect(screen.getByText('Variable inconnue : {{price}}')).toBeInTheDocument();
});
