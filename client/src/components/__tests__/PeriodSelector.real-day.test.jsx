/**
 * PeriodSelector — specs/finance-dashboard-redesign.md rule 51, reading of 2026-11-03 (audit R20-C1): a custom date
 * that is not a real `YYYY-MM-DD` day (a 5- or 6-digit year typed on the keyboard, 30 February) or a missing date is
 * refused on the spot with the server's « Deux dates à choisir. », and never sent. A year still being typed (padded
 * to four digits) is a real day: the window speaks.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import PeriodSelector, { customWindowError, PERIOD_MESSAGES } from '../PeriodSelector';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

const T = localIsoToday();
const FROM = addIsoDays(T, -20);
const TO = addIsoDays(T, 10);
const feb30 = `${Number(T.slice(0, 4)) - 1}-02-30`;

test.each([
  ['a 5-digit year', FROM, `2${TO}`],
  ['a 6-digit year', `20${FROM}`, TO],
  ['30 February', feb30, TO],
  ['one date only', FROM, ''],
])('rule 51 (R20) — %s is refused as a missing date', (_name, from, to) => {
  expect(customWindowError(from, to, T)).toBe(PERIOD_MESSAGES.missingDates);
});

test('rule 51 (R20) — a padded half-typed year is a real day, refused by the window, not as missing', () => {
  expect(customWindowError(`0002${FROM.slice(4)}`, TO, T)).toBe(PERIOD_MESSAGES.tooWide);
});

test('rule 51 (R20) — a 5-digit « Au » typed shows the refusal and is not sent', () => {
  const onChange = vi.fn();
  render(<PeriodSelector kind="custom" from={FROM} to={TO} months={[]} onChange={onChange} today={T} />);
  fireEvent.change(screen.getByLabelText('Au'), { target: { value: `2${TO}` } });
  expect(screen.getByRole('alert')).toHaveTextContent(PERIOD_MESSAGES.missingDates);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Au'), { target: { value: TO } });
  expect(onChange).toHaveBeenCalledWith({ kind: 'custom', from: FROM, to: TO });
});
