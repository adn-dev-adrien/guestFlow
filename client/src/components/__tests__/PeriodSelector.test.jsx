/**
 * PeriodSelector — specs/finance-dashboard-redesign.md rules 1-2: the three window kinds, and a
 * custom window with reversed or missing dates refused on the spot, the page keeping its window.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import PeriodSelector, { customWindowError, PERIOD_MESSAGES } from '../PeriodSelector';

const MONTHS = [{ month: '2026-06', label: 'juin 2026' }, { month: '2026-07', label: 'juillet 2026' }];

test('rule 1 — switching to Mois hands the page a month window', () => {
  const onChange = vi.fn();
  render(<PeriodSelector kind="fy" month="2026-07" months={MONTHS} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mois' }));
  expect(onChange).toHaveBeenCalledWith({ kind: 'month', month: '2026-07' });
});

test('rule 2 — a start after the end is refused with the server message, and not sent', () => {
  const onChange = vi.fn();
  render(<PeriodSelector kind="custom" from="2026-06-01" to="2026-06-30" months={MONTHS} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2026-07-15' } });
  expect(screen.getByRole('alert')).toHaveTextContent(PERIOD_MESSAGES.reversed);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Au'), { target: { value: '2026-08-15' } });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(onChange).toHaveBeenCalledWith({ kind: 'custom', from: '2026-07-15', to: '2026-08-15' });
});

test('rule 2 — a missing date is refused', () => {
  expect(customWindowError('', '2026-06-30')).toBe(PERIOD_MESSAGES.missingDates);
  expect(customWindowError('2026-06-01', '2026-06-01')).toBe('');
});
