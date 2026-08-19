const test = require('node:test');
const assert = require('node:assert/strict');

const { createTripLedger, emptyBlock } = require('../utils/laundryTripLedger');

// specs/laundry-extra-trip.md §3.2 — the pure trip-sequence + pool ledger, driven with an injected
// `buildBlock` fake keyed by window, so every assertion reads as "which window, which pool".
//
// Calendar used throughout: laundry weekday = Tuesday (2). 2026-05-26, 06-02, 06-09, 06-16 are
// Tuesdays; 06-04 is a Thursday, 06-06 a Saturday.

const TUESDAY = 2;

function zeros(over = {}) {
  return { ...emptyBlock(), ...over };
}

// `windows` maps "start|end" → partial block; anything else → zeros. Records every call.
function makeLedger({ windows = {}, skipped = [], extras = [], incompleteFn } = {}) {
  const calls = [];
  const buildBlock = (start, end) => {
    calls.push({ start, end });
    return zeros(windows[`${start}|${end}`] || {});
  };
  const incompleteCalls = [];
  const incompleteFor = incompleteFn || ((start, end) => { incompleteCalls.push({ start, end }); return []; });
  const ledger = createTripLedger({
    weekday: TUESDAY, skippedDates: new Set(skipped), extraTrips: extras, buildBlock, incompleteFor,
  });
  return { ledger, calls, incompleteCalls };
}

test('no extra trip: regular entry = drop (prev, T] + pick-up = drop (prevPrev, prev] — pre-feature contract', () => {
  const { ledger, calls } = makeLedger({
    windows: {
      '2026-06-02|2026-06-09': { singleBeds: 2 },
      '2026-05-26|2026-06-02': { singleBeds: 5 },
    },
  });
  const e = ledger.entryFor('2026-06-09');
  assert.equal(e.kind, 'regular');
  assert.deepEqual(e.dropOff, { ...zeros({ singleBeds: 2 }), incomplete: [] });
  assert.deepEqual(e.pickUp, zeros({ singleBeds: 5 }));
  // Call order pinned: the drop-off window first, then the previous trip's window.
  assert.deepEqual(calls, [
    { start: '2026-06-02', end: '2026-06-09' },
    { start: '2026-05-26', end: '2026-06-02' },
  ]);
});

test('skipped regular day: zeros, kind regular, no model call', () => {
  const { ledger, calls, incompleteCalls } = makeLedger({ skipped: ['2026-06-09'] });
  const e = ledger.entryFor('2026-06-09');
  assert.deepEqual(e, { date: '2026-06-09', kind: 'regular', dropOff: { ...zeros(), incomplete: [] }, pickUp: zeros() });
  assert.equal(calls.length, 0);
  assert.equal(incompleteCalls.length, 0);
});

test('extra trip (pickUpAll) between two Tuesdays: takes the dirty pile since Tuesday and the whole pool; the next Tuesday only carries what came after', () => {
  const { ledger } = makeLedger({
    windows: {
      '2026-05-26|2026-06-02': { singleBeds: 5, largeTowels: 4 },   // drop(06-02) = pool before 06-04
      '2026-06-02|2026-06-04': { singleBeds: 2 },                    // drop(06-04)
      '2026-06-04|2026-06-09': { singleBeds: 3 },                    // drop(06-09)
    },
    extras: [{ date: '2026-06-04', pickUpAll: true, pickUp: zeros() }],
  });
  const extra = ledger.entryFor('2026-06-04');
  assert.equal(extra.kind, 'extra');
  assert.equal(extra.pickUpAll, true);
  assert.deepEqual(extra.dropOff, { ...zeros({ singleBeds: 2 }), incomplete: [] });
  assert.deepEqual(extra.pickUp, zeros({ singleBeds: 5, largeTowels: 4 }));
  assert.deepEqual(extra.leftAtLaundry, zeros());

  const tue = ledger.entryFor('2026-06-09');
  assert.deepEqual(tue.dropOff, { ...zeros({ singleBeds: 3 }), incomplete: [] });
  // Pool before 06-09 = (drop(06-02) − all taken on 06-04) + drop(06-04) = drop(06-04).
  assert.deepEqual(tue.pickUp, zeros({ singleBeds: 2 }));
});

test('partial pick-up: capped per type, remainder stays and returns on the next regular trip', () => {
  const { ledger } = makeLedger({
    windows: {
      '2026-05-26|2026-06-02': { singleBeds: 3, doubleBeds: 2 },
      '2026-06-02|2026-06-04': { singleBeds: 1 },
      '2026-06-04|2026-06-09': { doubleBeds: 4 },
    },
    // Declares 1 single (of 3) and 9 doubles (only 2 at the laundry → capped).
    extras: [{ date: '2026-06-04', pickUpAll: false, pickUp: zeros({ singleBeds: 1, doubleBeds: 9 }) }],
  });
  const extra = ledger.entryFor('2026-06-04');
  assert.equal(extra.pickUpAll, false);
  assert.deepEqual(extra.pickUp, zeros({ singleBeds: 1, doubleBeds: 2 }));
  assert.deepEqual(extra.leftAtLaundry, zeros({ singleBeds: 2 }));

  const tue = ledger.entryFor('2026-06-09');
  // Pool before 06-09 = remainder (2 singles) + drop(06-04) (1 single).
  assert.deepEqual(tue.pickUp, zeros({ singleBeds: 3 }));
  assert.deepEqual(tue.dropOff, { ...zeros({ doubleBeds: 4 }), incomplete: [] });
});

test('two extra trips in the same week chain their windows and pools', () => {
  const { ledger } = makeLedger({
    windows: {
      '2026-05-26|2026-06-02': { singleBeds: 5 },
      '2026-06-02|2026-06-04': { singleBeds: 2 },
      '2026-06-04|2026-06-06': { singleBeds: 1 },
      '2026-06-06|2026-06-09': { singleBeds: 7 },
    },
    extras: [
      { date: '2026-06-04', pickUpAll: false, pickUp: zeros({ singleBeds: 4 }) }, // leaves 1 of 5
      { date: '2026-06-06', pickUpAll: true, pickUp: zeros() },
    ],
  });
  const e2 = ledger.entryFor('2026-06-06');
  assert.deepEqual(e2.dropOff, { ...zeros({ singleBeds: 1 }), incomplete: [] });
  // Pool before 06-06 = (5 − 4) + drop(06-04) = 1 + 2 = 3.
  assert.deepEqual(e2.pickUp, zeros({ singleBeds: 3 }));
  assert.deepEqual(e2.leftAtLaundry, zeros());
  const tue = ledger.entryFor('2026-06-09');
  assert.deepEqual(tue.dropOff, { ...zeros({ singleBeds: 7 }), incomplete: [] });
  assert.deepEqual(tue.pickUp, zeros({ singleBeds: 1 }));
});

test('extra trip after a skipped Tuesday: its window reaches back across the skip and it takes the deferred pool', () => {
  const { ledger } = makeLedger({
    skipped: ['2026-06-02'],
    windows: {
      '2026-05-19|2026-05-26': { singleBeds: 9 },   // drop(05-26) = deferred pool
      '2026-05-26|2026-06-04': { singleBeds: 6 },   // drop(06-04), widened across the skipped 06-02
      '2026-06-04|2026-06-09': { singleBeds: 1 },
    },
    extras: [{ date: '2026-06-04', pickUpAll: true, pickUp: zeros() }],
  });
  const extra = ledger.entryFor('2026-06-04');
  assert.deepEqual(extra.dropOff, { ...zeros({ singleBeds: 6 }), incomplete: [] });
  assert.deepEqual(extra.pickUp, zeros({ singleBeds: 9 }));
  const tue = ledger.entryFor('2026-06-09');
  assert.deepEqual(tue.dropOff, { ...zeros({ singleBeds: 1 }), incomplete: [] });
  assert.deepEqual(tue.pickUp, zeros({ singleBeds: 6 }));
});

test('an extra trip stored on the laundry weekday is inert', () => {
  const { ledger } = makeLedger({
    windows: { '2026-06-02|2026-06-09': { singleBeds: 2 }, '2026-05-26|2026-06-02': { singleBeds: 5 } },
    extras: [{ date: '2026-06-09', pickUpAll: false, pickUp: zeros({ singleBeds: 1 }) }],
  });
  assert.deepEqual(ledger.extraDates, []);
  const e = ledger.entryFor('2026-06-09');
  assert.equal(e.kind, 'regular');
  assert.deepEqual(e.pickUp, zeros({ singleBeds: 5 }));
});

test('entryFor on a plain day (no trip) returns null', () => {
  const { ledger } = makeLedger();
  assert.equal(ledger.entryFor('2026-06-05'), null);
});

test('previewFor ignores the record stored on the date itself (create and edit share it)', () => {
  const windows = {
    '2026-05-26|2026-06-02': { singleBeds: 5 },
    '2026-06-02|2026-06-04': { singleBeds: 2 },
  };
  const without = makeLedger({ windows });
  const withRecord = makeLedger({ windows, extras: [{ date: '2026-06-04', pickUpAll: false, pickUp: zeros({ singleBeds: 1 }) }] });
  const a = without.ledger.previewFor('2026-06-04');
  const b = withRecord.ledger.previewFor('2026-06-04');
  assert.deepEqual(a, { dropOff: zeros({ singleBeds: 2 }), atLaundry: zeros({ singleBeds: 5 }) });
  assert.deepEqual(b, a);
});

test('incompleteFor is queried once per emitted trip, on its own drop-off window only', () => {
  const { ledger, incompleteCalls } = makeLedger({ extras: [{ date: '2026-06-04', pickUpAll: true, pickUp: zeros() }] });
  ledger.entryFor('2026-06-04');
  ledger.entryFor('2026-06-09');
  assert.deepEqual(incompleteCalls, [
    { start: '2026-06-02', end: '2026-06-04' },
    { start: '2026-06-04', end: '2026-06-09' },
  ]);
});
