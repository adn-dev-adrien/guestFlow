// specs/ds-sweep-finance.md rule 24 — with `maxMonth`, the year list stops at its year and a year change
// that would land past it clamps the month: no pick can ask the server for a future month.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MonthYearPicker from '../MonthYearPicker';

const YEAR = new Date().getFullYear();
const MAX = `${YEAR}-06`;

test('rule 24 — the year after maxMonth\'s year is not offered', async () => {
  const user = userEvent.setup();
  render(<MonthYearPicker month={3} year={YEAR} onChange={vi.fn()} maxMonth={MAX} />);
  await user.click(screen.getByLabelText('Année'));
  const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
  expect(options).not.toContain(String(YEAR + 1));
  expect(options[0]).toBe(String(YEAR));
});

test('rule 24 — going from an earlier year to the max year clamps a later month to the max month', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<MonthYearPicker month={12} year={YEAR - 1} onChange={onChange} maxMonth={MAX} />);
  await user.click(screen.getByLabelText('Année'));
  await user.click(await screen.findByRole('option', { name: String(YEAR) }));
  expect(onChange).toHaveBeenCalledWith({ month: 6, year: YEAR });
});

test('rule 24 — an earlier month is kept on a year change, and without maxMonth nothing is clamped', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const { rerender } = render(<MonthYearPicker month={3} year={YEAR - 1} onChange={onChange} maxMonth={MAX} />);
  await user.click(screen.getByLabelText('Année'));
  await user.click(await screen.findByRole('option', { name: String(YEAR) }));
  expect(onChange).toHaveBeenLastCalledWith({ month: 3, year: YEAR });
  rerender(<MonthYearPicker month={12} year={YEAR - 1} onChange={onChange} />);
  await user.click(screen.getByLabelText('Année'));
  await user.click(await screen.findByRole('option', { name: String(YEAR + 1) }));
  expect(onChange).toHaveBeenLastCalledWith({ month: 12, year: YEAR + 1 });
});
