import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import QuantityField from '../QuantityField';

// specs/reservation-quantity-stepper.md §3 — the generic stepper input:
// local draft (no per-keystroke commit), clamp to [min,max], − / ＋ steppers, allowEmpty semantics.

// A controlled harness so multi-step interactions reflect committed values, mirroring real usage.
function Controlled({ initial = 0, onCommit, ...props }) {
  const [value, setValue] = useState(initial);
  return (
    <QuantityField
      {...props}
      value={value}
      onCommit={(v) => { onCommit?.(v); setValue(v); }}
    />
  );
}

test('typing does NOT commit per keystroke; blur commits the clamped value', () => {
  const onCommit = vi.fn();
  render(<QuantityField label="Qté" min={1} value={1} onCommit={onCommit} />);
  const input = screen.getByRole('textbox');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '3' } });
  expect(onCommit).not.toHaveBeenCalled(); // draft only
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith(3);
});

test('clearing then blur → min when allowEmpty is false (never 0)', () => {
  const onCommit = vi.fn();
  render(<QuantityField label="Qté" min={1} value={2} onCommit={onCommit} />);
  const input = screen.getByRole('textbox');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledWith(1);
});

test('clearing then blur → "" when allowEmpty is true', () => {
  const onCommit = vi.fn();
  render(<QuantityField label="Lits" min={0} allowEmpty value={2} onCommit={onCommit} />);
  const input = screen.getByRole('textbox');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledWith('');
});

test('blur clamps to max', () => {
  const onCommit = vi.fn();
  render(<QuantityField label="Qté" min={1} max={4} value={2} onCommit={onCommit} />);
  const input = screen.getByRole('textbox');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '9' } });
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledWith(4);
});

test('invalid text reverts to the last committed value (no commit)', () => {
  const onCommit = vi.fn();
  render(<QuantityField label="Qté" min={1} value={3} onCommit={onCommit} />);
  const input = screen.getByRole('textbox');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'abc' } });
  fireEvent.blur(input);
  expect(onCommit).not.toHaveBeenCalled();
});

test('＋ / − step the value and commit immediately', () => {
  const onCommit = vi.fn();
  render(<Controlled label="Qté" min={1} initial={2} onCommit={onCommit} />);
  fireEvent.click(screen.getByRole('button', { name: /Augmenter/i }));
  expect(onCommit).toHaveBeenLastCalledWith(3);
  fireEvent.click(screen.getByRole('button', { name: /Diminuer/i }));
  expect(onCommit).toHaveBeenLastCalledWith(2);
});

test('− is disabled at min and ＋ is disabled at max', () => {
  render(<QuantityField label="Qté" min={1} max={4} value={1} onCommit={() => {}} />);
  expect(screen.getByRole('button', { name: /Diminuer/i })).toBeDisabled();
  render(<QuantityField label="Qté" min={1} max={4} value={4} onCommit={() => {}} />);
  expect(screen.getAllByRole('button', { name: /Augmenter/i }).pop()).toBeDisabled();
});

test('disabled disables the input and both steppers', () => {
  render(<QuantityField label="Qté" min={1} value={2} onCommit={() => {}} disabled />);
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: /Diminuer/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /Augmenter/i })).toBeDisabled();
});

test('ArrowUp / ArrowDown step the value', () => {
  const onCommit = vi.fn();
  render(<Controlled label="Qté" min={0} initial={2} onCommit={onCommit} />);
  const input = screen.getByRole('textbox');
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(onCommit).toHaveBeenLastCalledWith(3);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(onCommit).toHaveBeenLastCalledWith(2);
});
