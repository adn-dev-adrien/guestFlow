// specs/guest-email-texts-made-simple.md rule 27 — a variable is one unit: Backspace after it or
// Delete before it removes all of it, the caret inside it selects all of it, and a refusal is shown in
// the brackets the field shows. No half-variable can be left for the guest to read.
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TokenTextField from '../TokenTextField';
import { selectionAround, deletion, displayError, buildDictionary } from '../../utils/tokenDisplay';

let last = {};
function Harness({ initial = 'Bonjour {{clientFirstName}} !', ...props }) {
  const [values, setValues] = useState({ fr: initial, en: '' });
  last = values;
  return (
    <TokenTextField
      label="Accueil"
      fr={values.fr}
      en={values.en}
      onChange={(lang, value) => setValues((v) => ({ ...v, [lang]: value }))}
      tokens={[{ name: 'clientFirstName', label: 'Prénom du voyageur' }]}
      flags={[{ name: 'hasPrice', label: 'Si prix' }]}
      {...props}
    />
  );
}

test('rule 27: Backspace right after a variable removes the whole of it', () => {
  render(<Harness />);
  const fr = screen.getByLabelText('Français');
  const end = 'Bonjour ⟦Prénom du voyageur⟧'.length;
  fr.setSelectionRange(end, end);
  fireEvent.keyDown(fr, { key: 'Backspace' });
  expect(last.fr).toBe('Bonjour  !');
});

test('rule 27: Delete right before a variable removes the whole of it', () => {
  render(<Harness />);
  const fr = screen.getByLabelText('Français');
  fr.setSelectionRange(8, 8);
  fireEvent.keyDown(fr, { key: 'Delete' });
  expect(last.fr).toBe('Bonjour  !');
});

test('rule 27: the caret inside a variable selects all of it', () => {
  render(<Harness />);
  const fr = screen.getByLabelText('Français');
  fr.setSelectionRange(12, 12);
  fireEvent.select(fr);
  expect([fr.selectionStart, fr.selectionEnd]).toEqual([8, 'Bonjour ⟦Prénom du voyageur⟧'.length]);
});

test('rule 27: the helpers, and a refusal worded in brackets', () => {
  const text = 'A ⟦x⟧ B';
  expect(selectionAround(text, 3)).toEqual([2, 5]);
  expect(selectionAround(text, 2)).toBeNull();
  expect(deletion(text, 5, 'Backspace')).toEqual({ text: 'A  B', caret: 2 });
  expect(deletion(text, 2, 'Delete')).toEqual({ text: 'A  B', caret: 2 });
  expect(deletion(text, 1, 'Backspace')).toBeNull();
  const dict = buildDictionary([{ name: 'clientFirstName', label: 'Prénom du voyageur' }], []);
  expect(displayError('Variable inconnue : {{Depuis le lo gement}}', dict)).toBe('Variable inconnue : ⟦Depuis le lo gement⟧');
  render(<Harness errorFr="Variable inconnue : {{clientFirstName}}" />);
  expect(screen.getByText('Variable inconnue : ⟦Prénom du voyageur⟧')).toBeInTheDocument();
});
