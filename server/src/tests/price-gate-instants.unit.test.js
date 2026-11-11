// specs/pricing-components.md §3 rule 68 — `scripts/price-gate/recompute.js`: the instants a stay is read at. Derived from the
// stored row (the capture day, the minute before and the minute of the arrival at 15:00 Paris, the noon after the departure),
// never written in a test file, and right on the days the clock changes.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { instantsOf, parisInstant, recomputeStays } = require('../../../scripts/price-gate/recompute');

const CAPTURED = '2026-11-11T12:00:00+01:00'; // date-literal-ok: a fixed instant given to a pure function, nothing compares it with today

test('rule 68: a Paris time is turned into the instant of its day, winter and summer', () => {
  assert.equal(parisInstant('2026-11-12', '14:59'), '2026-11-12T13:59:00.000Z'); // date-literal-ok: a fixed instant given to a pure function, nothing compares it with today
  assert.equal(parisInstant('2027-08-01', '15:00'), '2027-08-01T13:00:00.000Z'); // date-literal-ok: a fixed instant given to a pure function, nothing compares it with today
});

test('rule 68: the days the clock changes read the offset of that very time', () => {
  assert.equal(parisInstant('2027-03-28', '14:59'), '2027-03-28T12:59:00.000Z', 'spring: +02:00 from 03:00'); // date-literal-ok: a fixed instant given to a pure function, nothing compares it with today
  assert.equal(parisInstant('2027-10-31', '15:00'), '2027-10-31T14:00:00.000Z', 'autumn: +01:00 from 03:00'); // date-literal-ok: a fixed instant given to a pure function, nothing compares it with today
  assert.equal(parisInstant('2027-03-29', '12:00'), '2027-03-29T10:00:00.000Z'); // date-literal-ok: a fixed instant given to a pure function, nothing compares it with today
});

test('rule 68: a time that does not exist in Paris is refused rather than moved', () => {
  assert.throws(() => parisInstant('2027-03-28', '02:30'), /no Paris instant/); // date-literal-ok: a fixed instant given to a pure function, nothing compares it with today
});

test('rule 68: a stay is read at the capture day, the minute before and the minute of its arrival, and the noon after its departure', () => {
  const instants = instantsOf({ startDate: '2027-03-28', endDate: '2027-03-30' }, CAPTURED); // date-literal-ok: a fixed instant given to a pure function, nothing compares it with today
  assert.deepEqual(instants, [
    ['capture', '2026-11-11T11:00:00.000Z'], // date-literal-ok: a fixed instant given to a pure function, nothing compares it with today
    ['arrival-1459', '2027-03-28T12:59:00.000Z'], // date-literal-ok: a fixed instant given to a pure function, nothing compares it with today
    ['arrival-1500', '2027-03-28T13:00:00.000Z'], // date-literal-ok: a fixed instant given to a pure function, nothing compares it with today
    ['after', '2027-03-31T10:00:00.000Z'], // date-literal-ok: a fixed instant given to a pure function, nothing compares it with today
  ]);
});

test('rule 68: the day after the departure follows the calendar, month and year included', () => {
  assert.equal(instantsOf({ startDate: '2026-12-29', endDate: '2026-12-31' }, CAPTURED).at(-1)[1], '2027-01-01T11:00:00.000Z'); // date-literal-ok: a fixed instant given to a pure function, nothing compares it with today
});

test('rule 68: a row with no dates is read at the capture day only', () => {
  assert.deepEqual(instantsOf({ startDate: null, endDate: null }, CAPTURED).map(([name]) => name), ['capture']);
});

test('rule 68: every figure of a stay carries the name of its instant, and the clock goes back to the capture day after each', () => {
  const calls = [];
  const rows = [{ id: 4, startDate: '2027-02-01', endDate: '2027-02-03' }]; // date-literal-ok: a fixed instant given to a pure function, nothing compares it with today
  const db = { prepare: () => ({ all: () => rows }) };
  const seen = [];
  const figures = recomputeStays(db, {
    capturedAt: CAPTURED,
    pinClock: (instant) => { calls.push(instant); return () => seen.push(`back after ${instant}`); },
    figuresOf: () => ({ kind: 'reservation' }),
  });
  assert.deepEqual(Object.keys(figures[4]), ['kind@capture', 'kind@arrival-1459', 'kind@arrival-1500', 'kind@after']);
  assert.equal(calls.length, 4);
  assert.equal(seen.length, 4);
});
