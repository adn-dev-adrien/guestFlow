// specs/plugins-phase-p-productisation.md §6 and specs/guest-email-texts-made-simple.md rule 10 — the
// French/English text pair: chips from the server, each variable shown by its label, raw `{{token}}`
// handed back.
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TokenTextField from '../TokenTextField';

let last = {};
function Harness(props) {
  const [values, setValues] = useState({ fr: 'Prix : ', en: '' });
  last = values;
  return (
    <TokenTextField
      label="Lit bébé"
      fr={values.fr}
      en={values.en}
      onChange={(lang, value) => setValues((v) => ({ ...v, [lang]: value }))}
      tokens={[{ name: 'price', label: 'Prix' }]}
      flags={[{ name: 'hasPrice', label: 'Si prix' }]}
      {...props}
    />
  );
}

test('rule 37: « + Variable » inserts the chosen label at the cursor; the raw text keeps {{token}}', () => {
  render(<Harness />);
  const fr = screen.getByLabelText('Français');
  fr.focus();
  fr.setSelectionRange(7, 7);
  fireEvent.focus(fr);
  fireEvent.click(screen.getByRole('button', { name: 'Variable' }));
  fireEvent.click(screen.getByRole('option', { name: 'Prix' }));
  expect(fr).toHaveValue('Prix : ⟦Prix⟧');
  expect(last.fr).toBe('Prix : {{price}}');
  const en = screen.getByLabelText('Anglais');
  fireEvent.focus(en);
  fireEvent.click(screen.getByRole('button', { name: 'Variable' }));
  fireEvent.click(screen.getByRole('option', { name: 'Seulement si : prix' }));
  expect(en).toHaveValue('⟦Si prix⟧⟦fin si⟧');
  expect(last.en).toBe('{{#if hasPrice}}{{/if}}');
});

test('rule 10: typed text round-trips; an unlabelled name stays raw for the server to refuse', () => {
  render(<Harness />);
  const fr = screen.getByLabelText('Français');
  fireEvent.change(fr, { target: { value: 'Total ⟦Prix⟧ et {{prix}}' } });
  expect(last.fr).toBe('Total {{price}} et {{prix}}');
  expect(fr).toHaveValue('Total ⟦Prix⟧ et {{prix}}');
});

test('the server refusal shows under its field; the placeholder shows the global text', () => {
  render(<Harness errorEn="Variable inconnue : {{prix}}" placeholderFr="Texte commun {{price}}" />);
  // specs/guest-email-texts-made-simple.md rule 27 — the refusal in the brackets the field shows.
  expect(screen.getByText('Variable inconnue : ⟦prix⟧')).toBeInTheDocument();
  expect(screen.getByLabelText('Français')).toHaveAttribute('placeholder', 'Texte commun ⟦Prix⟧');
});
