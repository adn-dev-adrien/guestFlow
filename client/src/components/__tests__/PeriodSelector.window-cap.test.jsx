/**
 * PeriodSelector — specs/finance-dashboard-redesign.md rule 51: a custom window wider than the
 * server's cap is refused on the spot with the server's message, and never sent.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import PeriodSelector, { customWindowError, PERIOD_MESSAGES } from '../PeriodSelector';

const YEAR = new Date().getFullYear();
const plusDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

test('rule 51 — two whole years pass, one day past 750 is refused', () => {
  expect(customWindowError(`${YEAR - 1}-01-01`, `${YEAR}-12-31`)).toBe('');
  expect(customWindowError(`${YEAR}-01-01`, plusDays(`${YEAR}-01-01`, 750))).toBe('');
  expect(customWindowError(`${YEAR}-01-01`, plusDays(`${YEAR}-01-01`, 751))).toBe(PERIOD_MESSAGES.tooWide);
  expect(PERIOD_MESSAGES.tooWide).toBe('Période trop longue : 750 jours au plus.');
});

test('rule 51 — « au » typed as 9999 shows the refusal and the page keeps its window', () => {
  const onChange = vi.fn();
  render(<PeriodSelector kind="custom" from={`${YEAR}-11-01`} to={`${YEAR}-11-30`} months={[]} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Au'), { target: { value: '9999-11-30' } });
  expect(screen.getByRole('alert')).toHaveTextContent(PERIOD_MESSAGES.tooWide);
  expect(onChange).not.toHaveBeenCalled();
});
