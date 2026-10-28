// specs/calendar-property-parity.md rule 21 — the phone agenda carries the stays' colours: a solid ribbon in the
// server's colour and text colour, the right half on arrival with « ↓ 16:00 », the left half on departure with
// « ↑ 10:00 », both halves on a turnover day, a tint for a past stay, a hatched ribbon for a closure.
import React from 'react';
import { vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import CalendarDayAgenda from '../CalendarDayAgenda';

const stay = (id, startDate, endDate, extra = {}) => ({
  id, propertyId: 1, startDate, endDate, label: `Guest ${id}`, platform: 'Airbnb', platformDisplay: 'Airbnb',
  color: '#C93848', textColor: '#FFFFFF', past: false, checkInTime: '16:00', checkOutTime: '10:00', ...extra,
});

function agenda(props) {
  const onReservationClick = vi.fn();
  const view = render(
    <ThemeProvider theme={theme}>
      <CalendarDayAgenda
        year={2026} month={11} today="2026-10-28" selectedProp={1} stays={[]} closures={[]} devisList={[]}
        calendarNotes={{}} publicHolidays={new Set()} onReservationClick={onReservationClick}
        onDevisClick={vi.fn()} onOpenNewReservation={vi.fn()} onOpenNote={vi.fn()} {...props}
      />
    </ThemeProvider>,
  );
  return { ...view, onReservationClick, day: (d) => view.container.querySelector(`[data-day="${d}"]`) };
}

test('a day inside the stay: a full-width ribbon in the stay colour, name and platform in the text colour', () => {
  const { day } = agenda({ stays: [stay(1, '2026-12-29', '2027-01-02')] });
  const ribbon = day('2026-12-30').querySelector('[data-ribbon]');
  expect(ribbon).toHaveAttribute('data-side', 'full');
  const style = getComputedStyle(ribbon);
  expect(style.backgroundColor).toBe('rgb(201, 56, 72)');
  expect(style.color).toBe('rgb(255, 255, 255)');
  expect(ribbon).toHaveTextContent('Guest 1');
  expect(ribbon).toHaveTextContent('Airbnb');
});

test('the arrival day: a right-half ribbon with « ↓ 16:00 », the name written beside it', () => {
  const { day, onReservationClick } = agenda({ stays: [stay(1, '2026-12-29', '2027-01-02')] });
  const ribbon = day('2026-12-29').querySelector('[data-ribbon]');
  expect(ribbon).toHaveAttribute('data-side', 'right');
  expect(ribbon).toHaveTextContent('↓ 16:00');
  expect(day('2026-12-29')).toHaveTextContent('Guest 1');
  expect(day('2026-12-29')).toHaveTextContent('Arrivée · Airbnb');
  fireEvent.click(ribbon);
  expect(onReservationClick).toHaveBeenCalledWith(1);
});

test('the departure day: a left-half ribbon with « ↑ 10:00 »', () => {
  const { day } = agenda({ stays: [stay(1, '2026-12-28', '2026-12-30')] });
  const ribbon = day('2026-12-30').querySelector('[data-ribbon]');
  expect(ribbon).toHaveAttribute('data-side', 'left');
  expect(ribbon).toHaveTextContent('↑ 10:00');
  expect(day('2026-12-30')).toHaveTextContent('Départ · Airbnb');
});

test('a turnover day: both halves, each carrying its name then its time', () => {
  const { day } = agenda({
    stays: [stay(1, '2026-12-27', '2026-12-30'), stay(2, '2026-12-30', '2027-01-03', { color: '#1B3F8B', platform: 'Booking', platformDisplay: 'Booking' })],
  });
  const ribbons = [...day('2026-12-30').querySelectorAll('[data-ribbon]')];
  expect(ribbons.map((r) => r.getAttribute('data-side')).sort()).toEqual(['left', 'right']);
  const left = ribbons.find((r) => r.getAttribute('data-side') === 'left');
  const right = ribbons.find((r) => r.getAttribute('data-side') === 'right');
  expect(left).toHaveTextContent('Guest 1');
  expect(left).toHaveTextContent('↑ 10:00');
  expect(right).toHaveTextContent('Guest 2');
  expect(right).toHaveTextContent('↓ 16:00');
  expect(getComputedStyle(right).backgroundColor).toBe('rgb(27, 63, 139)');
});

test('a past stay uses the tint with a stripe, ink text; a closure is hatched and halved like a stay', () => {
  const { day } = agenda({
    stays: [stay(1, '2026-12-01', '2026-12-04', { past: true })],
    closures: [{ id: 9, propertyId: 1, global: false, label: 'Travaux', startDate: '2026-12-10', endDate: '2026-12-12' }],
  });
  const past = getComputedStyle(day('2026-12-02').querySelector('[data-ribbon]'));
  expect(past.backgroundColor).toBe('rgba(201, 56, 72, 0.14)');
  expect(past.color).toBe('rgb(39, 37, 31)');
  expect(past.boxShadow).toMatch(/inset 3px 0 0/);

  const start = day('2026-12-10').querySelector('[data-ribbon]');
  expect(start).toHaveAttribute('data-side', 'right');
  expect(start).toHaveTextContent('Fermé · Travaux');
  expect(getComputedStyle(start).backgroundImage).toMatch(/repeating-linear-gradient/);
  const reopening = day('2026-12-12').querySelector('[data-ribbon]');
  expect(reopening).toHaveAttribute('data-side', 'left');
  expect(reopening).toHaveTextContent('Fermé');
  fireEvent.click(start);
});

test('a devis is a dashed grey ribbon', () => {
  const { day } = agenda({ devisList: [{ id: 5, startDate: '2026-12-14', endDate: '2026-12-17', firstName: 'Dev', lastName: 'Is', platform: 'direct' }] });
  const ribbon = day('2026-12-15').querySelector('[data-ribbon]');
  expect(ribbon).toHaveAttribute('data-side', 'full');
  expect(getComputedStyle(ribbon).borderStyle).toBe('dashed');
});
