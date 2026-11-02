/**
 * PeriodSelector — specs/finance-dashboard-redesign.md rule 51 + specs/reservations-backend-mvc.md rule 13, second
 * reading (review of PR #938, F8 / V2): a custom window is judged from the `today` the page hands in (the server's
 * day), not the device's.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import PeriodSelector, { PERIOD_MESSAGES } from '../PeriodSelector';
import { horizonStart } from '../../utils/dateHorizon';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

const SERVER_TODAY = addIsoDays(localIsoToday(), 400);

test('rule 51 — « du » inside the device\'s window but before the server\'s is refused on the spot and never sent', () => {
  const onChange = vi.fn();
  const from = addIsoDays(horizonStart(localIsoToday()), 30);
  const to = addIsoDays(from, 30);
  render(<PeriodSelector kind="custom" from={addIsoDays(from, 1)} to={to} months={[]} onChange={onChange} today={SERVER_TODAY} />);
  fireEvent.change(screen.getByLabelText('Du'), { target: { value: from } });
  expect(screen.getByRole('alert')).toHaveTextContent(PERIOD_MESSAGES.tooOld);
  expect(onChange).not.toHaveBeenCalled();
  const serverStart = horizonStart(SERVER_TODAY);
  fireEvent.change(screen.getByLabelText('Du'), { target: { value: serverStart } });
  fireEvent.change(screen.getByLabelText('Au'), { target: { value: addIsoDays(serverStart, 30) } });
  expect(onChange).toHaveBeenLastCalledWith({ kind: 'custom', from: serverStart, to: addIsoDays(serverStart, 30) });
});
