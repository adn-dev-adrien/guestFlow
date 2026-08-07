/**
 * ArithmeticTextField — commits an evaluated arithmetic expression on Enter/blur.
 * See specs/reservation-price-arithmetic.md.
 */
import React, { useState } from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ArithmeticTextField from '../ArithmeticTextField';

// Controlled harness mirroring how the form uses it (value + onCommit).
function Harness({ onCommit, initial = '' }) {
  const [value, setValue] = useState(initial);
  return (
    <ArithmeticTextField
      label="Prix"
      value={value}
      onCommit={(v) => { setValue(v); onCommit(v); }}
    />
  );
}

test('evaluates an expression on blur', async () => {
  const user = userEvent.setup();
  const onCommit = vi.fn();
  render(<Harness onCommit={onCommit} />);
  const input = screen.getByLabelText(/Prix/i);
  await user.type(input, '100+20');
  await user.tab(); // blur
  expect(onCommit).toHaveBeenLastCalledWith(120);
  expect(input).toHaveValue('120');
});

test('evaluates on Enter', async () => {
  const user = userEvent.setup();
  const onCommit = vi.fn();
  render(<Harness onCommit={onCommit} />);
  const input = screen.getByLabelText(/Prix/i);
  await user.type(input, '(100+20)*2{Enter}');
  expect(onCommit).toHaveBeenLastCalledWith(240);
});

test('does NOT commit on every keystroke', async () => {
  const user = userEvent.setup();
  const onCommit = vi.fn();
  render(<Harness onCommit={onCommit} />);
  await user.type(screen.getByLabelText(/Prix/i), '100+20');
  expect(onCommit).not.toHaveBeenCalled(); // only on blur/Enter
});

test('rounds to 2 decimals and clamps to >= 0', async () => {
  const user = userEvent.setup();
  const onCommit = vi.fn();
  render(<Harness onCommit={onCommit} />);
  const input = screen.getByLabelText(/Prix/i);
  await user.type(input, '100/3{Enter}');
  expect(onCommit).toHaveBeenLastCalledWith(33.33);
  await user.clear(input);
  await user.type(input, '10-50{Enter}');
  expect(onCommit).toHaveBeenLastCalledWith(0); // clamped
});

test('invalid expression reverts to the last committed value', async () => {
  const user = userEvent.setup();
  const onCommit = vi.fn();
  render(<Harness onCommit={onCommit} initial={150} />);
  const input = screen.getByLabelText(/Prix/i);
  await user.clear(input);
  await user.type(input, '100+');
  await user.tab();
  expect(input).toHaveValue('150'); // reverted
});

test('clearing the field commits an empty value', async () => {
  const user = userEvent.setup();
  const onCommit = vi.fn();
  render(<Harness onCommit={onCommit} initial={150} />);
  const input = screen.getByLabelText(/Prix/i);
  await user.clear(input);
  await user.tab();
  expect(onCommit).toHaveBeenLastCalledWith('');
});
