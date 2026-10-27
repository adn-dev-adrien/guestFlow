// 2026-10-27 spec review (F13) — the per-logement grid printed the stored platform (« direct ») and cut
// the month badge out of the full name (« Nove. 2026 »). specs/calendar-page-decomposition.md rule 10.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import CalendarDayCell from '../CalendarDayCell';
import { MONTH_SHORT_NAMES } from '../../utils/calendarVisuals';

const handlers = {
  onReservationClick: vi.fn(), onMouseDown: vi.fn(), onMouseEnter: vi.fn(),
  onOpenNote: vi.fn(), onOpenNewReservation: vi.fn(), onDevisClick: vi.fn(),
};

test('a mid-stay label names the platform with its display label', () => {
  render(
    <CalendarDayCell
      day={1} y={2026} m={10} dim={30}
      reservations={[{ id: 2, startDate: '2026-10-29', endDate: '2026-11-03', firstName: 'Jean-Baptiste', lastName: 'De La Fontaine-Montgolfier', platform: 'direct' }]}
      devisList={[]} closures={[]} selectedProp={1}
      publicHolidays={new Set()} today="2026-10-27" cleaningHours={3}
      inDrag={false} isDragging={false}
      {...handlers}
    />,
  );
  expect(screen.getByText('Direct')).toBeInTheDocument();
  expect(screen.queryByText('direct')).toBeNull();
});

test('the month badge reads the French abbreviation', () => {
  expect(MONTH_SHORT_NAMES[9]).toBe('Oct.');
  expect(MONTH_SHORT_NAMES[10]).toBe('Nov.');
  expect(MONTH_SHORT_NAMES[5]).not.toBe(MONTH_SHORT_NAMES[6]);
});
