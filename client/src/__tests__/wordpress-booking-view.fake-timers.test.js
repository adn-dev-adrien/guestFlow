// Guards the timer tracking of wordpressBookingFixtures: under vi.useFakeTimers() the fixture must leave
// vitest's fake setTimeout alone, so the 400 ms quote debounce of the booking script still advances.
import { act, fireEvent } from '@testing-library/react';
import { bookingContainer, catalogueRoutes, loadBlock, nextMonthDays, quote } from './wordpressBookingFixtures';

const days = nextMonthDays(10, 13);

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; delete window.GFBooking; });

test('the quote debounce fires on advanceTimersByTime(500) under fake timers', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  bookingContainer();
  const { calls } = loadBlock('blocks/booking/view.js', {
    routes: catalogueRoutes((method, p) => (p === '/quote' ? { status: 200, body: { data: quote() } } : null)),
  });
  await act(async () => {});
  fireEvent.click(document.querySelector(`[data-gf-day="${days.a.iso}"]`));
  fireEvent.click(document.querySelector(`[data-gf-day="${days.b.iso}"]`));
  expect(calls.some((c) => c.path.startsWith('/quote'))).toBe(false);
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(calls.some((c) => c.path.startsWith('/quote'))).toBe(true);
});
