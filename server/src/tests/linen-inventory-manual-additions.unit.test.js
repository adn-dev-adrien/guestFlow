const test = require('node:test');
const assert = require('node:assert/strict');

// specs/manual-laundry-additions.md §4 rules 4-5 — manual linen additions are washed like reservation
// linen (clean → laundry → clean) on a trip's drop, and defer past a skipped trip. Conservation must
// hold (no phantom linen). June 2026 Tuesdays: 02, 09, 16, 23, 30 (laundryWeekday = 2).
const { simulateInventory } = require('../utils/linenInventory');

const TUESDAY = 2;
const TYPES = ['single', 'double', 'baby', 'large', 'medium', 'small'];
const stock = (o = {}) => ({ single: 0, double: 0, baby: 0, large: 0, medium: 0, small: 0, ...o });
const dayOf = (r, date) => r.days.find((d) => d.date === date);
function assertConservation(r, st) {
  for (const day of r.days) {
    for (const t of TYPES) {
      const sum = day.clean[t] + day.inCirculation[t] + day.dirty[t] + day.atLaundry[t];
      assert.equal(sum, Number(st[t] || 0), `conservation broken on ${day.date} for ${t}`);
    }
  }
}
const base = {
  reservations: [], options: [], reservationOptions: [], propertyDefaults: [], laundryWeekday: TUESDAY,
};

test('manual addition is washed on its trip: clean dips on the drop, comes back on pick-up; conservation holds', () => {
  const st = stock({ single: 10 });
  const r = simulateInventory({
    ...base, stock: st, from: '2026-06-02', to: '2026-06-23',
    manualAdditionsByDate: new Map([['2026-06-09', stock({ single: 3 })]]),
  });
  assert.equal(dayOf(r, '2026-06-02').clean.single, 10, 'no manual that day → untouched');
  assert.equal(dayOf(r, '2026-06-09').clean.single, 7, 'drop day: 3 left clean for the laundry');
  assert.equal(dayOf(r, '2026-06-09').atLaundry.single, 3);
  assert.equal(dayOf(r, '2026-06-16').clean.single, 10, 'next trip: the 3 came back clean');
  assertConservation(r, st);
});

test('manual addition on a SKIPPED trip defers the drop to the next non-skipped trip', () => {
  const st = stock({ single: 10 });
  const r = simulateInventory({
    ...base, stock: st, from: '2026-06-02', to: '2026-06-30',
    manualAdditionsByDate: new Map([['2026-06-09', stock({ single: 3 })]]),
    skippedDates: new Set(['2026-06-09']),
  });
  assert.equal(dayOf(r, '2026-06-09').dirty.single, 3, 'skipped trip: not dropped, stays dirty');
  assert.equal(dayOf(r, '2026-06-09').atLaundry.single, 0);
  assert.equal(dayOf(r, '2026-06-16').atLaundry.single, 3, 'deferred drop happens at the next trip');
  assert.equal(dayOf(r, '2026-06-23').clean.single, 10, 'picked up a week after the deferred drop');
  assertConservation(r, st);
});

test('no manual additions (empty map / default) → behaviour unchanged', () => {
  const st = stock({ double: 5 });
  const r = simulateInventory({ ...base, stock: st, from: '2026-06-02', to: '2026-06-16' });
  for (const day of r.days) assert.equal(day.clean.double, 5);
  assertConservation(r, st);
});
