// specs/plugins-phase-3c-hourly-resources.md rules 14, 22 — the hourly resources' timed cards on the
// planning, and what they count on the day.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router';

import PlanningResourceCard from '../PlanningResourceCard';
import { countResourceTasks } from '../planningTasks';
import { loadResourceDays } from '../planningDays';
import api from '../../../api';
import { localIsoDate } from '../localDate';

vi.mock('../../../api', () => ({
  default: {
    setPlanningResourceCardDone: vi.fn().mockResolvedValue({ ok: true }),
    getPlanningResourceCards: vi.fn(),
    getResourceBookingPlanningEvents: vi.fn(),
  },
}));
vi.mock('../../../components/DialogProvider', () => ({ useToast: () => ({ showError: vi.fn() }) }));

const SESSION = {
  reservationId: 7, resourceId: 2, name: 'Bain nordique', date: '2026-10-10', start: '15:00', end: '16:00',
  kind: 'session', done: false, clientName: 'Martin',
};

test('ticking a session saves it, then reloads the cards for the day counter', async () => {
  const reload = vi.fn();
  render(<MemoryRouter><PlanningResourceCard entry={{ key: 'res-7-2-15:00', time: '15:00', kind: 'session', item: SESSION }} reload={reload} /></MemoryRouter>);
  expect(screen.getByText('15:00–16:00')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  await waitFor(() => expect(reload).toHaveBeenCalled());
  expect(api.setPlanningResourceCardDone).toHaveBeenCalledWith({
    reservationId: 7, resourceId: 2, date: '2026-10-10', start: '15:00', done: true, kind: 'session',
  });
});

test('a booking outside a stay shows its slot and payment, with nothing to tick', () => {
  render(<MemoryRouter><PlanningResourceCard entry={{ key: 'rb-4', time: '18:00', kind: 'booking', item: {
    id: 4, resourceName: 'Bain nordique', startTime: '18:00', endTime: '19:00', displayName: 'Dupont', paid: true, cardState: { state: 'paid', label: 'Payé', remainingCents: 0 },
  } }} reload={vi.fn()} /></MemoryRouter>);
  expect(screen.getByText('18:00–19:00')).toBeInTheDocument();
  expect(screen.getByText('Payé')).toBeInTheDocument();
});

// specs/resource-booking-pricing-and-invoicing.md rule 28 — a guest with no stay arrives from his card, until he has.
test('rule 28 — an unpaid booking outside a stay offers « Arrivée » and says it is to collect', () => {
  render(<MemoryRouter><PlanningResourceCard entry={{ key: 'rb-5', time: '18:00', kind: 'booking', item: {
    id: 5, resourceName: 'Bain nordique', date: localIsoDate(), startTime: '18:00', endTime: '19:00', displayName: 'Martin', paid: false, external: true, arrived: false, cardState: { state: 'toCollect', label: 'À encaisser', remainingCents: 12000 },
  } }} reload={vi.fn()} /></MemoryRouter>);
  expect(screen.getByText('À encaisser')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Arrivée' })).toBeInTheDocument();
});

test('rule 28 — an arrived booking, or one tied to a stay, has no « Arrivée »', () => {
  render(<MemoryRouter><PlanningResourceCard entry={{ key: 'rb-6', time: '18:00', kind: 'booking', item: {
    id: 6, resourceName: 'Bain nordique', startTime: '18:00', endTime: '19:00', displayName: 'Martin', paid: false, external: true, arrived: true,
  } }} reload={vi.fn()} /></MemoryRouter>);
  expect(screen.queryByRole('button', { name: 'Arrivée' })).toBeNull();
});

test('the day counts the ignitions and the sessions, not the bookings', () => {
  expect(countResourceTasks([
    { kind: 'ignition', item: { done: true } },
    { kind: 'session', item: { done: false } },
    { kind: 'booking', item: {} },
  ])).toEqual({ total: 2, done: 1 });
});

test('the cards of a window are keyed by day, each with its time', async () => {
  api.getPlanningResourceCards.mockResolvedValue({ resourceCardsByDate: {
    '2026-10-10': { items: [{ ...SESSION }, { ...SESSION, kind: 'ignition', time: '11:00', sessionStart: '15:00' }] },
  } });
  api.getResourceBookingPlanningEvents.mockResolvedValue([{ id: 4, date: '2026-10-11', startTime: '18:00' }]);
  const days = await loadResourceDays({ from: '2026-10-10', to: '2026-10-11' });
  expect(days['2026-10-10'].map((e) => [e.kind, e.time])).toEqual([['session', '15:00'], ['ignition', '11:00']]);
  expect(days['2026-10-11'].map((e) => [e.kind, e.time])).toEqual([['booking', '18:00']]);
});

// specs/resource-booking-pricing-and-invoicing.md rule 28 (R35-C-L4) — « on its day only ».
test('rule 28 — a booking of another day offers no « Arrivée »', () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  render(<MemoryRouter><PlanningResourceCard entry={{ key: 'rb-7', time: '18:00', kind: 'booking', item: {
    id: 7, resourceName: 'Bain nordique', date: localIsoDate(tomorrow), startTime: '18:00', endTime: '19:00', displayName: 'Martin', paid: true, external: true, arrived: false,
  } }} reload={vi.fn()} /></MemoryRouter>);
  expect(screen.queryByRole('button', { name: 'Arrivée' })).toBeNull();
});

// specs/outside-booking-sas.md rules 6, 22 (C38) — the chip is the server's `cardState`, never derived from a payment.
test('rule 22 — a visit closed with a reste reads « Reste 13,00 € » with no total beside it; « Absent » offers no « Arrivée »', () => {
  const booking = (cardState, more = {}) => ({
    id: 8, resourceName: 'Bain nordique', date: localIsoDate(), startTime: '18:00', endTime: '19:00', displayName: 'Martin', paid: false, external: true, arrived: false, totalPrice: 83, cardState, ...more,
  });
  const { unmount } = render(<MemoryRouter><PlanningResourceCard entry={{ key: 'rb-8', time: '18:00', kind: 'booking', item: booking({ state: 'remaining', label: 'Reste 13,00 €', remainingCents: 1300 }, { arrived: true }) }} reload={vi.fn()} /></MemoryRouter>);
  expect(screen.getByText('Reste 13,00 €')).toBeInTheDocument();
  expect(screen.queryByText(/83,00/)).toBeNull();
  unmount();
  render(<MemoryRouter><PlanningResourceCard entry={{ key: 'rb-9', time: '18:00', kind: 'booking', item: booking({ state: 'absent', label: 'Absent', remainingCents: 0 }, { noShowAt: '2099-02-13T20:00:00.000Z' }) }} reload={vi.fn()} /></MemoryRouter>);
  expect(screen.getByText('Absent')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Arrivée' })).toBeNull();
});
