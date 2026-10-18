// specs/upcoming-reservations-cards.md rule 7 (amended 2026-10-18) — a form that defaults to « today »
// takes the browser's calendar day, not the UTC one: at 01:54 in Paris on the 18th the refund date
// read the 17th (review of PR #700, finding 4).
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import RefundDialog from '../RefundDialog';
import { localIsoDate } from '../../../utils/localDate';

afterEach(() => { vi.useRealTimers(); });

test('rule 7 — the refund date defaults to the calendar day, not UTC\'s', () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-10-17T23:54:00Z'));
  render(<RefundDialog open onClose={() => {}} refundableLines={[]} collectedTtc={0} onSubmit={() => {}} />);
  if (process.env.TZ === 'Europe/Paris') expect(localIsoDate()).toBe('2026-10-18');
  const field = screen.getByLabelText('Date du remboursement');
  expect(field).toHaveValue(localIsoDate());
  expect(field).toHaveAttribute('max', localIsoDate());
});
