const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDays, validateBlock, toAbsMinutes } = require('../utils/resourceAvailability');

// specs/hourly-resource-quantity-and-sas-scheduling.md §3.3 / §3.4 — which start times the SAS may
// offer, and why the others are refused. The Bain nordique is the reference resource: 60-min slots,
// 11:00–22:00, minimum 1 h, 15 min turnover, 4 h warm-up from cold, still usable 8 h after a use.
const BAIN = {
  slotDuration: 60,
  minimumUsageMinutes: 60,
  openTime: '11:00',
  closeTime: '22:00',
  openDays: '[0,1,2,3,4,5,6]',
  closedDays: '[]',
  turnoverMinutes: 15,
  quantity: 1,
  heatUpMinutes: 240,
  heatRetentionMinutes: 480,
  hourlyEveningStart: '20:00',
  hourlyEveningRate: 50,
};

// Same resource with the thermal model switched off — i.e. every resource configured before this
// feature shipped. Used by the non-regression guard below.
const NO_THERMAL = { ...BAIN, heatUpMinutes: 0, heatRetentionMinutes: 0 };

const STAY = ['2026-09-11', '2026-09-12', '2026-09-13'];
const at = (date, time) => toAbsMinutes(date, time);
const slotsOf = (days, date) => days.find((d) => d.date === date).slots;
const stateAt = (days, date, time) => slotsOf(days, date).find((s) => s.start === time)?.state;
const slotAt = (days, date, time) => slotsOf(days, date).find((s) => s.start === time);

// Arrival at 11:00 on the first day: `notBefore` never gets in the way unless a test wants it to.
const EARLY = at('2026-09-11', '11:00');

const build = (over = {}) => buildDays({
  resource: BAIN,
  dayRate: 30,
  stayDates: STAY,
  occupancy: [],
  notBefore: EARLY,
  ...over,
});

// ── The grid ───────────────────────────────────────────────────────────────────────────────────────

test('grid: slots run from openTime in slotDuration steps and the last one fits the minimum', () => {
  const slots = slotsOf(build(), '2026-09-11');
  assert.equal(slots[0].start, '11:00');
  assert.equal(slots[0].end, '12:00');
  // 11:00 → 21:00 inclusive: the 21:00 slot ends exactly at the 22:00 close, 22:00 would overflow.
  assert.equal(slots.at(-1).start, '21:00');
  assert.equal(slots.at(-1).end, '22:00');
  assert.equal(slots.length, 11);
});

test('grid: a minimum longer than one slot shortens the tail, never overflowing closeTime', () => {
  const days = build({ resource: { ...BAIN, minimumUsageMinutes: 120 } });
  const slots = slotsOf(days, '2026-09-11');
  assert.equal(slots.at(-1).start, '20:00');
  assert.equal(slots.at(-1).end, '22:00');
});

test('grid: every stay day is returned with its French label', () => {
  const days = build();
  assert.deepEqual(days.map((d) => d.date), STAY);
  assert.match(days[0].weekdayLabel, /ven\./);
});

// ── Opening window ─────────────────────────────────────────────────────────────────────────────────

test('closed: a weekday outside openDays closes the whole day', () => {
  // 2026-09-12 is a Saturday (6). Open Monday–Friday only.
  const days = build({ resource: { ...BAIN, openDays: '[1,2,3,4,5]' } });
  const saturday = days.find((d) => d.date === '2026-09-12');
  assert.equal(saturday.closed, true);
  assert.ok(saturday.slots.every((s) => s.state === 'closed'));
  assert.equal(days.find((d) => d.date === '2026-09-11').closed, false);
});

test('closed: a date listed in closedDays closes that date only', () => {
  const days = build({ resource: { ...BAIN, closedDays: '["2026-09-12"]' } });
  assert.equal(days.find((d) => d.date === '2026-09-12').closed, true);
  assert.equal(days.find((d) => d.date === '2026-09-13').closed, false);
});

// ── The past ───────────────────────────────────────────────────────────────────────────────────────

test('past: nothing before notBefore is offered, whatever the thermal settings', () => {
  const days = buildDays({
    resource: NO_THERMAL,
    dayRate: 30,
    stayDates: STAY,
    occupancy: [],
    notBefore: at('2026-09-11', '16:00'),
  });
  assert.equal(stateAt(days, '2026-09-11', '15:00'), 'past');
  assert.equal(stateAt(days, '2026-09-11', '16:00'), 'free');
});

// ── Capacity and turnover ──────────────────────────────────────────────────────────────────────────

test('taken: an overlapping use blocks the slot', () => {
  const days = build({ occupancy: [{ date: '2026-09-11', start: '14:00', end: '15:00' }] });
  assert.equal(stateAt(days, '2026-09-11', '14:00'), 'taken');
});

test('taken: the turnover buffer blocks the slots on BOTH sides of a use', () => {
  const days = build({ occupancy: [{ date: '2026-09-11', start: '14:00', end: '15:00' }] });
  // 13:00–14:00 ends exactly when the use starts; 15 min of reset are still owed → blocked.
  assert.equal(stateAt(days, '2026-09-11', '13:00'), 'taken');
  // 15:00–16:00 starts exactly at the end; the reset is not done → blocked.
  assert.equal(stateAt(days, '2026-09-11', '15:00'), 'taken');
  // 16:00 clears the 15-min buffer.
  assert.equal(stateAt(days, '2026-09-11', '16:00'), 'free');
});

test('taken: capacity 2 admits a second concurrent use and refuses the third', () => {
  const twoSeats = { ...NO_THERMAL, quantity: 2, turnoverMinutes: 0 };
  const one = buildDays({
    resource: twoSeats, dayRate: 30, stayDates: STAY, notBefore: EARLY,
    occupancy: [{ date: '2026-09-11', start: '14:00', end: '15:00' }],
  });
  assert.equal(stateAt(one, '2026-09-11', '14:00'), 'free');

  const two = buildDays({
    resource: twoSeats, dayRate: 30, stayDates: STAY, notBefore: EARLY,
    occupancy: [
      { date: '2026-09-11', start: '14:00', end: '15:00' },
      { date: '2026-09-11', start: '14:00', end: '15:00' },
    ],
  });
  assert.equal(stateAt(two, '2026-09-11', '14:00'), 'taken');
});

// ── Thermal model ──────────────────────────────────────────────────────────────────────────────────

test('cold: with no earlier use, everything before notBefore + heatUp is « heating »', () => {
  const days = buildDays({
    resource: BAIN, dayRate: 30, stayDates: STAY, occupancy: [],
    notBefore: at('2026-09-11', '16:00'), // arrival 16:00, warm-up 4 h → first usable slot 20:00
  });
  assert.equal(stateAt(days, '2026-09-11', '16:00'), 'heating');
  assert.equal(stateAt(days, '2026-09-11', '19:00'), 'heating');
  assert.equal(stateAt(days, '2026-09-11', '20:00'), 'free');
});

test('cold: the warm-up only bites on the arrival day — later days are long past it', () => {
  const days = buildDays({
    resource: BAIN, dayRate: 30, stayDates: STAY, occupancy: [],
    notBefore: at('2026-09-11', '16:00'),
  });
  assert.equal(stateAt(days, '2026-09-12', '11:00'), 'free');
});

test('warm: a use ending shortly before only owes the turnover, not the warm-up', () => {
  // Guest arrives at 16:00 (cold slot would be 20:00), but somebody used the bath until 14:00.
  const days = buildDays({
    resource: BAIN, dayRate: 30, stayDates: STAY,
    occupancy: [{ date: '2026-09-11', start: '13:00', end: '14:00' }],
    notBefore: at('2026-09-11', '16:00'),
  });
  const slot = slotAt(days, '2026-09-11', '16:00');
  assert.equal(slot.state, 'free');
  assert.equal(slot.warm, true);
});

test('warm: the retention boundary is inclusive, and one slot past it goes cold', () => {
  // Use ends 12:00. Retention 480 min → warm until exactly 20:00.
  const occupancy = [{ date: '2026-09-11', start: '11:00', end: '12:00' }];
  const days = buildDays({
    resource: BAIN, dayRate: 30, stayDates: STAY, occupancy,
    notBefore: at('2026-09-11', '11:00'),
  });
  assert.equal(slotAt(days, '2026-09-11', '20:00').warm, true);
  assert.equal(slotAt(days, '2026-09-11', '21:00').warm, false);
  // Past the window it is cold — but notBefore + heatUp (11:00 + 4 h = 15:00) is already behind,
  // so it stays bookable. Warmth is a hint here, not a gate.
  assert.equal(stateAt(days, '2026-09-11', '21:00'), 'free');
});

test('warm: retention looks back across midnight', () => {
  const lateUse = [{ date: '2026-09-11', start: '21:00', end: '22:00' }];
  // Retention 8 h → still warm at 06:00 the next morning (8 h gap exactly).
  const wide = buildDays({
    resource: { ...BAIN, openTime: '06:00', heatRetentionMinutes: 480 },
    dayRate: 30, stayDates: STAY, occupancy: lateUse, notBefore: EARLY,
  });
  assert.equal(slotAt(wide, '2026-09-12', '06:00').warm, true);

  // Retention 1 h → the same 06:00 slot is cold the next morning.
  const narrow = buildDays({
    resource: { ...BAIN, openTime: '06:00', heatRetentionMinutes: 60 },
    dayRate: 30, stayDates: STAY, occupancy: lateUse, notBefore: EARLY,
  });
  assert.equal(slotAt(narrow, '2026-09-12', '06:00').warm, false);
});

test('warm: heatRetentionMinutes = 0 means the resource never stays warm', () => {
  const days = buildDays({
    resource: { ...BAIN, heatRetentionMinutes: 0 },
    dayRate: 30, stayDates: STAY,
    occupancy: [{ date: '2026-09-11', start: '13:00', end: '14:00' }],
    notBefore: at('2026-09-11', '16:00'),
  });
  const slot = slotAt(days, '2026-09-11', '16:00');
  assert.equal(slot.warm, false);
  assert.equal(slot.state, 'heating'); // cold path → arrival 16:00 + 4 h
});

// ── Non-regression: every resource configured before this feature ──────────────────────────────────

test('NON-REGRESSION: heatUp = 0 + retention = 0 reproduces the pre-thermal classification', () => {
  // With the thermal model off, the only constraints are the opening window, the past, capacity and
  // the turnover — exactly what the app enforced before this spec. No existing resource may shift.
  const occupancy = [{ date: '2026-09-11', start: '14:00', end: '15:00' }];
  const days = buildDays({
    resource: NO_THERMAL, dayRate: 30, stayDates: STAY, occupancy,
    notBefore: at('2026-09-11', '12:00'),
  });
  const states = slotsOf(days, '2026-09-11').map((s) => `${s.start}:${s.state}`);
  assert.deepEqual(states, [
    '11:00:past',
    '12:00:free',
    '13:00:taken',  // turnover before the use
    '14:00:taken',  // the use itself
    '15:00:taken',  // turnover after the use
    '16:00:free',
    '17:00:free',
    '18:00:free',
    '19:00:free',
    '20:00:free',
    '21:00:free',
  ]);
  assert.ok(slotsOf(days, '2026-09-11').every((s) => s.warm === false));
  assert.ok(slotsOf(days, '2026-09-11').every((s) => s.state !== 'heating'));
});

// ── Blocks placed earlier in the same SAS run ──────────────────────────────────────────────────────

test('pending: a block placed during the SAS occupies its slot and warms the next one', () => {
  const days = buildDays({
    resource: BAIN, dayRate: 30, stayDates: STAY,
    occupancy: [{ date: '2026-09-11', start: '15:00', end: '16:00' }], // just placed by the operator
    notBefore: at('2026-09-11', '11:00'),
  });
  assert.equal(stateAt(days, '2026-09-11', '15:00'), 'taken');
  const next = slotAt(days, '2026-09-11', '17:00');
  assert.equal(next.state, 'free');
  assert.equal(next.warm, true); // the whole point: a second session can sit right after the first
});

// ── Evening supplement badge ───────────────────────────────────────────────────────────────────────

test('supplement: day slots owe nothing, evening slots owe the band difference', () => {
  const days = build();
  assert.equal(slotAt(days, '2026-09-11', '14:00').supplement, 0);
  assert.equal(slotAt(days, '2026-09-11', '20:00').supplement, 20); // (50 − 30) × 1 h
});

// ── The occupancy strip ────────────────────────────────────────────────────────────────────────────

test('occupancy strip: times only, scoped to the day, no client identity', () => {
  const days = build({
    occupancy: [
      { date: '2026-09-11', start: '14:00', end: '15:00', clientName: 'Dupont' },
      { date: '2026-09-12', start: '18:00', end: '19:00', clientName: 'Martin' },
    ],
  });
  assert.deepEqual(days.find((d) => d.date === '2026-09-11').occupancy, [{ start: '14:00', end: '15:00' }]);
  assert.deepEqual(days.find((d) => d.date === '2026-09-12').occupancy, [{ start: '18:00', end: '19:00' }]);
  const serialized = JSON.stringify(days);
  assert.ok(!serialized.includes('Dupont') && !serialized.includes('Martin'));
});

// ── Determinism ────────────────────────────────────────────────────────────────────────────────────

test('determinism: same inputs → same output (the clock is injected, never read)', () => {
  const args = {
    resource: BAIN, dayRate: 30, stayDates: STAY,
    occupancy: [{ date: '2026-09-11', start: '14:00', end: '15:00' }],
    notBefore: at('2026-09-11', '12:00'),
  };
  assert.deepEqual(buildDays(args), buildDays(args));
});

// ── validateBlock — the authoritative commit-time check ────────────────────────────────────────────

const validate = (block, over = {}) => validateBlock({
  resource: BAIN,
  block,
  occupancy: [],
  notBefore: EARLY,
  remainingMinutes: 180,
  ...over,
});

// Arrival 11:00 + a 4 h warm-up ⇒ the first cold-path slot is 15:00; the happy paths start there.
test('validateBlock: a well-formed free block passes', () => {
  assert.deepEqual(validate({ date: '2026-09-11', start: '15:00', end: '16:00' }), { ok: true });
  assert.deepEqual(validate({ date: '2026-09-11', start: '15:00', end: '17:00' }), { ok: true });
});

test('validateBlock: refuses a block shorter than the minimum, or unaligned on the slot', () => {
  assert.deepEqual(
    validate({ date: '2026-09-11', start: '14:00', end: '14:30' }),
    { ok: false, reason: 'duration' },
  );
  assert.deepEqual(
    validate({ date: '2026-09-11', start: '14:30', end: '15:30' }),
    { ok: false, reason: 'duration' },
  );
  assert.deepEqual(
    validate({ date: '2026-09-11', start: '15:00', end: '15:00' }),
    { ok: false, reason: 'duration' },
  );
});

test('validateBlock: refuses a block overflowing closeTime', () => {
  assert.deepEqual(
    validate({ date: '2026-09-11', start: '21:00', end: '23:00' }),
    { ok: false, reason: 'closed' },
  );
});

test('validateBlock: refuses a block on a closed day', () => {
  assert.deepEqual(
    validate({ date: '2026-09-12', start: '14:00', end: '15:00' }, { resource: { ...BAIN, closedDays: '["2026-09-12"]' } }),
    { ok: false, reason: 'closed' },
  );
});

test('validateBlock: refuses a block in the past', () => {
  assert.deepEqual(
    validate({ date: '2026-09-11', start: '12:00', end: '13:00' }, { notBefore: at('2026-09-11', '16:00'), resource: NO_THERMAL }),
    { ok: false, reason: 'past' },
  );
});

test('validateBlock: refuses a block that collides with an existing use', () => {
  assert.deepEqual(
    validate({ date: '2026-09-11', start: '14:00', end: '15:00' }, {
      occupancy: [{ date: '2026-09-11', start: '14:00', end: '15:00' }],
    }),
    { ok: false, reason: 'taken' },
  );
});

test('validateBlock: refuses a cold block placed before the warm-up is done', () => {
  assert.deepEqual(
    validate({ date: '2026-09-11', start: '17:00', end: '18:00' }, { notBefore: at('2026-09-11', '16:00') }),
    { ok: false, reason: 'heating' },
  );
});

test('validateBlock: refuses a block longer than the hours still owed', () => {
  assert.deepEqual(
    validate({ date: '2026-09-11', start: '15:00', end: '19:00' }, { remainingMinutes: 120 }),
    { ok: false, reason: 'budget' },
  );
  assert.deepEqual(validate({ date: '2026-09-11', start: '15:00', end: '17:00' }, { remainingMinutes: 120 }), { ok: true });
});
