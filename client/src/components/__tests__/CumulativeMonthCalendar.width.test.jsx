import { CALENDAR_MIN_WIDTH } from '../CumulativeMonthCalendar';

// specs/design-system.md §3.9 phase 5 (2026-10-27 audit) — at 900 px the content column next to the
// drawer is ~610 px; the month grid's former 720 px floor hid Sunday behind a horizontal scroller.
test('the month grid fits the md content column (seven ~80 px days)', () => {
  expect(CALENDAR_MIN_WIDTH).toBeLessThanOrEqual(600);
  expect(CALENDAR_MIN_WIDTH / 7).toBeGreaterThanOrEqual(76);
});
