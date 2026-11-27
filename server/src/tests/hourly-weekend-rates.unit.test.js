// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 1-9 — the period of a slice, the outside customer's weekend grid, guests untouched,
// every price required (the plugin's own check), and the migration that makes every price explicit.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const { periodOf, priceSessions } = optionalPlugin(() => require('../plugins/hourly-resources/hourlyPricing'));
const { rateGridOf, rateConfigOf, priceBookingLines } = optionalPlugin(() => require('../plugins/hourly-resources/bookingPricing'));
const { validateHourlyRates } = optionalPlugin(() => require('../plugins/hourly-resources/resourceRates'));
const { explicitHourlyRates } = optionalPlugin(() => require('../plugins/hourly-resources/migrations'));
const { buildCatalogueLines } = optionalPlugin(() => require('../plugins/hourly-resources/catalogueLines'));
const NEEDS_PLUGIN = { skip: skipWithout(['hourly-resources']) };

const BATH = {
  priceType: 'per_hour', showsPlanningCard: 1, price: 40, slotDuration: 30, hourlyEveningStart: '20:00', hourlyEveningRate: 55,
  hourlyNextDayRate: 35, hourlyNextEveningRate: 50,
  hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70, hourlyExternalNextDayRate: 45, hourlyExternalNextEveningRate: 65,
  hourlyExternalWeekendDayRate: 70, hourlyExternalWeekendEveningRate: 90, hourlyExternalWeekendNextDayRate: 60, hourlyExternalWeekendNextEveningRate: 80,
};
const outside = (resource, date, start, end, extra = {}) => priceSessions([{ date, start, end }], {
  ...rateConfigOf(resource, { external: true }), eveningStart: resource.hourlyEveningStart, slotMinutes: 30, ...extra,
});

test('rule 6 — Friday from the evening switch, Saturday, Sunday and public holidays are weekend; the eve of a holiday is weekend from the evening switch', NEEDS_PLUGIN, () => {
  const at = (date, start) => periodOf(date, start, '20:00');
  assert.equal(at('2026-11-25', '21:00'), 'week', 'Wednesday evening');
  assert.equal(at('2026-11-27', '14:00'), 'week', 'Friday day');
  assert.equal(at('2026-11-27', '20:00'), 'weekend', 'Friday evening');
  assert.equal(at('2026-11-28', '09:00'), 'weekend');
  assert.equal(at('2026-11-29', '09:00'), 'weekend');
  assert.equal(at('2026-04-06', '10:00'), 'weekend', 'Easter Monday, all day');
  assert.equal(at('2026-05-13', '19:30'), 'week', 'the eve of Ascension before the switch');
  assert.equal(at('2026-05-13', '20:00'), 'weekend', 'the eve of Ascension in the evening');
  assert.equal(periodOf('2026-11-27', '23:00', null), 'week', 'no evening switch, no Friday weekend');
  assert.equal(periodOf('pas une date', '12:00', '20:00'), 'week');
});

test('rule 6 — a session 19:30-21:00 on a Friday is priced week day then weekend evening, the ranks running on', NEEDS_PLUGIN, () => {
  const priced = outside(BATH, '2026-11-27', '19:30', '21:00');
  assert.deepEqual(priced.bands.map((b) => [b.band, b.from, b.to, b.rate]), [
    ['day', '19:30', '20:00', 50],
    ['evening', '20:00', '20:30', 90],
    ['evening', '20:30', '21:00', 80],
  ]);
  assert.equal(priced.grossPrice, 25 + 45 + 40);
});

test('rule 6 — the weekend first hour is the weekend grid\'s, the following hours too; a Wednesday is the week grid', NEEDS_PLUGIN, () => {
  assert.equal(outside(BATH, '2026-11-28', '10:00', '11:00').grossPrice, 70);
  assert.equal(outside(BATH, '2026-11-28', '10:00', '12:00').grossPrice, 70 + 60);
  assert.equal(outside(BATH, '2026-11-25', '10:00', '12:00').grossPrice, 50 + 45);
  assert.equal(outside(BATH, '2026-11-28', '20:00', '21:00').grossPrice, 90);
});

test('rule 7 — guests pay the same price every day', NEEDS_PLUGIN, () => {
  const guest = (date) => priceSessions([{ date, start: '10:00', end: '12:00' }], { ...rateConfigOf(BATH, { external: false }), eveningStart: '20:00', slotMinutes: 30 }).grossPrice;
  assert.equal(guest('2026-11-28'), guest('2026-11-25'));
  assert.equal(guest('2026-11-28'), 40 + 35);
});

test('rule 8 — a dateless quote takes an explicit period, week without one', NEEDS_PLUGIN, () => {
  const dateless = (period) => priceSessions([{ date: '2000-01-01', start: '10:00', end: '11:00' }], {
    ...rateConfigOf(BATH, { external: true, period }), eveningStart: '20:00', slotMinutes: 30,
  }).grossPrice;
  assert.equal(dateless('week'), 50);
  assert.equal(dateless('weekend'), 70);
  const booking = (date) => priceBookingLines({ resource: BATH, startTime: '10:00', endTime: '11:00', external: true, date }).total;
  assert.equal(booking(null), 50, 'no date: the week grid, never the placeholder day');
  assert.equal(booking('2026-11-28'), 70);
});

test('rule 2 — an outside first-hour rate at 0 is not sold: no fallback to the guests\' rate', NEEDS_PLUGIN, () => {
  const grid = rateGridOf({ ...BATH, hourlyExternalDayRate: 0 }, { external: true });
  assert.equal(grid.dayRate, 0);
  assert.equal(rateGridOf(BATH, { external: true, period: 'weekend' }).eveningRate, 90);
});

const REQUIRED = { ...BATH, name: 'Bain', quantity: 1, sellableExternally: 1 };
const fields = (details) => details.map((d) => d.field).sort();

test('rule 2 — every price is required: a blank grid field is refused on its own field, naming it', NEEDS_PLUGIN, () => {
  assert.deepEqual(validateHourlyRates(REQUIRED), []);
  const blank = validateHourlyRates({ ...REQUIRED, hourlyExternalWeekendNextEveningRate: '', hourlyNextDayRate: null });
  assert.deepEqual(fields(blank), ['hourlyExternalWeekendNextEveningRate', 'hourlyNextDayRate']);
  assert.equal(blank.find((d) => d.field === 'hourlyExternalWeekendNextEveningRate').message, 'Le tarif extérieurs (week-end, soirée, heures suivantes) doit être un montant positif.');
});

test('rule 2 — a number from 0 to 10 000 with two decimals; 0 is explicit; the outside grid only when the resource is sold outside a stay', NEEDS_PLUGIN, () => {
  [-1, 'abc', 10000.5, 12.345, 1e300].forEach((bad) => {
    assert.deepEqual(fields(validateHourlyRates({ ...REQUIRED, hourlyExternalWeekendDayRate: bad })), ['hourlyExternalWeekendDayRate'], String(bad));
  });
  [0, '0', '37,50', 10000].forEach((fine) => assert.deepEqual(validateHourlyRates({ ...REQUIRED, hourlyExternalWeekendDayRate: fine }), [], String(fine)));
  assert.deepEqual(validateHourlyRates({ ...REQUIRED, sellableExternally: 0, hourlyExternalWeekendDayRate: '' }), []);
  assert.deepEqual(validateHourlyRates({ ...REQUIRED, hourlyEveningStart: '', hourlyEveningRate: '', hourlyNextEveningRate: '' }), [], 'no evening band, no evening price');
  assert.deepEqual(validateHourlyRates({ priceType: 'per_stay', price: '' }), []);
  assert.deepEqual(fields(validateHourlyRates({ ...REQUIRED, price: '' })), ['price']);
});

test('rule 2 — a stored value sent back unchanged is not judged again', NEEDS_PLUGIN, () => {
  assert.deepEqual(validateHourlyRates({ ...REQUIRED, hourlyExternalWeekendDayRate: 12.345 }, { hourlyExternalWeekendDayRate: 12.345 }), []);
});

const legacyDb = () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, price REAL, priceType TEXT, showsPlanningCard INTEGER, hourlyEveningRate REAL, hourlyExternalDayRate REAL, hourlyExternalEveningRate REAL,
      hourlyNextDayRate REAL, hourlyNextEveningRate REAL, hourlyExternalNextDayRate REAL, hourlyExternalNextEveningRate REAL);
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));`);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Estiva'), (2, 'Granja')").run();
  db.prepare("INSERT INTO resources (id, name, price, priceType, showsPlanningCard, hourlyEveningRate, hourlyExternalDayRate, hourlyExternalEveningRate, hourlyNextDayRate) VALUES (1, 'Bain', 40, 'per_hour', 1, 55, 0, 0, 35)").run();
  db.prepare("INSERT INTO resources (id, name, price, priceType, showsPlanningCard) VALUES (2, 'Plancha', 12, 'per_stay', 0)").run();
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (1, 1, 30, 60), (2, 1, NULL, 60), (1, 2, 9, 0)').run();
  return db;
};

test('rule 4 — the migration makes every price explicit: following hours, outside rates that fell back, weekend = week; a lodging price on the bath is dropped and logged', NEEDS_PLUGIN, (t) => {
  const db = legacyDb();
  const lines = [];
  t.mock.method(console, 'log', (line) => lines.push(String(line)));
  explicitHourlyRates(db);
  const row = db.prepare('SELECT * FROM resources WHERE id = 1').get();
  assert.deepEqual([row.hourlyNextDayRate, row.hourlyNextEveningRate], [35, 55]);
  assert.deepEqual([row.hourlyExternalDayRate, row.hourlyExternalEveningRate], [40, 55], 'the guests\' rates the outside fields fell back to');
  assert.deepEqual([row.hourlyExternalNextDayRate, row.hourlyExternalNextEveningRate], [40, 55]);
  assert.deepEqual(
    [row.hourlyExternalWeekendDayRate, row.hourlyExternalWeekendEveningRate, row.hourlyExternalWeekendNextDayRate, row.hourlyExternalWeekendNextEveningRate],
    [40, 55, 40, 55],
  );
  const prices = db.prepare('SELECT propertyId, price, freeMinutes FROM property_resource_prices ORDER BY propertyId, resourceId').all();
  assert.deepEqual(prices, [{ propertyId: 1, price: null, freeMinutes: 60 }, { propertyId: 1, price: 9, freeMinutes: 0 }, { propertyId: 2, price: null, freeMinutes: 60 }].sort((a, b) => a.propertyId - b.propertyId));
  assert.ok(lines.some((line) => line.includes('Estiva') && line.includes('30') && line.includes('Bain')), 'the log names the lodging and the price dropped');
  assert.equal(lines.filter((line) => line.includes('is dropped')).length, 1, 'nothing logged for a lodging with no price of its own');
  const plancha = db.prepare('SELECT * FROM resources WHERE id = 2').get();
  assert.equal(plancha.hourlyExternalWeekendDayRate, null, 'a resource that is not sold by the hour is left alone');
});

test('rule 9 — the card of the resource shows the week and the weekend outside grids, without a fallback', NEEDS_PLUGIN, () => {
  const line = buildCatalogueLines(BATH).lines.find((l) => l.label === 'Extérieurs');
  assert.match(line.value, /semaine 50 € \/ h puis 45 € \/ h · soir 70 € \/ h puis 65 € \/ h · week-end 70 € \/ h puis 60 € \/ h · soir 90 € \/ h puis 80 € \/ h/);
  assert.equal(buildCatalogueLines({ ...BATH, hourlyExternalDayRate: 0, hourlyExternalEveningRate: 0, hourlyExternalWeekendDayRate: 0, hourlyExternalWeekendEveningRate: 0 }).lines.find((l) => l.label === 'Extérieurs'), undefined);
});
