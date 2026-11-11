/**
 * specs/reservation-price-arithmetic.md rule 10 — a committed amount reads as money (« 7,20 »), never
 * as the raw number (« 7.2 », review 2026-10-18, F9), and still parses back unchanged.
 */
import React, { useState } from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ArithmeticTextField from '../ArithmeticTextField';
import { formatAmountInput } from '../../utils/formatters';

function Harness({ onCommit, initial = '' }) {
  const [value, setValue] = useState(initial);
  return <ArithmeticTextField label="Taxe" value={value} onCommit={(v) => { setValue(v); onCommit(v); }} />;
}

test('rule 10 — a stored 7.2 shows as 7,20', () => {
  render(<Harness onCommit={vi.fn()} initial={7.2} />);
  expect(screen.getByLabelText('Taxe')).toHaveValue('7,20');
});

test('rule 10 — the shown amount commits back to the same number', async () => {
  const user = userEvent.setup();
  const onCommit = vi.fn();
  render(<Harness onCommit={onCommit} initial={1234.5} />);
  const input = screen.getByLabelText('Taxe');
  expect(input).toHaveValue('1234,50');
  await user.click(input);
  await user.tab();
  expect(onCommit).toHaveBeenLastCalledWith(1234.5);
});

test('rule 10 — formatAmountInput: two decimals, a comma, empty stays empty', () => {
  expect(formatAmountInput(7.2)).toBe('7,20');
  expect(formatAmountInput(0)).toBe('0,00');
  expect(formatAmountInput('')).toBe('');
  expect(formatAmountInput(null)).toBe('');
});
