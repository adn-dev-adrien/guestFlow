// specs/calendar-property-parity.md rules 16, 18-20 — a guest's name is one ribbon per week segment laid over
// the stay, never shrunk vertically, truncated only by width with the full text on hover and in its name;
// the greyed days at either end of a block are real, interactive days.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import CalendarMonthGrid from '../CalendarMonthGrid';
import CalendarDayCell, { CELL_TOP_BAND_H } from '../CalendarDayCell';

const stay = (extra = {}) => ({
  id: 7, propertyId: 1, propertyName: 'Granja', startDate: '2026-12-29', endDate: '2027-01-02', label: 'Jean-Baptiste Montgolfier',
  platform: 'direct', platformDisplay: 'Direct', color: '#2F5D46', textColor: '#FFFFFF', past: false,
  checkInTime: '16:00', checkOutTime: '10:00', ...extra,
});
const handlers = {
  onReservationClick: vi.fn(), onMouseDown: vi.fn(), onMouseEnter: vi.fn(),
  onOpenNote: vi.fn(), onOpenNewReservation: vi.fn(), onDevisClick: vi.fn(),
};

function renderGrid({ stays = [stay()], closures = [], year = 2026, month = 11, onReservationClick = vi.fn(), cellProps = {} } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <CalendarMonthGrid
        year={year}
        month={month}
        stays={stays}
        closures={closures}
        onReservationClick={onReservationClick}
        renderCell={(d, y, m, outside) => (
          <CalendarDayCell
            key={`${y}-${m}-${d}`} day={d} y={y} m={m} outside={outside}
            reservations={stays} devisList={[]} closures={[]} selectedProp={1}
            publicHolidays={new Set(['2026-12-25'])} today="2026-10-28" cleaningHours={3}
            inDrag={false} isDragging={false} {...handlers} {...cellProps}
          />
        )}
      />
    </ThemeProvider>,
  );
}

test('rule 18 — one ribbon per week segment, named after the stay, in its colour and text colour', () => {
  const { container } = renderGrid();
  const ribbons = container.querySelectorAll('[data-ribbon="r7"]');
  expect(ribbons).toHaveLength(1);
  const style = getComputedStyle(ribbons[0]);
  expect(style.backgroundColor).toBe('rgb(47, 93, 70)');
  expect(style.color).toBe('rgb(255, 255, 255)');
  expect(ribbons[0]).toHaveTextContent('Jean-Baptiste Montgolfier');
  expect(ribbons[0]).toHaveTextContent('Direct');
});

test('rule 18 — a stay crossing a month end is labelled in each block where it has a segment', () => {
  const dec = renderGrid();
  expect(dec.container.querySelectorAll('[data-ribbon="r7"]')).toHaveLength(1);
  dec.unmount();
  const jan = renderGrid({ year: 2027, month: 0 });
  expect(jan.container.querySelectorAll('[data-ribbon="r7"]')).toHaveLength(1);
});

test('rule 19 — the label is never height-constrained and carries the full name, platform and dates', () => {
  const { container } = renderGrid();
  const ribbon = container.querySelector('[data-ribbon="r7"]');
  expect(ribbon).toHaveAttribute('aria-label', 'Jean-Baptiste Montgolfier — Direct, 29 décembre → 2 janvier');
  [...ribbon.children].forEach((line) => {
    expect(getComputedStyle(line).flexShrink).toBe('0');
    expect(getComputedStyle(line).whiteSpace).toBe('nowrap');
  });
  fireEvent.click(ribbon);
});

test('rule 19 — Enter on a ribbon opens the fiche', () => {
  const onReservationClick = vi.fn();
  const { container } = renderGrid({ onReservationClick });
  fireEvent.keyDown(container.querySelector('[data-ribbon="r7"]'), { key: 'Enter' });
  expect(onReservationClick).toHaveBeenCalledWith(7);
});

test('rule 20 — the ribbon starts below the top band that holds the day number and the férié marker', () => {
  const { container } = renderGrid();
  expect(getComputedStyle(container.querySelector('[data-ribbon="r7"]')).top).toBe(`${CELL_TOP_BAND_H}px`);
  expect(screen.getAllByText('férié').length).toBeGreaterThan(0);
});

test('rule 16 — the greyed days of the neighbouring months are real days with their own content', () => {
  const { container } = renderGrid();
  const nextMonthDay = container.querySelector('[data-date="2027-01-02"]');
  expect(nextMonthDay).not.toBeNull();
  fireEvent.mouseDown(nextMonthDay);
  fireEvent.mouseEnter(nextMonthDay);
  expect(handlers.onMouseEnter).toHaveBeenCalledWith(2, 2027, 0);
});

test('rules 8, 28 — a past stay is a tint with a stripe and ink text on the logement calendar too, no opacity', () => {
  const { container } = renderGrid({ stays: [stay({ past: true })] });
  const style = getComputedStyle(container.querySelector('[data-ribbon="r7"]'));
  expect(style.backgroundColor).toBe('rgba(47, 93, 70, 0.14)');
  expect(style.color).toBe('rgb(39, 37, 31)');
  expect(style.boxShadow).toMatch(/inset 3px 0 0/);
  expect(style.opacity).not.toBe('0.55');
});

test('rule 28 — stays that overlap stack in lanes instead of hiding each other', () => {
  const stays = [1, 2, 3, 4, 5, 6].map((i) => stay({ id: 100 + i, startDate: '2026-12-08', endDate: '2026-12-11', label: `Guest ${i}` }));
  const { container } = renderGrid({ stays });
  const tops = [...container.querySelectorAll('[data-ribbon]')].map((r) => getComputedStyle(r).top);
  expect(container.querySelectorAll('[data-ribbon]')).toHaveLength(6);
  expect(new Set(tops).size).toBe(6);
});

test('rule 30 — a closure on days several stays hold gets a hatched ribbon of its own in a lane; one on free days does not', () => {
  const stays = [1, 2, 3].map((i) => stay({ id: 200 + i, startDate: '2026-12-08', endDate: '2026-12-11', label: `Guest ${i}` }));
  const closure = (id, startDate, endDate) => ({ id, propertyId: 1, propertyName: 'Granja', global: false, label: 'Travaux', startDate, endDate });
  const { container } = renderGrid({ stays, closures: [closure(9, '2026-12-09', '2026-12-12'), closure(10, '2026-12-20', '2026-12-22')] });
  const ribbon = container.querySelector('[data-closure-ribbon="c9"]');
  expect(ribbon).not.toBeNull();
  expect(ribbon).toHaveAttribute('aria-label', 'Granja fermé — Travaux, 9 décembre → 11 décembre');
  expect(getComputedStyle(ribbon).backgroundImage).toMatch(/repeating-linear-gradient/);
  expect(container.querySelector('[data-closure-ribbon="c10"]')).toBeNull();
  const tops = [...container.querySelectorAll('[data-ribbon], [data-closure-ribbon]')].map((r) => getComputedStyle(r).top);
  expect(new Set(tops).size).toBe(4);
});
