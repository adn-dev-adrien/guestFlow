// specs/hosting-h2-account-security.md rule 7 — on the second-step screen, « Utiliser un code de
// secours » switches the code field to the letter keyboard, and the way back returns to the numeric
// keypad; a field without backup codes offers no switch.
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import OneTimeCodeField from '../OneTimeCodeField';

function Harness(props) {
  const [value, setValue] = useState('');
  return <OneTimeCodeField value={value} onChange={setValue} {...props} />;
}

test('rule 7 — « Utiliser un code de secours » switches to text input and back', () => {
  render(<Harness allowBackup />);
  const field = screen.getByLabelText('Code à 6 chiffres');
  expect(field.getAttribute('inputmode')).toBe('numeric');
  fireEvent.change(field, { target: { value: '123' } });

  fireEvent.click(screen.getByRole('button', { name: 'Utiliser un code de secours' }));
  const backup = screen.getByLabelText('Code de secours');
  expect(backup.getAttribute('inputmode')).toBe('text');
  expect(backup.value).toBe('');
  expect(document.activeElement).toBe(backup);
  fireEvent.change(backup, { target: { value: 'K7M2P-X9Q4R' } });
  expect(backup.value).toBe('k7m2p-x9q4r');

  fireEvent.click(screen.getByRole('button', { name: 'Utiliser le code de l’application' }));
  const back = screen.getByLabelText('Code à 6 chiffres');
  expect(back.getAttribute('inputmode')).toBe('numeric');
  expect(back.value).toBe('');
});

test('rule 7 — the way back is worded for the email method, and the switch never submits the form', () => {
  const onSubmit = vi.fn((e) => e.preventDefault());
  render(<form onSubmit={onSubmit}><Harness allowBackup primaryLinkLabel="Utiliser le code reçu par email" /></form>);
  fireEvent.click(screen.getByRole('button', { name: 'Utiliser un code de secours' }));
  expect(screen.getByRole('button', { name: 'Utiliser le code reçu par email' })).toBeTruthy();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('rule 7 — without backup codes there is no switch', () => {
  render(<Harness />);
  expect(screen.queryByRole('button', { name: 'Utiliser un code de secours' })).toBeNull();
});
