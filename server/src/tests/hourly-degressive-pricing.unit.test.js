// specs/gift-voucher-campaigns.md rules 43-45 — the hourly degressivity table of a resource: validation,
// the rank-aware slice pricing, free minutes, rank offset, breakdown and evening supplement.
const test = require('node:test');
const assert = require('node:assert/strict');

const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const {
  priceSessions, bookingDeductions, eveningSupplement, priceRange,
} = optionalPlugin(() => require('../plugins/hourly-resources/hourlyPricing'));
const { priceBookingLines } = optionalPlugin(() => require('../plugins/hourly-resources/bookingPricing'));
const NEEDS_PLUGIN = { skip: skipWithout(['hourly-resources']) };
const { degressiveTiersProblem } = require('../utils/degressiveTiers');
const resourcesController = require('../controllers/resourcesController');

const TIERS = [{ fromHour: 2, percent: 10 }, { fromHour: 3, percent: 20 }];
const OUTSIDE = {
  dayRate: 50, eveningRate: 70, eveningStart: '20:00', slotMinutes: 60,
};
const session = (start, end) => [{ date: '2030-01-01', start, end }]; // date-literal-ok: the suite runs on its own clock, never the real today

test('a wrong table is refused with the sentence of the faulty row', () => {
  assert.equal(degressiveTiersProblem([]), null);
  assert.equal(degressiveTiersProblem(TIERS), null);
  assert.equal(degressiveTiersProblem([{ fromHour: 2, percent: 10 }, { fromHour: 3, percent: 101 }]), 'Ligne 2 : la remise doit être un entier entre 0 et 100.');
  assert.equal(degressiveTiersProblem([{ fromHour: 2, percent: 10.5 }]), 'Ligne 1 : la remise doit être un entier entre 0 et 100.');
  assert.match(degressiveTiersProblem([{ fromHour: 1, percent: 10 }]), /^Ligne 1 : .*au moins 2/);
  assert.match(degressiveTiersProblem([{ fromHour: 2, percent: 10 }, { fromHour: 2, percent: 20 }]), /^Ligne 2 : .*supérieure à celle de la ligne 1/);
  assert.match(degressiveTiersProblem([{ fromHour: 3, percent: 10 }, { fromHour: 2, percent: 20 }]), /^Ligne 2/);
  assert.match(degressiveTiersProblem('nope'), /liste/);
});

test('the resource form refuses a wrong table on its own field and stores a valid one', () => {
  const written = [];
  const model = { insert: (body) => { written.push(body); return 1; } };
  const controller = resourcesController.buildController(model, { isOffered: () => true, properties: () => [] });
  const call = (body) => {
    let out;
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { out = { status: this.statusCode, body: b }; return this; } };
    controller.create({ query: {}, params: {}, body }, res);
    return out;
  };
  const base = { name: 'Bain', priceType: 'per_hour', price: 50, quantity: 1 };
  const refused = call({ ...base, hourlyDegressiveTiers: [{ fromHour: 2, percent: -5 }] });
  assert.equal(refused.status, 422);
  assert.deepEqual(refused.body.details, [{ field: 'hourlyDegressiveTiers', message: 'Ligne 1 : la remise doit être un entier entre 0 et 100.' }]);
  assert.equal(written.length, 0);
  assert.equal(call({ ...base, hourlyDegressiveTiers: TIERS }).status, 200);
  assert.equal(call(base).status, 200);
});

test('18:00-21:00 outside: 50 + 45 + 56 = 151', NEEDS_PLUGIN, () => {
  const priced = priceSessions(session('18:00', '21:00'), { ...OUTSIDE, degressiveTiers: TIERS });
  assert.equal(priced.grossPrice, 151);
  assert.equal(priced.totalPrice, 151);
  assert.deepEqual(priced.bands.map((b) => [b.band, b.from, b.to, b.rate, b.amount, b.percent]), [
    ['day', '18:00', '19:00', 50, 50, undefined],
    ['day', '19:00', '20:00', 45, 45, 10],
    ['evening', '20:00', '21:00', 56, 56, 20],
  ]);
});

test('the stored JSON is read like the array', NEEDS_PLUGIN, () => {
  assert.equal(priceSessions(session('18:00', '21:00'), { ...OUTSIDE, degressiveTiers: JSON.stringify(TIERS) }).grossPrice, 151);
  assert.equal(priceSessions(session('18:00', '21:00'), { ...OUTSIDE, degressiveTiers: 'garbage' }).grossPrice, 50 + 50 + 70);
});

test('an empty table prices exactly as before, on several sessions', NEEDS_PLUGIN, () => {
  const cases = [
    [session('10:00', '13:00'), 0],
    [session('19:00', '22:00'), 0],
    [session('20:00', '22:00'), 0],
    [session('18:30', '21:00'), 60],
    [session('10:00', '12:00'), 60],
  ];
  const awkward = { ...OUTSIDE, dayRate: 33.33, eveningRate: 41.11, slotMinutes: 30 };
  cases.forEach(([sessions, free]) => {
    [OUTSIDE, awkward].forEach((cfg) => {
      const bare = priceSessions(sessions, cfg, free);
      assert.deepEqual(priceSessions(sessions, { ...cfg, degressiveTiers: [] }, free), bare);
      assert.deepEqual(priceSessions(sessions, { ...cfg, degressiveTiers: '[]' }, free), bare);
    });
  });
  assert.equal(priceSessions(session('18:00', '21:00'), OUTSIDE).grossPrice, 50 + 50 + 70);
  assert.equal(priceSessions(session('10:00', '10:30'), awkward).bands.some((b) => 'percent' in b), false);
});

test('ranks continue after the free minutes: the free hour takes rank 1', NEEDS_PLUGIN, () => {
  const priced = priceSessions(session('10:00', '13:00'), { ...OUTSIDE, degressiveTiers: TIERS }, 60);
  assert.equal(priced.grossPrice, 50 + 45 + 40);
  assert.equal(priced.freeValue, 50);
  assert.equal(priced.totalPrice, 45 + 40);
});

test('free minutes are valued at the day rate even placed in the evening', NEEDS_PLUGIN, () => {
  const priced = priceSessions(session('20:00', '22:00'), { ...OUTSIDE, degressiveTiers: TIERS }, 60);
  assert.equal(priced.grossPrice, 70 + 63);
  assert.equal(priced.freeValue, 50);
  assert.equal(priced.freeSupplement, 20);
});

test('rankOffsetMinutes prices time added after minutes already covered', NEEDS_PLUGIN, () => {
  const cfg = { ...OUTSIDE, degressiveTiers: TIERS };
  assert.equal(priceSessions(session('10:00', '11:00'), { ...cfg, rankOffsetMinutes: 60 }).grossPrice, 45);
  assert.equal(priceSessions(session('10:00', '11:00'), { ...cfg, rankOffsetMinutes: 120 }).grossPrice, 40);
  const half = { ...cfg, slotMinutes: 30, rankOffsetMinutes: 30 };
  assert.equal(priceSessions(session('10:00', '12:00'), half).grossPrice, 25 + 22.5 + 22.5 + 20);
  assert.equal(priceSessions(session('10:00', '11:00'), { ...cfg, rankOffsetMinutes: 0 }).grossPrice, 50);
});

test('half-hour slices take the rank of the hour they fall in, each rounded to the cent', NEEDS_PLUGIN, () => {
  const cfg = {
    dayRate: 33.33, eveningRate: 0, eveningStart: null, slotMinutes: 30, degressiveTiers: [{ fromHour: 2, percent: 10 }],
  };
  const priced = priceSessions(session('10:00', '12:00'), cfg);
  assert.equal(priced.grossPrice, 16.67 + 16.67 + 15 + 15);
  const sum = priced.bands.reduce((s, b) => s + b.amount, 0);
  assert.equal(Math.round(sum * 100), Math.round(priced.grossPrice * 100));
});

test('the per-band breakdown adds up exactly to the gross', NEEDS_PLUGIN, () => {
  const cfg = {
    dayRate: 33.33, eveningRate: 47.77, eveningStart: '20:00', slotMinutes: 30, degressiveTiers: [{ fromHour: 2, percent: 7 }, { fromHour: 4, percent: 33 }],
  };
  [session('17:00', '23:00'), session('19:30', '22:30'), session('08:00', '13:30')].forEach((s) => {
    const priced = priceSessions(s, cfg);
    assert.equal(Math.round(priced.bands.reduce((sum, b) => sum + b.amount, 0) * 100), Math.round(priced.grossPrice * 100));
  });
});

test('a booking prices the guest and the outside context with the same table', NEEDS_PLUGIN, () => {
  const resource = {
    priceType: 'per_hour', price: 40, showsPlanningCard: 1, slotDuration: 60, hourlyEveningStart: '20:00', hourlyEveningRate: 60,
    hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70, hourlyDegressiveTiers: JSON.stringify(TIERS),
  };
  const guest = priceBookingLines({ resource, startTime: '18:00', endTime: '21:00', external: false });
  const outside = priceBookingLines({ resource, startTime: '18:00', endTime: '21:00', external: true });
  assert.equal(guest.grossTotal, 40 + 36 + 48);
  assert.equal(outside.grossTotal, 151);
  assert.equal(outside.total, 151);
  const linear = priceBookingLines({ resource: { ...resource, hourlyDegressiveTiers: '[]' }, startTime: '18:00', endTime: '21:00', external: true });
  assert.equal(linear.grossTotal, 50 + 50 + 70);
});

test('a booking with a free hour and an offered hour deducts them at their ranks', NEEDS_PLUGIN, () => {
  const resource = {
    priceType: 'per_hour', price: 50, showsPlanningCard: 1, slotDuration: 60, hourlyEveningStart: null, hourlyEveningRate: 0,
    hourlyDegressiveTiers: TIERS,
  };
  const priced = priceBookingLines({
    resource, startTime: '10:00', endTime: '13:00', override: { freeMinutes: 60 }, external: false, offeredMinutes: 60,
  });
  assert.equal(priced.grossTotal, 135);
  assert.equal(priced.freeValue, 50);
  assert.equal(priced.offeredValue, 45);
  assert.equal(priced.total, 40);
});

test('bookingDeductions keeps the flat day rate for a linear resource', NEEDS_PLUGIN, () => {
  const cfg = { dayRate: 33.33, eveningRate: 0, eveningStart: null, slotMinutes: 30 };
  assert.deepEqual(bookingDeductions({ start: 600, freeApplied: 45, offeredApplied: 0 }, cfg), { freeValue: 25, offeredValue: 0 });
});

test('the evening supplement is the evening price minus the day price, both at their rank', NEEDS_PLUGIN, () => {
  const cfg = { ...OUTSIDE, degressiveTiers: TIERS };
  assert.equal(eveningSupplement([{ start: '18:00', end: '21:00' }], cfg), 16);
  assert.equal(eveningSupplement([{ start: '18:00', end: '21:00' }], OUTSIDE), 20);
  assert.equal(eveningSupplement([{ start: '20:00', end: '21:00' }], cfg), 20);
  assert.equal(eveningSupplement([{ start: '20:00', end: '21:00' }], { ...cfg, rankOffsetMinutes: 120 }), 16);
});

test('a standalone slot is at rank 1 whatever the table', NEEDS_PLUGIN, () => {
  assert.equal(priceRange('19:00', '20:00', { ...OUTSIDE, degressiveTiers: TIERS }), 50);
});
