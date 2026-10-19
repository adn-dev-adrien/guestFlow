// specs/guest-email-texts-made-simple.md rule 46 — « + Variable » on a field that never had a caret
// appends the variable at the end, one space before it when the text does not end in one; once the
// field has had a caret, the variable lands at the caret.
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TokenTextField from '../TokenTextField';

let last = {};
function Harness({ initial }) {
  const [fr, setFr] = useState(initial);
  last = { fr };
  return (
    <TokenTextField
      label="Arrivée"
      language="fr"
      fr={fr}
      onChange={(lang, value) => setFr(value)}
      tokens={[{ name: 'clientFirstName', label: 'Prénom du voyageur' }]}
    />
  );
}

const pick = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Variable' }));
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Chercher une variable' }), { key: 'Enter' });
};

test('rule 46: a never-focused field gets the variable at its end, after a space', () => {
  render(<Harness initial="Bonjour" />);
  pick();
  expect(last.fr).toBe('Bonjour {{clientFirstName}}');
});

test('rule 46: no second space when the text already ends in one, none in an empty field', () => {
  const { unmount } = render(<Harness initial="Bonjour " />);
  pick();
  expect(last.fr).toBe('Bonjour {{clientFirstName}}');
  unmount();
  render(<Harness initial="" />);
  pick();
  expect(last.fr).toBe('{{clientFirstName}}');
});

test('rule 46: once the field had a caret, the variable lands at the caret', () => {
  render(<Harness initial="Bonjour à tous" />);
  const field = screen.getByLabelText('Arrivée — français');
  field.focus();
  field.setSelectionRange(8, 8);
  fireEvent.pointerUp(field);
  pick();
  expect(last.fr).toBe('Bonjour {{clientFirstName}}à tous');
});
