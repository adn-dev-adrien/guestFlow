// specs/hosting-h2-account-security.md rules 32, 35 (review of PR #720) — whatever is typed or
// pasted, the field keeps the code inside it, so the 6th digit (or a whole backup code) always sends:
// no input leaves the user with nothing sent and nothing said.
import React, { useState } from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OneTimeCodeField, { extractCode, incompleteCodeMessage } from '../OneTimeCodeField';

function Harness({ onComplete, ...props }) {
  const [value, setValue] = useState('');
  return <OneTimeCodeField value={value} onChange={setValue} onComplete={onComplete} allowBackup {...props} />;
}

const setup = () => {
  const onComplete = vi.fn();
  render(<Harness onComplete={onComplete} />);
  return { onComplete, field: screen.getByLabelText('Code à 6 chiffres') };
};

test('rules 32, 35 — a backup code typed without its dash gets it back and is sent', () => {
  const { onComplete, field } = setup();
  fireEvent.change(field, { target: { value: 'K3PASY35NR' } });
  expect(field.value).toBe('k3pas-y35nr');
  expect(onComplete).toHaveBeenCalledWith('k3pas-y35nr');
});

test('rules 32, 35 — a pasted « 123-456 » is the 6-digit code, in six cells, and is sent', () => {
  const { onComplete, field } = setup();
  fireEvent.change(field, { target: { value: '123-456' } });
  expect(field.value).toBe('123456');
  expect(field.getAttribute('inputmode')).toBe('numeric');
  expect(screen.getAllByTestId('otp-cell')).toHaveLength(6);
  expect(onComplete).toHaveBeenCalledWith('123456');
});

test('rules 32, 35 — a 7th digit is dropped, the code was already sent once', () => {
  const { onComplete, field } = setup();
  fireEvent.change(field, { target: { value: '123456' } });
  fireEvent.change(field, { target: { value: '1234567' } });
  expect(field.value).toBe('123456');
  expect(onComplete).toHaveBeenCalledTimes(1);
});

test('rules 32, 35 — a pasted « Votre code : 123 456 » keeps the code only', () => {
  const { onComplete, field } = setup();
  fireEvent.change(field, { target: { value: 'Votre code : 123 456' } });
  expect(field.value).toBe('123456');
  expect(onComplete).toHaveBeenCalledWith('123456');
  expect(extractCode('Code de secours : k3pas-y35nr.', { allowBackup: true })).toBe('k3pas-y35nr');
});

test('rules 32, 35 — no length cap on the input, and the input is not hidden by opacity', () => {
  const { field } = setup();
  expect(field.hasAttribute('maxlength')).toBe(false);
  expect(getComputedStyle(field).opacity).not.toBe('0');
});

test('rule 35 — the reason a value cannot be sent yet', () => {
  expect(incompleteCodeMessage('1234')).toBe('Code incomplet : 6 chiffres.');
  expect(incompleteCodeMessage('k3pas-y3')).toBe('Code de secours incomplet : 10 caractères (xxxxx-xxxxx).');
});
