/**
 * PeriodSelector — specs/finance-dashboard-redesign.md rule 51, reading of 2026-11-02: a custom window
 * ending past the date horizon (today + 5 years, specs/reservations-backend-mvc.md rule 13) is refused
 * on the spot with the server's message, and never sent.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import PeriodSelector, { customWindowError, PERIOD_MESSAGES } from '../PeriodSelector';
import { horizonEnd } from '../../utils/dateHorizon';
import { addIsoDays } from '../../utils/isoDay';

const H = horizonEnd();

test('rule 51 (reading of 2026-11-02) — « au » on the horizon passes, one day past it is refused', () => {
  expect(PERIOD_MESSAGES.tooFar).toBe('Date trop lointaine : 5 ans au plus.');
  expect(customWindowError(addIsoDays(H, -30), H)).toBe('');
  expect(customWindowError(addIsoDays(H, -30), addIsoDays(H, 1))).toBe(PERIOD_MESSAGES.tooFar);
});

test('rule 51 (reading of 2026-11-02) — « au » typed past the horizon shows the refusal and is not sent', () => {
  const onChange = vi.fn();
  const from = addIsoDays(H, -30);
  render(<PeriodSelector kind="custom" from={from} to={addIsoDays(H, -1)} months={[]} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Au'), { target: { value: addIsoDays(H, 1) } });
  expect(screen.getByRole('alert')).toHaveTextContent(PERIOD_MESSAGES.tooFar);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Au'), { target: { value: H } });
  expect(onChange).toHaveBeenCalledWith({ kind: 'custom', from, to: H });
});
