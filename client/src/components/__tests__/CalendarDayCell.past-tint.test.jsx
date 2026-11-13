// specs/calendar-property-parity.md rule 8 (amended 2026-11-12) — a stay the server says is past is drawn in its soft tint
// by the day cells too, not as the full platform colour dimmed by the cell's own date: a past stay of a dark platform
// (Booking blue) stayed darker than the ribbon over it. A stay still to come keeps its solid colour.
import React from 'react';
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import CalendarDayCell from '../CalendarDayCell';

const handlers = {
  onReservationClick: vi.fn(), onMouseDown: vi.fn(), onMouseEnter: vi.fn(),
  onOpenNote: vi.fn(), onOpenNewReservation: vi.fn(), onDevisClick: vi.fn(),
};
const stay = (over) => ({
  // date-literal-ok: `today` is an injected prop
  id: 1, startDate: '2026-11-06', endDate: '2026-11-08', checkInTime: '12:00', checkOutTime: '10:00',
  firstName: 'A', lastName: 'B', platform: 'Booking', platformDisplay: 'Booking', color: '#1B3F8B', textColor: '#FFFFFF', past: true, ...over,
});

function cell(day, reservations) {
  return render(
    <ThemeProvider theme={theme}>
      <CalendarDayCell
        day={day} y={2026} m={10} reservations={reservations} devisList={[]} closures={[]} selectedProp={1}
        // date-literal-ok: `today` is an injected prop
        publicHolidays={new Set()} today="2026-11-12" cleaningHours={3} inDrag={false} isDragging={false} {...handlers}
      />
    </ThemeProvider>,
  ).container.querySelector('[data-date]');
}

test('a mid-stay day of a past stay is the 14 % tint at full opacity, not the solid colour dimmed', () => {
  const el = cell(7, [stay({})]);
  expect(getComputedStyle(el).backgroundColor).toBe('rgba(27, 63, 139, 0.14)');
  expect(getComputedStyle(el).opacity).toBe('1');
});

test('a mid-stay day of a stay still to come keeps its solid colour', () => {
  // date-literal-ok: `today` is an injected prop
  const el = cell(7, [stay({ past: false, startDate: '2026-11-06', endDate: '2026-11-20' })]);
  expect(getComputedStyle(el).backgroundColor).toBe('rgb(27, 63, 139)');
});

test('the tooltip of a departure day names the platform', () => {
  const el = cell(8, [stay({})]);
  expect(el.getAttribute('title')).toMatch(/Départ: A B \(Booking\) à 10:00/);
});
