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

test('a same-day manual drop does not strand the initial at-laundry batch when `from` is a laundry day', () => {
  // Regression (prod 2026-06-16): `from` = Tuesday 2026-06-16 ⇒ initLaundryDay === from, so the initial
  // at-laundry batch (a reservation that checked out the week before, due back +7d) is seeded under the
  // 2026-06-16 key. A manual addition entered for the SAME day used to OVERWRITE that seed, stranding the
  // batch « at laundry » forever → a phantom permanent shortage (a 1-double manual addition hid 6 doubles
  // and produced a fake « rupture de linge » a fortnight later).
  const st = stock({ double: 10 });
  const options = [{
    id: 100, countsAsBedLinen: 1, countsAsBathroomLinen: 0,
    linenIncludesSingle: 0, linenIncludesDouble: 1, linenIncludesBaby: 0,
    towelLargePerPerson: 0, towelMediumPerPerson: 0, towelSmallPerPerson: 0,
  }];
  // Checked out 2026-06-12 ⇒ at the laundry on 2026-06-16, dropped that day, due back 2026-06-23.
  const reservations = [{
    id: 1, kind: 'reservation', propertyId: 1, startDate: '2026-06-10', endDate: '2026-06-12',
    singleBeds: 0, doubleBeds: 6, babyBeds: 0, adults: 2, teens: 0, children: 0, babies: 0,
  }];
  const reservationOptions = [{ reservationId: 1, optionId: 100, quantity: 1 }];
  const r = simulateInventory({
    ...base, options, reservations, reservationOptions, stock: st, from: '2026-06-16', to: '2026-06-30',
    manualAdditionsByDate: new Map([['2026-06-16', stock({ double: 1 })]]),
  });
  assert.equal(dayOf(r, '2026-06-16').atLaundry.double, 7, 'initial 6 + manual 1 at the laundry on the drop day');
  assert.equal(dayOf(r, '2026-06-23').atLaundry.double, 0, 'the whole 2026-06-16 batch (incl. the initial 6) returns +7d');
  assert.equal(dayOf(r, '2026-06-23').clean.double, 10, 'all doubles clean again — nothing stranded');
  assert.equal(r.shortagesByType.double.firstDate, null, 'no phantom shortage');
  assertConservation(r, st);
});
