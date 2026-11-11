// specs/ds-sweep-planning.md rule 28 — calendar days, whatever the browser's time zone.
import { addIsoDays, localIsoToday } from '../isoDay';

test('specs/ds-sweep-planning.md rule 28: adding days crosses the clock changes and month ends on the calendar', () => {
  expect(addIsoDays('2026-10-25', 1)).toBe('2026-10-26');
  expect(addIsoDays('2026-10-25', 13)).toBe('2026-11-07');
  expect(addIsoDays('2026-03-29', 1)).toBe('2026-03-30');
  expect(addIsoDays('2026-03-01', -1)).toBe('2026-02-28');
  expect(addIsoDays('2026-12-31', 1)).toBe('2027-01-01');
});

test('specs/ds-sweep-planning.md rule 28: the local fallback is the browser’s own date, not the UTC one', () => {
  const lateEvening = new Date(2026, 9, 18, 0, 30);
  expect(localIsoToday(lateEvening)).toBe('2026-10-18');
});
