// specs/wp-booking-widget-redesign.md rule 30 + specs/public-api.md (UI/UX review 2026-10-18,
// decision 2) — when the calendar's window is all closed, the server says where the first free night
// is. Pure: the window's blocked nights come in, the lookup beyond it is injected.
const test = require('node:test');
const assert = require('node:assert/strict');
const { findNextAvailableDate } = require('../nextAvailability');
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
  assert.deepEqual(calls, [['2026-12-01', '2027-10-19']]);
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
    blockedDates: [], loadBlocked: (a) => (a === '2026-10-19' ? ['2026-10-19'] : []),
  });
  assert.equal(next, '2026-10-20');
});

test('the projection carries nextAvailableDate, null when absent (additive field)', () => {
  const base = { propertyId: 1, from: '2026-10-01', to: '2026-11-01', blockedDates: [] };
  assert.equal(toPublicAvailability(base).nextAvailableDate, null);
  assert.equal(toPublicAvailability({ ...base, nextAvailableDate: '2027-04-03' }).nextAvailableDate, '2027-04-03');
});
