/**
 * PeriodSelector — specs/finance-dashboard-redesign.md rules 1-2: the three window kinds, and a
 * custom window with reversed or missing dates refused on the spot, the page keeping its window. The
 * custom dates hang on today, since the window of rule 51 judges them (specs/server-test-isolation.md rule 6).
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import PeriodSelector, { customWindowError, PERIOD_MESSAGES } from '../PeriodSelector';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

const MONTHS = [{ month: '2026-06', label: 'juin 2026' }, { month: '2026-07', label: 'juillet 2026' }];
const FROM = addIsoDays(localIsoToday(), -155);
const at = (n) => addIsoDays(FROM, n);

test('rule 1 — switching to Mois hands the page a month window', () => {
  const onChange = vi.fn();
  render(<PeriodSelector kind="fy" month="2026-07" months={MONTHS} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mois' }));
  expect(onChange).toHaveBeenCalledWith({ kind: 'month', month: '2026-07' });
});

test('rule 2 — a start after the end is refused with the server message, and not sent', () => {
  const onChange = vi.fn();
  render(<PeriodSelector kind="custom" from={FROM} to={at(29)} months={MONTHS} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Du'), { target: { value: at(44) } });
  expect(screen.getByRole('alert')).toHaveTextContent(PERIOD_MESSAGES.reversed);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Au'), { target: { value: at(75) } });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(onChange).toHaveBeenCalledWith({ kind: 'custom', from: at(44), to: at(75) });
});

test('rule 2 — a missing date is refused', () => {
  expect(customWindowError('', at(29))).toBe(PERIOD_MESSAGES.missingDates);
  expect(customWindowError(FROM, FROM)).toBe('');
});
