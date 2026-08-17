import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeEach } from 'vitest';

import SasResourceSchedulingPage from '../SasResourceSchedulingPage';
import api from '../../../api';

vi.mock('../../../api', () => ({ default: { getResourceFreeSlots: vi.fn() } }));

// specs/hourly-resource-quantity-and-sas-scheduling.md §3.4 — the arrival-SAS picker. Every slot
// arrives already classified by the server; this page renders states and never derives them.

const slot = (start, over = {}) => ({
  start, end: `${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}:00`,
  state: 'free', warm: false, supplement: 0, ...over,
});

const DAY = {
  date: '2026-09-12',
  weekdayLabel: 'sam. 12 sept.',
  closed: false,
  occupancy: [{ start: '14:00', end: '15:00' }],
  slots: [
    slot('11:00', { state: 'past' }),
    slot('13:00', { state: 'taken' }),
    slot('14:00', { state: 'taken' }),
    slot('16:00'),
    slot('17:00', { warm: true }),
    slot('20:00', { supplement: 20 }),
    slot('21:00', { state: 'heating' }),
  ],
};

const SCHEDULING = {
  applicable: true,
  resources: [{
    resourceId: 2,
    name: 'Bain nordique',
    hoursSold: 2,
    hoursPlaced: 0,
    hoursRemaining: 2,
    slotDuration: 60,
    minimumUsageMinutes: 60,
    sessions: [],
    days: [DAY, { ...DAY, date: '2026-09-13', weekdayLabel: 'dim. 13 sept.' }],
  }],
};

// Mirrors how ReservationSasDialog owns the blocks: in memory, until the single commit.
function Harness({ scheduling = SCHEDULING }) {
  const [blocks, setBlocks] = useState([]);
  return (
    <SasResourceSchedulingPage
      reservationId={500}
      scheduling={scheduling}
      blocks={blocks}
      onAdd={(b) => setBlocks((prev) => [...prev, b])}
      onRemove={(idx, block) => setBlocks((prev) => prev.filter((b) => !(b.date === block.date && b.start === block.start)))}
    />
  );
}

beforeEach(() => {
  api.getResourceFreeSlots.mockReset();
  api.getResourceFreeSlots.mockResolvedValue({ days: SCHEDULING.resources[0].days });
});

test('shows the hours still owed', () => {
  render(<Harness />);
  expect(screen.getByText('Bain nordique')).toBeInTheDocument();
  expect(screen.getByText('2 h à planifier')).toBeInTheDocument();
});

test("the day's existing bookings are shown as times, with no client named", () => {
  render(<Harness />);
  expect(screen.getByText('Déjà réservé ce jour')).toBeInTheDocument();
  expect(screen.getByText('14:00 – 15:00')).toBeInTheDocument();
});

test('a free slot is tappable and decrements the counter', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByLabelText('16:00 — libre'));
  await waitFor(() => expect(screen.getByText('1 h à planifier')).toBeInTheDocument());
});

test('taken / heating / past slots state their reason and cannot be placed', () => {
  render(<Harness />);
  // A non-free slot renders as a disabled Chip (a div, so `toBeDisabled` does not apply) — what
  // matters is that it is inert and says WHY, rather than being hidden.
  for (const label of ['14:00 — Déjà réservé', '21:00 — Montée en chauffe', '11:00 — Déjà passé']) {
    expect(screen.getByLabelText(label)).toHaveClass('Mui-disabled');
  }
  expect(screen.getAllByText('Déjà réservé').length).toBeGreaterThan(0);
  expect(screen.getByText('Montée en chauffe')).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('14:00 — Déjà réservé'));
  expect(screen.getByText('2 h à planifier')).toBeInTheDocument(); // nothing was placed
  expect(api.getResourceFreeSlots).not.toHaveBeenCalled();
});

test('an evening slot carries its supplement badge', () => {
  render(<Harness />);
  expect(screen.getByLabelText('20:00 — libre, supplément 20 €')).toBeEnabled();
  expect(screen.getByText('+20 €')).toBeInTheDocument();
});

test('placing an evening slot surfaces the running supplement', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByLabelText('20:00 — libre, supplément 20 €'));
  await waitFor(() => expect(screen.getByText('Supplément soirée : 20 €')).toBeInTheDocument());
});

test('a placed block is listed and can be removed, giving the hour back', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByLabelText('16:00 — libre'));
  await waitFor(() => expect(screen.getByText(/16:00–17:00/)).toBeInTheDocument());
  fireEvent.click(screen.getByLabelText('Retirer le créneau'));
  await waitFor(() => expect(screen.getByText('2 h à planifier')).toBeInTheDocument());
});

test('placing a block re-fetches the slots, sending the in-run blocks as pending', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByLabelText('16:00 — libre'));
  await waitFor(() => expect(api.getResourceFreeSlots).toHaveBeenCalled());
  expect(api.getResourceFreeSlots).toHaveBeenCalledWith({
    resourceId: 2,
    reservationId: 500,
    pending: [{ date: '2026-09-12', start: '16:00', end: '17:00' }],
  });
});

test('a failed refresh surfaces the error instead of an empty grid', async () => {
  api.getResourceFreeSlots.mockRejectedValue(new Error('boom'));
  render(<Harness />);
  fireEvent.click(screen.getByLabelText('16:00 — libre'));
  // An empty grid would read as « tout est libre » and invite a double booking.
  await waitFor(() => expect(screen.getByText(/ne pas réserver à l'aveugle/i)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /Réessayer/i })).toBeInTheDocument();
});

test('once every hour is placed, no more slots are offered', async () => {
  render(<Harness scheduling={{
    ...SCHEDULING,
    resources: [{ ...SCHEDULING.resources[0], hoursSold: 1, hoursRemaining: 1 }],
  }} />);
  fireEvent.click(screen.getByLabelText('16:00 — libre'));
  await waitFor(() => expect(screen.getByText('Tout est planifié')).toBeInTheDocument());
  expect(screen.getByText('Toutes les heures achetées sont placées.')).toBeInTheDocument();
});

test('a resource with nothing left to place is not rendered at all', () => {
  render(<Harness scheduling={{
    applicable: false,
    resources: [{ ...SCHEDULING.resources[0], hoursRemaining: 0 }],
  }} />);
  expect(screen.queryByText('Bain nordique')).not.toBeInTheDocument();
});
