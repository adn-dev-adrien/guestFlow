// specs/guest-email-texts-made-simple.md rules 37–38 (UI/UX review 2026-10-18, decisions 5 and 10) —
// variables on demand (« + Variable » or the [ key), a refusal with its one-tap fix under the field, and
// one language at a time with the French as a reference above the English.
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TokenTextField from '../TokenTextField';

let last = {};
function Harness(props) {
  const [values, setValues] = useState({ fr: 'Bonjour ', en: '' });
  last = values;
  return (
    <TokenTextField
      id="t"
      label="Arrivée"
      fr={values.fr}
      en={values.en}
      onChange={(lang, value) => setValues((v) => ({ ...v, [lang]: value }))}
      tokens={[{ name: 'clientFirstName', label: 'Prénom du voyageur' }, { name: 'propertyName', label: 'Logement' }]}
      {...props}
    />
  );
}

test('no chip wall: the variables are behind « + Variable »', () => {
  render(<Harness />);
  expect(screen.queryByText('Prénom du voyageur')).toBeNull();
  expect(screen.getByRole('button', { name: 'Variable' })).toBeInTheDocument();
});

test('a typed [ stays in the text and opens the list there; typing filters it, Entrée replaces the [', () => {
  render(<Harness language="fr" />);
  const field = screen.getByLabelText('Arrivée — français');
  fireEvent.change(field, { target: { value: 'Bonjour [' } });
  expect(last.fr).toBe('Bonjour [');
  const search = screen.getByRole('combobox', { name: 'Chercher une variable' });
  fireEvent.change(search, { target: { value: 'pré' } });
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Prénom du voyageur']);
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(last.fr).toBe('Bonjour {{clientFirstName}}');
  expect(screen.queryByRole('combobox')).toBeNull();
});

test('Échap closes the list and keeps the typed [', () => {
  render(<Harness language="fr" />);
  const field = screen.getByLabelText('Arrivée — français');
  fireEvent.change(field, { target: { value: 'Bonjour [' } });
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(last.fr).toBe('Bonjour [');
});

test('a [ composed by an input method does not open the list', () => {
  render(<Harness language="fr" />);
  const field = screen.getByLabelText('Arrivée — français');
  const event = new InputEvent('input', { bubbles: true, isComposing: true });
  Object.defineProperty(event, 'target', { value: Object.assign(field, { value: 'Bonjour [' }) });
  fireEvent(field, event);
  expect(screen.queryByRole('combobox')).toBeNull();
});

test('a refusal shows under its field with the server’s suggestion; « Remplacer » fixes the text', () => {
  function Refused() {
    const [fr, setFr] = useState('Bonjour {{prenon}}');
    last = { fr };
    return (
      <TokenTextField
        label="Arrivée"
        language="fr"
        fr={fr}
        onChange={(lang, v) => setFr(v)}
        tokens={[{ name: 'clientFirstName', label: 'Prénom du voyageur' }]}
        errorFr={{ message: 'Variable inconnue : {{prenon}}', unknown: 'prenon', suggestion: { name: 'clientFirstName', label: 'Prénom du voyageur' } }}
      />
    );
  }
  render(<Refused />);
  expect(screen.getByText('Variable inconnue : ⟦prenon⟧')).toBeInTheDocument();
  expect(screen.getByText('Prénom du voyageur ?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remplacer' }));
  expect(last.fr).toBe('Bonjour {{clientFirstName}}');
});

test('one language at a time: in English, the French reads above the single English field', () => {
  render(<Harness language="en" fr="Bonjour {{clientFirstName}}" />);
  expect(screen.getByTestId('french-reference')).toHaveTextContent('Bonjour ⟦Prénom du voyageur⟧');
  expect(screen.getByLabelText('Arrivée — anglais')).toBeInTheDocument();
  expect(screen.queryByLabelText('Arrivée — français')).toBeNull();
});
