/**
 * PeriodSelector — specs/finance-dashboard-redesign.md rule 51, second reading of 2026-11-02: a custom window
 * starting before today − 5 years (specs/reservations-backend-mvc.md rule 13, past side) is refused on the spot
 * with the server's message, and never sent.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import PeriodSelector, { customWindowError, PERIOD_MESSAGES } from '../PeriodSelector';
import { horizonStart } from '../../utils/dateHorizon';
import { addIsoDays } from '../../utils/isoDay';

const S = horizonStart();

test('rule 51 (past reading of 2026-11-02) — « du » on today − 5 years passes, one day earlier is refused', () => {
  expect(PERIOD_MESSAGES.tooOld).toBe('Date trop ancienne : 5 ans au plus.');
  expect(customWindowError(S, addIsoDays(S, 30))).toBe('');
  expect(customWindowError(addIsoDays(S, -1), addIsoDays(S, 30))).toBe(PERIOD_MESSAGES.tooOld);
});

test('rule 51 (past reading of 2026-11-02) — « du » typed before the window shows the refusal and is not sent', () => {
  const onChange = vi.fn();
  const to = addIsoDays(S, 30);
  render(<PeriodSelector kind="custom" from={addIsoDays(S, 1)} to={to} months={[]} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Du'), { target: { value: addIsoDays(S, -1) } });
  expect(screen.getByRole('alert')).toHaveTextContent(PERIOD_MESSAGES.tooOld);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Du'), { target: { value: S } });
  expect(onChange).toHaveBeenCalledWith({ kind: 'custom', from: S, to });
});
