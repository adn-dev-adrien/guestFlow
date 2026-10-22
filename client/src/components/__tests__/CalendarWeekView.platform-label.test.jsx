/**
 * CalendarWeekView — the platform on an arrival / departure line is written through
 * formatPlatformLabel (specs/normalize-platform-names.md rule 21).
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import CalendarWeekView from '../CalendarWeekView';

const TODAY = '2026-07-08';
const RES = [
  { id: 1, startDate: '2026-07-06', endDate: '2026-07-08', firstName: 'Jane', lastName: 'Smith', platform: 'airbnb', checkInTime: '15:00', checkOutTime: '10:00' },
  { id: 2, startDate: '2026-07-10', endDate: '2026-07-13', firstName: 'Marc', lastName: 'Pino', platform: 'direct', checkInTime: '16:00', checkOutTime: '11:00' },
];

test('rule 21 — arrival and departure lines carry the display label, not the stored value', () => {
  render(
    <CalendarWeekView
      today={TODAY}
      reservations={RES}
      devisList={[]}
      closures={[]}
      selectedProp={1}
      calendarNotes={{}}
      publicHolidays={new Set()}
      schoolHolidays={[]}
      onReservationClick={vi.fn()}
      onDevisClick={vi.fn()}
      onOpenNewReservation={vi.fn()}
      onOpenNote={vi.fn()}
      onWeekChange={vi.fn()}
    />,
  );
  expect(screen.getByText('16:00 · Direct')).toBeInTheDocument();
  expect(screen.getByText('10:00 · Airbnb')).toBeInTheDocument();
  expect(screen.queryByText(/· direct$/)).toBeNull();
});
