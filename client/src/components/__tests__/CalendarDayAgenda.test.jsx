// specs/calendar-property-parity.md rule 17 — the logement calendar on a phone is a day agenda: one row per day
// with the day's content, today marked, « + Nouvelle réservation » on a free future day, a 44 px note button.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import CalendarDayAgenda from '../CalendarDayAgenda';

const handlers = () => ({
  onReservationClick: vi.fn(), onDevisClick: vi.fn(), onOpenNewReservation: vi.fn(), onOpenNote: vi.fn(),
});
function agenda(props = {}, h = handlers()) {
  render(
    <ThemeProvider theme={theme}>
      <CalendarDayAgenda
        year={2026} month={9} today="2026-10-15" selectedProp={1} stays={[]} closures={[]} devisList={[]}
        calendarNotes={{}} publicHolidays={new Set(['2026-10-25'])} {...h} {...props}
      />
    </ThemeProvider>,
  );
  return h;
}

test('one row per day of the month, with the weekday and the férié marker', () => {
  agenda();
  expect(document.querySelectorAll('[data-day]')).toHaveLength(31);
  expect(screen.getByText('férié')).toBeInTheDocument();
});

test("today's row is marked, so the scroller can put it under the title", () => {
  agenda();
  const row = document.querySelector('[data-today="true"]');
  expect(row).toHaveAttribute('data-day', '2026-10-15');
  expect(row).toHaveAttribute('aria-current', 'date');
});

test('a free future day offers « + Nouvelle réservation », a free past day only a dash', () => {
  const h = agenda();
  fireEvent.click(document.querySelector('[data-day="2026-10-20"] [role="button"]'));
  expect(h.onOpenNewReservation).toHaveBeenCalledWith('2026-10-20', '2026-10-21');
  expect(document.querySelector('[data-day="2026-10-02"]')).toHaveTextContent('—');
  expect(screen.getAllByText('+ Nouvelle réservation').length).toBe(17);
});

test('the note button names its day and fires onOpenNote', () => {
  const h = agenda();
  fireEvent.click(screen.getByRole('button', { name: 'Note du 20 octobre' }));
  expect(h.onOpenNote).toHaveBeenCalledWith('2026-10-20');
});

test('the day notes are printed under the day', () => {
  agenda({ calendarNotes: { '2026-10-20': 'Livraison bois' } });
  expect(document.querySelector('[data-day="2026-10-20"]')).toHaveTextContent('Livraison bois');
});
