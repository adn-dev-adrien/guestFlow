// specs/wp-booking-widget-redesign.md rule 30 + specs/public-api.md (UI/UX review 2026-10-18,
// decision 2) — when the calendar's window is all closed, the server says where the first bookable
// arrival is: a free night the stay rules accept (minimum stay, changeover days), not just any free
// night. Pure: the window's blocked nights come in, the lookup beyond it and the rules are injected.
const test = require('node:test');
const assert = require('node:assert/strict');
const { findNextAvailableDate, stayRulesPredicate } = require('../nextAvailability');
const { toPublicAvailability } = require('../publicProjections');

function days(from, n) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

test('a free night inside the window is answered without looking further', () => {
  let loaded = false;
  const next = findNextAvailableDate({
    from: '2026-10-01', to: '2026-12-01', todayIso: '2026-10-19',
    blockedDates: days('2026-10-19', 5),
    loadBlocked: () => { loaded = true; return []; },
  });
  assert.equal(next, '2026-10-24');
  assert.equal(loaded, false);
});

test('past nights never count: the search starts today even when the window starts earlier', () => {
  const next = findNextAvailableDate({
    from: '2026-10-01', to: '2026-12-01', todayIso: '2026-10-19', blockedDates: [], loadBlocked: () => [],
  });
  assert.equal(next, '2026-10-19');
});

test('a closed season: the window is all blocked, the first free night is found beyond it', () => {
  const calls = [];
  const next = findNextAvailableDate({
    from: '2026-10-19', to: '2026-12-01', todayIso: '2026-10-19',
    blockedDates: days('2026-10-19', 43),
    loadBlocked: (a, b) => { calls.push([a, b]); return days('2026-12-01', 123); },
  });
  assert.equal(next, '2027-04-03');
  // Loaded once, from the window's end to the horizon plus the longest stay tried.
  assert.deepEqual(calls, [['2026-12-01', '2027-12-20']]);
});

test('nothing free within a year → null', () => {
  const next = findNextAvailableDate({
    from: '2026-10-19', to: '2026-11-19', todayIso: '2026-10-19',
    blockedDates: days('2026-10-19', 31),
    loadBlocked: (a) => days(a, 400),
  });
  assert.equal(next, null);
});

test('a window entirely in the past looks from today onwards', () => {
  const next = findNextAvailableDate({
    from: '2026-01-01', to: '2026-02-01', todayIso: '2026-10-19',
    blockedDates: [], loadBlocked: () => ['2026-10-19'],
  });
  assert.equal(next, '2026-10-20');
});

test('the projection carries nextAvailableDate, null when absent (additive field)', () => {
  const base = { propertyId: 1, from: '2026-10-01', to: '2026-11-01', blockedDates: [] };
  assert.equal(toPublicAvailability(base).nextAvailableDate, null);
  assert.equal(toPublicAvailability({ ...base, nextAvailableDate: '2027-04-03' }).nextAvailableDate, '2027-04-03');
});

// The seasons as pricing_rules rows: a catch-all season with a 2-night minimum.
const MIN2 = [{ id: 1, label: 'Saison', pricePerNight: 100, minNights: 2, dateRanges: '[]' }];

test('an isolated free night under a 2-night minimum is not an arrival', () => {
  // 19 free, 20 taken, 21-22 free: the 19th fits only one night.
  const next = findNextAvailableDate({
    from: '2026-10-19', to: '2026-12-01', todayIso: '2026-10-19',
    blockedDates: ['2026-10-20'], loadBlocked: () => [], isStayAllowed: stayRulesPredicate(MIN2),
  });
  assert.equal(next, '2026-10-21');
});

test('the minimum of the season covering the stay is the one that counts', () => {
  // Low season 1 night, high season (from 2026-11-01) 3 nights; only 2 free nights before a taken one.
  const rules = [
    { id: 1, label: 'Haute', pricePerNight: 150, minNights: 3, dateRanges: JSON.stringify([{ startDate: '2026-11-01', endDate: '2027-03-31' }]) },
    { id: 2, label: 'Basse', pricePerNight: 100, minNights: 1, dateRanges: '[]' },
  ];
  const next = findNextAvailableDate({
    from: '2026-11-01', to: '2026-12-01', todayIso: '2026-10-19',
    blockedDates: ['2026-11-03'], loadBlocked: () => [], isStayAllowed: stayRulesPredicate(rules),
  });
  assert.equal(next, '2026-11-04');
});

test('arrivals on Saturdays only: the first free Saturday, not the first free day', () => {
  // 2026-10-19 is a Monday; Saturday = 6.
  const rules = [{ id: 1, label: 'Été', pricePerNight: 100, minNights: 1, dateRanges: '[]', changeoverArrival: 6 }];
  const next = findNextAvailableDate({
    from: '2026-10-19', to: '2026-12-01', todayIso: '2026-10-19',
    blockedDates: ['2026-10-24'], loadBlocked: () => [], isStayAllowed: stayRulesPredicate(rules),
  });
  assert.equal(next, '2026-10-31');
});

test('a departure day rule is met by a longer stay, not refused', () => {
  // Departures on Saturdays only: a Monday arrival works with a 5-night stay.
  const rules = [{ id: 1, label: 'Été', pricePerNight: 100, minNights: 1, dateRanges: '[]', changeoverDeparture: 6 }];
  const next = findNextAvailableDate({
    from: '2026-10-19', to: '2026-12-01', todayIso: '2026-10-19',
    blockedDates: [], loadBlocked: () => [], isStayAllowed: stayRulesPredicate(rules),
  });
  assert.equal(next, '2026-10-19');
});
