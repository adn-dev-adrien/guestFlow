// specs/plugins-phase-p-productisation.md §6 — the French/English text pair with its token chips.
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TokenTextField from '../TokenTextField';

function Harness(props) {
  const [values, setValues] = useState({ fr: 'Prix : ', en: '' });
  return (
    <TokenTextField
      label="Lit bébé"
      fr={values.fr}
      en={values.en}
      onChange={(lang, value) => setValues((v) => ({ ...v, [lang]: value }))}
      tokens={['price']}
      flags={['hasPrice']}
      {...props}
    />
  );
}

test('a token chip inserts at the cursor of the last focused field', () => {
  render(<Harness />);
  const fr = screen.getByLabelText('Français');
  fr.focus();
  fr.setSelectionRange(7, 7);
  fireEvent.focus(fr);
  fireEvent.click(screen.getByText('{{price}}'));
  expect(fr).toHaveValue('Prix : {{price}}');
  const en = screen.getByLabelText('Anglais');
  fireEvent.focus(en);
  fireEvent.click(screen.getByText('si hasPrice'));
  expect(en).toHaveValue('{{#if hasPrice}}{{/if}}');
});

test('the server refusal shows under its field; the placeholder shows the global text', () => {
  render(<Harness errorEn="Variable inconnue : {{prix}}" placeholderFr="Texte commun" />);
  expect(screen.getByText('Variable inconnue : {{prix}}')).toBeInTheDocument();
  expect(screen.getByLabelText('Français')).toHaveAttribute('placeholder', 'Texte commun');
});
