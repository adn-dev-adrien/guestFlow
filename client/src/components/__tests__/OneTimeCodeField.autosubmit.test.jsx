// specs/hosting-h2-account-security.md rules 32–33 (UI/UX review 2026-10-18, proposal 23) — one
// native one-time-code input drawn as six cells: sent once at the 6th digit (or a whole backup code),
// nothing before; a refusal under the cells, the digits kept and selected so the next keystroke
// replaces them.
import React, { useState } from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OneTimeCodeField from '../OneTimeCodeField';

function Harness({ onComplete, error: initialError = '', ...props }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(initialError);
  return (
    <>
      <OneTimeCodeField value={value} onChange={(v) => { setValue(v); setError(''); }} onComplete={onComplete} error={error} {...props} />
      <button type="button" onClick={() => setError('Code incorrect.')}>refuser</button>
    </>
  );
}

test('rule 32 — one input with one-time-code autofill, drawn as six cells that mirror it', () => {
  render(<Harness />);
  const field = screen.getByLabelText('Code à 6 chiffres');
  expect(screen.getAllByLabelText(/Code/)).toHaveLength(1);
  expect(field.getAttribute('autocomplete')).toBe('one-time-code');
  expect(field.getAttribute('inputmode')).toBe('numeric');
  fireEvent.change(field, { target: { value: '4 2a7' } });
  expect(field.value).toBe('427');
  expect(screen.getAllByTestId('otp-cell').map((c) => c.textContent)).toEqual(['4', '2', '7', '', '', '']);
});

test('rule 32 — typed digit by digit, the code is sent once, at the 6th', () => {
  const onComplete = vi.fn();
  render(<Harness onComplete={onComplete} />);
  const field = screen.getByLabelText('Code à 6 chiffres');
  ['1', '12', '123', '1234', '12345'].forEach((v) => fireEvent.change(field, { target: { value: v } }));
  expect(onComplete).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: '123456' } });
  fireEvent.change(field, { target: { value: '1234567' } });
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(onComplete).toHaveBeenCalledWith('123456');
});

test('rule 32 — a pasted or autofilled code is sent at once; a whole backup code too', () => {
  const onComplete = vi.fn();
  render(<Harness onComplete={onComplete} allowBackup />);
  const field = screen.getByLabelText('Code à 6 chiffres');
  fireEvent.change(field, { target: { value: '246 810' } });
  expect(onComplete).toHaveBeenLastCalledWith('246810');
  fireEvent.change(field, { target: { value: 'K7M2P-X9Q4' } });
  expect(onComplete).toHaveBeenCalledTimes(1);
  fireEvent.change(field, { target: { value: 'K7M2P-X9Q4R' } });
  expect(onComplete).toHaveBeenLastCalledWith('k7m2p-x9q4r');
  expect(onComplete).toHaveBeenCalledTimes(2);
});

test('rule 33 — a refusal sits under the cells, keeps the digits selected, and leaves when typing again', () => {
  render(<Harness />);
  const field = screen.getByLabelText('Code à 6 chiffres');
  fireEvent.change(field, { target: { value: '000000' } });
  fireEvent.click(screen.getByRole('button', { name: 'refuser' }));
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Code incorrect.');
  expect(field.getAttribute('aria-invalid')).toBe('true');
  expect(field.getAttribute('aria-describedby')).toBe(alert.id);
  expect(field.value).toBe('000000');
  expect(document.activeElement).toBe(field);
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, 6]);
  fireEvent.change(field, { target: { value: '1' } });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(field.getAttribute('aria-invalid')).toBeNull();
});
