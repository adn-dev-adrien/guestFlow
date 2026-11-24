// specs/hourly-extra-hour-rates.md rules 1-7 — a price for the following hours of a banded hourly resource, per audience and band:
// the engine's rank-based rates, the free hour that is not a rank, the audience's rate grid, the words, the validation, the stored columns and
// the conversion of the withdrawn percent table.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const {
  priceSessions, bookingDeductions, eveningSupplement, priceRange, normalizeConfig,
} = optionalPlugin(() => require('../plugins/hourly-resources/hourlyPricing'));
const { priceBookingLines, rateGridOf } = optionalPlugin(() => require('../plugins/hourly-resources/bookingPricing'));
const { sessionModesOf, quoteSession } = optionalPlugin(() => require('../plugins/hourly-resources/sessionQuote'));
const { buildCatalogueLines } = optionalPlugin(() => require('../plugins/hourly-resources/catalogueLines'));
const { nextHourRates } = optionalPlugin(() => require('../plugins/hourly-resources/migrations'));
const NEEDS_PLUGIN = { skip: skipWithout(['hourly-resources']) };
const resourcesController = require('../controllers/resourcesController');
const resourcesModel = require('../models/resourcesModel');
const db = require('../database');

const session = (start, end) => [{ date: '2030-01-01', start, end }]; // date-literal-ok: the suite runs on its own clock, never the real today
const OUTSIDE = {
  dayRate: 50, eveningRate: 70, eveningStart: '20:00', slotMinutes: 60,
};
const NEXT = { ...OUTSIDE, dayNextRate: 40, eveningNextRate: 50 };

test('rule 1 — a following-hours rate left empty is the first-hour rate of its band: nothing changes for a resource nobody edits', NEEDS_PLUGIN, () => {
  const bare = priceSessions(session('18:00', '21:00'), OUTSIDE);
  assert.equal(bare.grossPrice, 50 + 50 + 70);
  [undefined, null, ''].forEach((empty) => {
    assert.deepEqual(priceSessions(session('18:00', '21:00'), { ...OUTSIDE, dayNextRate: empty, eveningNextRate: empty }), bare);
  });
  const norm = normalizeConfig({ ...OUTSIDE, dayNextRate: null });
  assert.deepEqual([norm.dayNextRate, norm.eveningNextRate], [50, 70]);
});

test('rule 1 — 0 is a real following-hours rate (free), unlike the first-hour external fields', NEEDS_PLUGIN, () => {
  assert.equal(priceSessions(session('10:00', '13:00'), { ...OUTSIDE, dayNextRate: 0 }).grossPrice, 50);
});

test('rule 1 — a resource without an evening band takes the day following-hours rate everywhere', NEEDS_PLUGIN, () => {
  const noEvening = { dayRate: 50, eveningRate: 0, eveningStart: null, slotMinutes: 60, dayNextRate: 40, eveningNextRate: 99 };
  assert.equal(priceSessions(session('20:00', '23:00'), noEvening).grossPrice, 50 + 40 + 40);
});

test('rule 2 — outside 50 / 70 with following hours 40 / 50, evening at 20:00: 18:00-21:00 is 50 + 40 + 50 = 140, the bands add up to it', NEEDS_PLUGIN, () => {
  const priced = priceSessions(session('18:00', '21:00'), NEXT);
  assert.equal(priced.grossPrice, 140);
  assert.deepEqual(priced.bands, [
    { band: 'day', from: '18:00', to: '19:00', minutes: 60, rate: 50, amount: 50 },
    { band: 'day', from: '19:00', to: '20:00', minutes: 60, rate: 40, amount: 40 },
    { band: 'evening', from: '20:00', to: '21:00', minutes: 60, rate: 50, amount: 50 },
  ]);
  assert.equal(priced.bands.reduce((sum, b) => sum + b.amount, 0), priced.grossPrice);
  assert.ok(priced.bands.every((b) => !('percent' in b)), 'no percent any more: the entry carries the effective rate');
});

test('rule 2 — a session of one hour or less only takes first-hour rates; a slot grid price is the first hour\'s', NEEDS_PLUGIN, () => {
  assert.equal(priceSessions(session('18:00', '19:00'), NEXT).grossPrice, 50);
  assert.equal(priceRange('20:00', '21:00', NEXT), 70);
  assert.equal(priceRange('19:00', '20:00', NEXT), 50, 'priced alone, a slot is the first hour of its own range');
});

test('rule 2 — a 30-min grid crossing the switch: 19:30-21:00 is the day first half hour, the evening rest of the first hour, then the evening following hours', NEEDS_PLUGIN, () => {
  const cfg = { ...NEXT, eveningNextRate: 60, slotMinutes: 30 };
  const priced = priceSessions(session('19:30', '21:00'), cfg);
  assert.equal(priced.grossPrice, 25 + 35 + 30);
  assert.deepEqual(priced.bands.map((b) => [b.band, b.from, b.to, b.rate, b.amount]), [
    ['day', '19:30', '20:00', 50, 25],
    ['evening', '20:00', '20:30', 70, 35],
    ['evening', '20:30', '21:00', 60, 30],
  ]);
});

test('rule 2 — time added after minutes already covered (a voucher) is a following hour: rankOffsetMinutes keeps counting from the first covered minute', NEEDS_PLUGIN, () => {
  assert.equal(priceSessions(session('12:00', '13:00'), { ...NEXT, rankOffsetMinutes: 120 }).grossPrice, 40);
  assert.equal(priceSessions(session('20:00', '21:00'), { ...NEXT, rankOffsetMinutes: 60 }).grossPrice, 50);
  assert.equal(priceSessions(session('20:00', '21:00'), { ...NEXT, rankOffsetMinutes: 0 }).grossPrice, 70);
  const whole = priceSessions(session('10:00', '13:00'), NEXT).grossPrice;
  const parts = priceSessions(session('10:00', '12:00'), NEXT).grossPrice + priceSessions(session('12:00', '13:00'), { ...NEXT, rankOffsetMinutes: 120 }).grossPrice;
  assert.equal(whole, parts, 'one session or two lines, the same price');
});

test('rule 3 — the free hour is not a rank: a guest of 3 h 18:00-21:00 with 1 h free, following hours 40, pays 0 + 50 + 40 = 90', NEEDS_PLUGIN, () => {
  const guest = {
    dayRate: 50, eveningRate: 0, eveningStart: null, slotMinutes: 60, dayNextRate: 40,
  };
  const priced = priceSessions(session('18:00', '21:00'), guest, 60);
  assert.equal(priced.totalPrice, 90);
  assert.equal(priced.freeValue, 50, 'the free hour stays valued at the first-hour day rate');
  assert.equal(priced.billedMinutes, 120);
  assert.deepEqual(priced.bands.map((b) => [b.from, b.to, b.rate]), [['18:00', '20:00', 50], ['20:00', '21:00', 40]]);
});

test('rule 3 — 2 h with the free hour: the second hour is the first PAID hour, at the first-hour rate; 1 h with the free hour is 0 €', NEEDS_PLUGIN, () => {
  const guest = {
    dayRate: 50, eveningRate: 0, eveningStart: null, slotMinutes: 60, dayNextRate: 40,
  };
  assert.equal(priceSessions(session('18:00', '20:00'), guest, 60).totalPrice, 50);
  assert.equal(priceSessions(session('18:00', '19:00'), guest, 60).totalPrice, 0);
  assert.equal(priceSessions(session('18:00', '20:00'), guest, 0).totalPrice, 90, 'without the free hour the second hour is a following hour');
});

test('rule 3 — the same through a booking: free minutes of the property, then the offered minutes, are first-hour priced; the next hour is a following one', NEEDS_PLUGIN, () => {
  const resource = {
    priceType: 'per_hour', price: 50, showsPlanningCard: 1, slotDuration: 60, hourlyEveningStart: null, hourlyEveningRate: 0, hourlyNextDayRate: 40,
  };
  const override = { freeMinutes: 60 };
  const two = priceBookingLines({ resource, startTime: '18:00', endTime: '20:00', override, external: false });
  assert.equal(two.total, 50);
  const three = priceBookingLines({ resource, startTime: '18:00', endTime: '21:00', override, external: false });
  assert.equal(three.total, 90);
  assert.equal(three.grossTotal, 140);
  assert.equal(three.freeValue, 50);
  const offered = priceBookingLines({
    resource, startTime: '18:00', endTime: '21:00', override, external: false, offeredMinutes: 60,
  });
  assert.equal(offered.offeredValue, 50, 'the offered hour right after the free one is the first paid hour');
  assert.equal(offered.total, 40);
  assert.deepEqual(bookingDeductions({
    start: 18 * 60, freeApplied: 60, offeredApplied: 60,
  }, { dayRate: 50, dayNextRate: 40, slotMinutes: 60 }), { freeValue: 50, offeredValue: 50 });
});

test('rule 3 — a free hour placed in the evening: valued at the day rate, the evening first-hour rate above it is the supplement', NEEDS_PLUGIN, () => {
  const priced = priceSessions(session('20:00', '22:00'), NEXT, 60);
  assert.equal(priced.freeValue, 50);
  assert.equal(priced.freeSupplement, 20);
  assert.equal(priced.grossPrice, 70 + 70);
  assert.equal(priced.totalPrice, 90);
});

test('rule 4 — the audience decides the rate set: guests take price / hourlyEveningRate and their following rates, outsiders the external ones with the guest fallback', NEEDS_PLUGIN, () => {
  const resource = {
    price: 25, hourlyEveningRate: 35, hourlyNextDayRate: 20, hourlyNextEveningRate: null,
    hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70, hourlyExternalNextDayRate: 40, hourlyExternalNextEveningRate: 0,
  };
  assert.deepEqual(rateGridOf(resource, { external: false }), { dayRate: 25, eveningRate: 35, dayNextRate: 20, eveningNextRate: null });
  assert.deepEqual(rateGridOf(resource, { external: true }), { dayRate: 50, eveningRate: 70, dayNextRate: 40, eveningNextRate: 0 });
  const fallback = rateGridOf({ ...resource, hourlyExternalDayRate: 0, hourlyExternalEveningRate: 0, hourlyExternalNextDayRate: null }, { external: true });
  assert.deepEqual(fallback, { dayRate: 25, eveningRate: 35, dayNextRate: null, eveningNextRate: 0 });
  assert.deepEqual(rateGridOf(resource, { external: false, guestDayRate: 30 }), { dayRate: 30, eveningRate: 35, dayNextRate: 20, eveningNextRate: null });
});

test('rule 4 — a booking outside a stay is priced from the external set, a stay\'s hours from the guest set', NEEDS_PLUGIN, () => {
  const resource = {
    priceType: 'per_hour', price: 25, showsPlanningCard: 1, slotDuration: 60, hourlyEveningStart: '20:00', hourlyEveningRate: 35,
    hourlyNextDayRate: 20, hourlyNextEveningRate: 30, hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70, hourlyExternalNextDayRate: 40, hourlyExternalNextEveningRate: 50,
  };
  const outside = priceBookingLines({ resource, startTime: '18:00', endTime: '21:00', external: true });
  assert.equal(outside.total, 140);
  assert.equal(outside.rateGrid, 'external');
  const guest = priceBookingLines({ resource, startTime: '18:00', endTime: '21:00', external: false });
  assert.equal(guest.total, 25 + 20 + 30);
});

test('rule 4 — the evening supplement and the dateless quote follow the same rates', NEEDS_PLUGIN, () => {
  const banded = priceSessions(session('19:00', '22:00'), NEXT).grossPrice;
  const dayOnly = priceSessions(session('19:00', '22:00'), { ...NEXT, eveningRate: 50, eveningNextRate: 40, eveningStart: '' }).grossPrice;
  assert.equal(eveningSupplement([{ start: '19:00', end: '22:00' }], NEXT), banded - dayOnly);
  const resource = {
    id: 3, name: 'Bain', priceType: 'per_hour', price: 25, showsPlanningCard: 1, slotDuration: 60, openTime: '10:00', closeTime: '22:00', minimumUsageMinutes: 60,
    hourlyEveningStart: '19:00', hourlyEveningRate: 35, hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70, hourlyExternalNextDayRate: 40, hourlyExternalNextEveningRate: 55,
  };
  const day = quoteSession({ id: 3, resource, vatClass: 'resources' }, { band: 'day', minutes: 180 });
  assert.equal(day.line.totalCents, (50 + 40 + 40) * 100);
  const evening = quoteSession({ id: 3, resource, vatClass: 'resources' }, { band: 'evening', minutes: 60, rankOffsetMinutes: 60 });
  assert.equal(evening.line.totalCents, 5500);
});

test('rule 6 — the tariff in words: the modes carry « puis X €/h » when the following hours differ, nothing when they do not', NEEDS_PLUGIN, () => {
  const resource = {
    id: 3, name: 'Bain', priceType: 'per_hour', price: 25, showsPlanningCard: 1, slotDuration: 60, openTime: '10:00', closeTime: '22:00', minimumUsageMinutes: 60,
    hourlyEveningStart: '19:00', hourlyEveningRate: 35, hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70, hourlyExternalNextDayRate: 45, hourlyExternalNextEveningRate: 70,
  };
  const modes = sessionModesOf(resource);
  assert.deepEqual(modes.map((m) => [m.band, m.rateCents, m.followingRateCents, m.followingText]), [
    ['day', 5000, 4500, 'puis 45 €/h'],
    ['evening', 7000, 7000, null],
  ]);
  assert.equal(sessionModesOf({ ...resource, hourlyExternalNextDayRate: 37.5 })[0].followingText, 'puis 37,50 €/h');
  assert.ok(sessionModesOf({ ...resource, hourlyExternalNextDayRate: null }).every((m) => m.followingText === null));
});

test('rule 6 — the resource card says « puis » for the outside rates and a line for the guests\' following hours, and stays silent when they equal the first hour', NEEDS_PLUGIN, () => {
  const resource = {
    priceType: 'per_hour', price: 25, hourlyEveningStart: '19:00', hourlyEveningRate: 35, hourlyNextDayRate: 20, hourlyNextEveningRate: 35,
    hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70, hourlyExternalNextDayRate: 40, hourlyExternalNextEveningRate: null,
  };
  const lines = buildCatalogueLines(resource).lines;
  assert.deepEqual(lines.find((l) => l.label === 'Heures suivantes'), { label: 'Heures suivantes', value: 'jour 20 € / h' });
  assert.deepEqual(lines.find((l) => l.label === 'Extérieurs'), { label: 'Extérieurs', value: '50 € / h puis 40 € / h · soir 70 € / h' });
  const plain = buildCatalogueLines({ ...resource, hourlyNextDayRate: null, hourlyNextEveningRate: null, hourlyExternalNextDayRate: 50 }).lines;
  assert.equal(plain.find((l) => l.label === 'Heures suivantes'), undefined);
  assert.equal(plain.find((l) => l.label === 'Extérieurs').value, '50 € / h · soir 70 € / h');
});

const callCreate = (body) => {
  const written = [];
  const model = { insert: (payload) => { written.push(payload); return 1; } };
  const controller = resourcesController.buildController(model, { isOffered: () => true, properties: () => [] });
  let out;
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { out = { status: this.statusCode, body: b }; return this; } };
  controller.create({ query: {}, params: {}, body }, res);
  return { ...out, written };
};
const BASE = {
  name: 'Bain', priceType: 'per_hour', price: 50, quantity: 1,
};

test('rule 5 — a wrong following-hours rate is refused on its own field with the sentence naming its band and audience', () => {
  const cases = [
    ['hourlyNextDayRate', 'journée, hébergés'], ['hourlyNextEveningRate', 'soir, hébergés'],
    ['hourlyExternalNextDayRate', 'journée, extérieurs'], ['hourlyExternalNextEveningRate', 'soir, extérieurs'],
  ];
  cases.forEach(([field, where]) => {
    [-1, 'abc', 10000.5, 12.345, 1e300].forEach((bad) => {
      const refused = callCreate({ ...BASE, [field]: bad });
      assert.equal(refused.status, 422, `${field} = ${bad}`);
      assert.deepEqual(refused.body.details, [{ field, message: `Le tarif des heures suivantes (${where}) doit être un montant positif.` }]);
      assert.equal(refused.written.length, 0);
    });
  });
});

test('rule 5 — empty, 0 and a price with two decimals are accepted; the percent table is no longer part of the contract', () => {
  [undefined, null, '', 0, '0', 40, '37,50', 37.5, 10000].forEach((fine) => {
    assert.equal(callCreate({ ...BASE, hourlyNextDayRate: fine, hourlyExternalNextEveningRate: fine }).status, 200, String(fine));
  });
  const withTable = callCreate({ ...BASE, hourlyDegressiveTiers: [{ fromHour: 2, percent: -5 }] });
  assert.equal(withTable.status, 200, 'an old client sending a table is not refused over it');
  const id = resourcesModel.insert({ ...BASE, name: 'Bain sans table', hourlyDegressiveTiers: [{ fromHour: 2, percent: 10 }] });
  assert.equal(db.prepare('SELECT hourlyDegressiveTiers AS t FROM resources WHERE id = ?').get(id).t, '[]', 'the column is no longer written');
});

test('rule 1, 5 — the four rates are stored as numbers or NULL, read back the same, and a save that does not send them keeps them', () => {
  const model = resourcesModel;
  const id = model.insert({
    ...BASE, name: 'Bain stocké', hourlyNextDayRate: '40', hourlyNextEveningRate: '', hourlyExternalNextDayRate: 0, hourlyExternalNextEveningRate: '37,50',
  });
  const read = () => db.prepare('SELECT hourlyNextDayRate, hourlyNextEveningRate, hourlyExternalNextDayRate, hourlyExternalNextEveningRate FROM resources WHERE id = ?').get(id);
  assert.deepEqual(read(), {
    hourlyNextDayRate: 40, hourlyNextEveningRate: null, hourlyExternalNextDayRate: 0, hourlyExternalNextEveningRate: 37.5,
  }, 'empty is NULL, 0 stays 0, a decimal comma is read');
  const fetched = model.findById(id);
  assert.deepEqual([fetched.hourlyNextDayRate, fetched.hourlyNextEveningRate, fetched.hourlyExternalNextDayRate], [40, null, 0]);
  model.update(id, { ...BASE, name: 'Bain stocké', hourlyNextEveningRate: 55.5 });
  assert.deepEqual(read(), {
    hourlyNextDayRate: 40, hourlyNextEveningRate: 55.5, hourlyExternalNextDayRate: 0, hourlyExternalNextEveningRate: 37.5,
  });
  model.update(id, { ...BASE, name: 'Bain stocké', hourlyNextDayRate: null });
  assert.equal(read().hourlyNextDayRate, null, 'null empties the rate');
});

const legacyDb = (rows) => {
  const legacy = new Database(':memory:');
  legacy.exec(`CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, price REAL, hourlyEveningRate REAL, hourlyExternalDayRate REAL, hourlyExternalEveningRate REAL, hourlyDegressiveTiers TEXT)`);
  const insert = legacy.prepare('INSERT INTO resources (id, name, price, hourlyEveningRate, hourlyExternalDayRate, hourlyExternalEveningRate, hourlyDegressiveTiers) VALUES (?, ?, ?, ?, ?, ?, ?)');
  rows.forEach((r) => insert.run(...r));
  return legacy;
};
const nextsOf = (legacy, id) => legacy.prepare('SELECT hourlyNextDayRate AS d, hourlyNextEveningRate AS e, hourlyExternalNextDayRate AS xd, hourlyExternalNextEveningRate AS xe FROM resources WHERE id = ?').get(id);

test('rule 7 — a resource with a percent table gets following rates = first-hour rates discounted by the percent of rank 2, rounded to the cent; later rows are dropped', NEEDS_PLUGIN, () => {
  const legacy = legacyDb([
    [1, 'Bain', 50, 70, 0, 0, JSON.stringify([{ fromHour: 2, percent: 10 }, { fromHour: 3, percent: 20 }])],
    [2, 'Linéaire', 50, 70, 0, 0, '[]'],
    [3, 'Arrondi', 33.33, 0, 47.77, 0, JSON.stringify([{ fromHour: 2, percent: 7 }])],
    [4, 'Seulement dès la 3e', 40, 0, 0, 0, JSON.stringify([{ fromHour: 3, percent: 50 }])],
  ]);
  const logged = [];
  const log = console.log;
  console.log = (line) => logged.push(line);
  try { nextHourRates(legacy); } finally { console.log = log; }
  assert.deepEqual(nextsOf(legacy, 1), { d: 45, e: 63, xd: 45, xe: 63 }, 'guests 50/70 and the outside fallback to them, both −10 %');
  assert.deepEqual(nextsOf(legacy, 2), { d: null, e: null, xd: null, xe: null }, 'no table, nothing written: same as the first hour');
  assert.deepEqual(nextsOf(legacy, 3), { d: 31.0, e: 31.0, xd: 44.43, xe: 44.43 }, 'the effective first-hour rates, the outside fallback included, −7 % to the cent');
  assert.deepEqual(nextsOf(legacy, 4), { d: 40, e: 40, xd: 40, xe: 40 }, 'a table that starts at rank 3 discounts nothing at rank 2');
  assert.equal(logged.length, 1);
  assert.match(logged[0], /3 resource\(s\)/);
  assert.match(logged[0], /dropped/);
});

test('rule 7 — the migration is safe to run on a table already carrying the columns, and on a database with no resources table', NEEDS_PLUGIN, () => {
  const legacy = legacyDb([[1, 'Bain', 50, 70, 0, 0, JSON.stringify([{ fromHour: 2, percent: 10 }])]]);
  nextHourRates(legacy);
  nextHourRates(legacy);
  assert.deepEqual(nextsOf(legacy, 1), { d: 45, e: 63, xd: 45, xe: 63 });
  assert.doesNotThrow(() => nextHourRates(new Database(':memory:')));
});

test('rule 7 — the stored table is no longer read: a priced resource ignores hourlyDegressiveTiers', NEEDS_PLUGIN, () => {
  const resource = {
    priceType: 'per_hour', price: 50, showsPlanningCard: 1, slotDuration: 60, hourlyEveningStart: null, hourlyEveningRate: 0, hourlyDegressiveTiers: JSON.stringify([{ fromHour: 2, percent: 50 }]),
  };
  assert.equal(priceBookingLines({ resource, startTime: '10:00', endTime: '13:00', external: false }).total, 150);
});
