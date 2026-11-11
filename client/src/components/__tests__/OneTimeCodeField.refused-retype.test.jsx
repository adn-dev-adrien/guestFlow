// specs/hosting-h2-account-security.md rule 56 — after a refused code the next code replaces it: the
// whole code is selected on focus and click, typing or pasting into a complete code keeps what was just
// inserted, and a field held by a check in flight is `readOnly`, never `disabled` (a phone keeps its keyboard).
import React, { useState } from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OneTimeCodeField from '../OneTimeCodeField';

function Harness({ onComplete = () => {}, initial = '', readOnly, allowBackup }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  return (
    <OneTimeCodeField
      value={value}
      onChange={(v) => { setValue(v); setError(''); }}
      onComplete={(c) => { onComplete(c); if (c === '000000') setError('Code incorrect.'); }}
      error={error}
      readOnly={readOnly}
      allowBackup={allowBackup}
    />
  );
}

test('rule 56: type a refused code, click the field, type another: the new code is sent', async () => {
  const user = userEvent.setup();
  const onComplete = vi.fn();
  render(<Harness onComplete={onComplete} />);
  const field = screen.getByLabelText('Code à 6 chiffres');
  await user.type(field, '000000');
  expect(await screen.findByText('Code incorrect.')).toBeInTheDocument();
  await user.click(field);
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(6);
  await user.keyboard('111111');
  expect(field.value).toBe('111111');
  expect(onComplete).toHaveBeenLastCalledWith('111111');
});

test('rule 56: even with the caret at the end, typing into a refused code keeps the new digits; without a refusal it is dropped (rule 35)', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const field = screen.getByLabelText('Code à 6 chiffres');
  await user.type(field, '123456');
  fireEvent.change(field, { target: { value: '1234567' } });
  expect(field.value).toBe('123456');
  await user.clear(field);
  await user.type(field, '000000');
  await screen.findByText('Code incorrect.');
  field.setSelectionRange(6, 6);
  fireEvent.change(field, { target: { value: '0000007' } });
  expect(field.value).toBe('7');
});

test('rule 56: pasting a code over a refused one replaces it', async () => {
  const user = userEvent.setup();
  const onComplete = vi.fn();
  render(<Harness onComplete={onComplete} initial="000000" />);
  const field = screen.getByLabelText('Code à 6 chiffres');
  await user.click(field);
  await user.paste('Votre code : 654 321');
  expect(field.value).toBe('654321');
  expect(onComplete).toHaveBeenLastCalledWith('654321');
});

test('rule 56: a held field is readOnly, not disabled, so the focus stays', () => {
  render(<Harness initial="123" readOnly />);
  const field = screen.getByLabelText('Code à 6 chiffres');
  expect(field).toHaveAttribute('readonly');
  expect(field).not.toBeDisabled();
  field.focus();
  expect(document.activeElement).toBe(field);
});

test('rule 56: an incomplete code is typed on as before', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const field = screen.getByLabelText('Code à 6 chiffres');
  await user.type(field, '123');
  await user.type(field, '456');
  expect(field.value).toBe('123456');
});
