// specs/plugins-phase-3c-hourly-resources.md rule 31 — « Ajouter une séance » proposes the first free
// slot of the stay after the check-in on arrival day (review 2026-10-18, F4/F5: the second session
// landed on the first one, and both before a 16:00 check-in).
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import ResourceSessionsPicker from '../ResourceSessionsPicker';
import { nextFreeSession, dayWindow } from '../resourceSessions';

const BATH = { openTime: '11:00', closeTime: '22:00', slotDuration: 60, minimumUsageMinutes: 60 };
const STAY = { startDate: '2026-11-13', endDate: '2026-11-16', checkInTime: '16:00', checkOutTime: '10:00' };

test('the first session starts at the check-in on arrival day, not at the opening', async () => {
  const onSessionsChange = vi.fn();
  render(<ResourceSessionsPicker resource={BATH} sessions={[]} stay={STAY} onSessionsChange={onSessionsChange} />);
  await userEvent.click(screen.getByRole('button', { name: /Ajouter une séance/ }));
  expect(onSessionsChange).toHaveBeenCalledWith([{ date: '2026-11-13', start: '16:00', end: '17:00' }]);
});

test('the next session takes the next free slot, never the one already placed', async () => {
  const onSessionsChange = vi.fn();
  const first = { date: '2026-11-13', start: '16:00', end: '17:00' };
  render(<ResourceSessionsPicker resource={BATH} sessions={[first]} stay={STAY} onSessionsChange={onSessionsChange} />);
  await userEvent.click(screen.getByRole('button', { name: /Ajouter une séance/ }));
  expect(onSessionsChange).toHaveBeenCalledWith([first, { date: '2026-11-13', start: '17:00', end: '18:00' }]);
});

test('on departure day only slots ending by the check-out count; a full stay disables the button', () => {
  expect(dayWindow('2026-11-16', { stay: STAY, openTime: '11:00', closeTime: '22:00' }).hi).toBe(600);
  const short = { startDate: '2026-11-13', endDate: '2026-11-13', checkInTime: '21:00', checkOutTime: '10:00' };
  expect(nextFreeSession({
    days: ['2026-11-13'], times: ['21:00', '22:00'], sessions: [{ date: '2026-11-13', start: '21:00', end: '22:00' }],
    durationMinutes: 60, stay: short, openTime: '11:00', closeTime: '22:00',
  })).toBeNull();
});

test('a stay without check-in time keeps the opening hours', () => {
  expect(dayWindow('2026-11-13', { stay: { startDate: '2026-11-13' }, openTime: '11:00', closeTime: '22:00' })).toEqual({ lo: 660, hi: 1320 });
});
