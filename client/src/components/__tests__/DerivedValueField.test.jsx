/**
 * DerivedValueField — a setting that defaults to another one unless overridden
 * (specs/settings-rationalization.md rule 12).
 */
import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import DerivedValueField from '../DerivedValueField';

function Controlled({ initial = '', onChange = () => {}, ...props }) {
  const [value, setValue] = useState(initial);
  return (
    <DerivedValueField
      label="Adresse d'envoi"
      derivedValue="contact@solio.fr"
      derivedFrom="l'email de contact"
      overrideLabel="Utiliser une autre adresse"
      value={value}
      onChange={(v) => { setValue(v); onChange(v); }}
      {...props}
    />
  );
}

test('an empty override shows the derived value, read-only, with its source', () => {
  render(<Controlled />);
  const field = screen.getByLabelText("Adresse d'envoi");
  expect(field).toHaveValue('contact@solio.fr');
  expect(field).toHaveAttribute('readonly');
  expect(screen.getByText("= l'email de contact")).toBeInTheDocument();
});

test('the link reveals an editable field whose placeholder is the derived value', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Controlled onChange={onChange} />);
  await user.click(screen.getByRole('button', { name: 'Utiliser une autre adresse' }));
  const field = screen.getByLabelText("Adresse d'envoi");
  expect(field).toHaveValue('');
  expect(field).toHaveAttribute('placeholder', 'contact@solio.fr');
  await user.type(field, 'x');
  expect(onChange).toHaveBeenLastCalledWith('x');
});

test('an override is editable at once, and « Revenir à la valeur déduite » clears it', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Controlled initial="no-reply@solio.fr" onChange={onChange} />);
  expect(screen.getByLabelText("Adresse d'envoi")).toHaveValue('no-reply@solio.fr');
  await user.click(screen.getByRole('button', { name: 'Revenir à la valeur déduite' }));
  expect(onChange).toHaveBeenLastCalledWith('');
  expect(screen.getByLabelText("Adresse d'envoi")).toHaveValue('contact@solio.fr');
});

test('a server error keeps the field open and shows the message', () => {
  render(<Controlled error="Adresse invalide." />);
  expect(screen.getByText('Adresse invalide.')).toBeInTheDocument();
  expect(screen.getByLabelText("Adresse d'envoi")).not.toHaveAttribute('readonly');
});
