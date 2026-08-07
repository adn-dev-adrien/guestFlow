/**
 * CalendarWeekView — mobile reservation calendar (week per page).
 * See specs/calendar-mobile-view.md.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CalendarWeekView from '../CalendarWeekView';

// Today is a Wednesday → its week is Mon 2026-07-06 … Sun 2026-07-12.
const TODAY = '2026-07-08';
const RES = [
  { id: 1, startDate: '2026-07-06', endDate: '2026-07-08', firstName: 'Jane', lastName: 'Smith', platform: 'airbnb', checkInTime: '15:00', checkOutTime: '10:00' },
  { id: 2, startDate: '2026-07-10', endDate: '2026-07-13', firstName: 'Marc', lastName: 'Pino', platform: 'direct', checkInTime: '16:00', checkOutTime: '11:00' },
];

function setup(props = {}) {
  const handlers = {
    onReservationClick: vi.fn(),
    onDevisClick: vi.fn(),
    onOpenNewReservation: vi.fn(),
    onOpenNote: vi.fn(),
    onWeekChange: vi.fn(),
  };
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
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

test('renders the current week with arrival / departure / ongoing labels', () => {
  setup();
  // Marc arrives 2026-07-10 (within the current week).
  expect(screen.getByText(/Arrivée — M\. Pino/)).toBeInTheDocument();
  // Jane departs 2026-07-08 (today).
  expect(screen.getByText(/Départ — J\. Smith/)).toBeInTheDocument();
  // 2026-07-07 is a mid-stay day for Jane (06→08).
  expect(screen.getByText(/Séjour — J\. Smith/)).toBeInTheDocument();
});

test('shows the week range in the header', () => {
  setup();
  expect(screen.getByText(/6 – 12 juillet 2026/)).toBeInTheDocument();
});

test('clicking a reservation line fires onReservationClick with its id', async () => {
  const user = userEvent.setup();
  const { onReservationClick } = setup();
  await user.click(screen.getByText(/Arrivée — M\. Pino/));
  expect(onReservationClick).toHaveBeenCalledWith(2);
});

test('empty future days offer to create a reservation', async () => {
  const user = userEvent.setup();
  const { onOpenNewReservation } = setup();
  // 2026-07-09 is free (between Jane's departure and Marc's arrival), in the future vs TODAY.
  const createButtons = screen.getAllByText('+ Nouvelle réservation');
  expect(createButtons.length).toBeGreaterThan(0);
  await user.click(createButtons[0]);
  expect(onOpenNewReservation).toHaveBeenCalled();
});

test('the note button fires onOpenNote', async () => {
  const user = userEvent.setup();
  const { onOpenNote } = setup();
  await user.click(screen.getAllByRole('button', { name: 'Note' })[0]);
  expect(onOpenNote).toHaveBeenCalled();
});
