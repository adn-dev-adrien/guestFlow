// specs/calendar-property-parity.md rule 12 — the logement calendar draws a closure like a stay: hatched on
// the second half of its first day, on the first half of its reopening day, all day between; the free half of
// the reopening day still starts a selection.
import React from 'react';
import { vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import CalendarDayCell from '../CalendarDayCell';
import { getClosureDayParts } from '../../utils/closureCalendar';

const closures = [{ id: 1, propertyId: 1, label: 'Travaux', startDate: '2026-11-10', endDate: '2026-11-13' }];
const handlers = {
  onReservationClick: vi.fn(), onMouseDown: vi.fn(), onMouseEnter: vi.fn(),
  onOpenNote: vi.fn(), onOpenNewReservation: vi.fn(), onDevisClick: vi.fn(),
};

function cell(day, props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <CalendarDayCell
        day={day} y={2026} m={10} reservations={[]} devisList={[]} closures={closures} selectedProp={1}
        publicHolidays={new Set()} today="2026-10-28" cleaningHours={3} inDrag={false} isDragging={false}
        {...handlers} {...props}
      />
    </ThemeProvider>,
  ).container.querySelector('[data-date]');
}
const image = (el) => getComputedStyle(el).backgroundImage;
const rect = { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 };

beforeEach(() => vi.clearAllMocks());

test('getClosureDayParts — start, between, reopening, open', () => {
  expect(getClosureDayParts('2026-11-10', closures, 1).part).toBe('start');
  expect(getClosureDayParts('2026-11-11', closures, 1).part).toBe('full');
  expect(getClosureDayParts('2026-11-13', closures, 1).part).toBe('end');
  expect(getClosureDayParts('2026-11-14', closures, 1)).toBeNull();
  expect(getClosureDayParts('2026-11-11', closures, 2)).toBeNull();
});

test('the start day is hatched on its second half: a plain first half masks the hatching', () => {
  const bg = image(cell(10));
  expect(bg).toMatch(/repeating-linear-gradient/);
  expect(bg).toMatch(/linear-gradient\(135deg, rgb\([^)]*\) 0\S* 50%, transparent 50%\)/);
});

test('the reopening day is hatched on its first half: a plain second half masks the hatching', () => {
  const bg = image(cell(13));
  expect(bg).toMatch(/repeating-linear-gradient/);
  expect(bg).toMatch(/linear-gradient\(135deg, transparent 0(%)? 50%/);
});

test('a day between is hatched all day and says « Travaux »', () => {
  const el = cell(11);
  expect(image(el)).toMatch(/repeating-linear-gradient/);
  expect(el).toHaveTextContent('Travaux');
});

test('the free half of the reopening day starts a selection, the closed half does not', () => {
  const el = cell(13);
  el.getBoundingClientRect = () => rect;
  fireEvent.mouseDown(el, { clientX: 5, clientY: 5 });
  expect(handlers.onMouseDown).not.toHaveBeenCalled();
  fireEvent.mouseDown(el, { clientX: 90, clientY: 90 });
  expect(handlers.onMouseDown).toHaveBeenCalledWith(13, 2026, 10);
});

test('a closure never opens a fiche', () => {
  const el = cell(10);
  el.getBoundingClientRect = () => rect;
  fireEvent.click(el, { clientX: 90, clientY: 90 });
  expect(handlers.onReservationClick).not.toHaveBeenCalled();
});
