// specs/pricing-components.md §3 rules 48 and 50 — SettingsProvider: resolution article → property → global → default,
// each moved unit's `settingsSchema` validates, and the PR A adapter returns exactly today's column values.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const settingsProvider = require('../models/ports/settingsProvider');
const nights = require('../utils/pricing/nights');
const extraGuests = require('../utils/pricing/extraGuests');
const touristTax = require('../utils/pricing/touristTax');
const stayClock = require('../utils/pricing/stayClock');

function seeded() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT, defaultCheckIn TEXT, defaultCheckOut TEXT,
      touristTaxMode TEXT, touristTaxPerDayPerPerson REAL, touristTaxPercentage REAL, touristTaxDepartmentPercentage REAL,
      touristTaxFixedAmount REAL, basePriceIncludedGuests INTEGER, extraGuestPrice REAL, extraGuestPriceUnit TEXT, extraGuestTiers TEXT
    );
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, startDate TEXT, endDate TEXT, pricePerNight REAL);
    CREATE TABLE platforms (name TEXT, collectsTouristTax INTEGER, touristTaxRemittedByPlatform INTEGER);
  `);
  db.prepare(`INSERT INTO properties VALUES (1, 'A', '16:00', '11:00', 'percentage_and_fixed', 1.5, 5, 10, 0.4, 2, 12.5, 'per_night', '[{"from":3,"price":9}]')`).run();
  db.prepare(`INSERT INTO properties (id, name) VALUES (2, 'B')`).run();
  db.prepare("INSERT INTO pricing_rules VALUES (11, 1, '2027-07-01', '2027-07-31', 140)").run(); // date-literal-ok: seeded tariff row, nothing compares with today
  db.prepare("INSERT INTO pricing_rules VALUES (10, 1, '2027-01-01', '2027-06-30', 90)").run(); // date-literal-ok: seeded tariff row, nothing compares with today
  db.prepare("INSERT INTO platforms VALUES ('Booking.com', 1, 0)").run();
  return db;
}

test('rule 50 — the adapter returns today\'s property columns, key by key', () => {
  const provider = settingsProvider.create(seeded());
  assert.deepEqual(provider.for('touristTax', { propertyId: 1 }), {
    mode: 'percentage_and_fixed', perPersonNight: 1.5, percentage: 5, departmentPercentage: 10, fixedAmount: 0.4,
    cap: null, exemptions: [], collector: null,
  });
  assert.deepEqual(provider.for('extraGuests', { propertyId: 1 }), {
    includedGuests: 2, extraGuestPrice: 12.5, extraGuestPriceUnit: 'per_night', tiers: [{ from: 3, price: 9 }],
  });
  assert.deepEqual(provider.for('stayClock', { propertyId: 1 }), { defaultCheckIn: '16:00', defaultCheckOut: '11:00' });
});

test('rule 50 — nights: the tariff is the property\'s pricing_rules, in the engine\'s order', () => {
  const { tariff } = settingsProvider.create(seeded()).for('nights', { propertyId: 1 });
  assert.deepEqual(tariff.rules.map((rule) => rule.id), [10, 11]);
  assert.deepEqual(settingsProvider.create(seeded()).for('nights', { propertyId: 2 }).tariff, { rules: [] });
});

test('rule 50 — a NULL column answers the schema default, an unknown property answers every default', () => {
  const provider = settingsProvider.create(seeded());
  assert.deepEqual(provider.for('stayClock', { propertyId: 2 }), { defaultCheckIn: '15:00', defaultCheckOut: '10:00' });
  assert.deepEqual(provider.for('stayClock', { propertyId: 404 }), { defaultCheckIn: '15:00', defaultCheckOut: '10:00' });
  assert.deepEqual(provider.for('stayClock'), { defaultCheckIn: '15:00', defaultCheckOut: '10:00' });
  assert.equal(provider.for('extraGuests', { propertyId: 2 }).extraGuestPriceUnit, 'per_stay');
});

test('rule 50 — the tourist-tax collector is read per platform from the platform rows', () => {
  const provider = settingsProvider.create(seeded());
  assert.deepEqual(provider.for('touristTax', { propertyId: 1, platform: 'Booking.com' }).collector, { chargedByPlatform: true, remittedByOwner: true });
  assert.deepEqual(provider.for('touristTax', { propertyId: 1, platform: 'direct' }).collector, { chargedByPlatform: false, remittedByOwner: true });
});

test('rule 50 — resolution order: article, then property, then global, then the default', () => {
  const schema = [{ key: 'rate', type: 'number', default: 1, scope: 'global', validate: () => null }, { key: 'grid', type: 'string', default: 'd', scope: 'property', validate: () => null }];
  const layers = { global: { rate: 2, grid: 'g' }, property: { rate: 3 }, article: { rate: 4 } };
  const make = (present) => settingsProvider.create(seeded(), {
    extra: { probe: { settingsSchema: schema, read: Object.fromEntries(present.map((layer) => [layer, () => layers[layer]])) } },
  }).for('probe', {});
  assert.deepEqual(make(['article', 'property', 'global']), { rate: 4, grid: 'd' });
  assert.deepEqual(make(['property', 'global']), { rate: 3, grid: 'd' });
  assert.deepEqual(make(['global']), { rate: 2, grid: 'd' });
  assert.deepEqual(make([]), { rate: 1, grid: 'd' });
});

test('rule 50 — a key declared at property scope ignores the global layer; an article layer may override it', () => {
  const schema = [{ key: 'grid', type: 'string', default: 'd', scope: 'property', validate: () => null }];
  const make = (read) => settingsProvider.create(seeded(), { extra: { probe: { settingsSchema: schema, read } } }).for('probe', {});
  assert.equal(make({ global: () => ({ grid: 'g' }) }).grid, 'd');
  assert.equal(make({ global: () => ({ grid: 'g' }), article: () => ({ grid: 'a' }) }).grid, 'a');
});

test('rule 50 — an unknown component is refused', () => {
  assert.throws(() => settingsProvider.create(seeded()).for('nope', {}), /SETTINGS_UNKNOWN_COMPONENT/);
});

test('rule 50 — every moved unit exports a schema whose defaults validate and whose bad values are refused', () => {
  const units = { nights, extraGuests, touristTax, stayClock };
  const bad = { tariff: 'x', includedGuests: -1, extraGuestPrice: 'abc', extraGuestPriceUnit: 'per_week', tiers: 'x', mode: 'free', perPersonNight: -2, percentage: 'x', departmentPercentage: -1, fixedAmount: 'x', cap: -3, exemptions: 'x', collector: { chargedByPlatform: 1 }, defaultCheckIn: '9h', defaultCheckOut: '25:00' };
  for (const [id, unit] of Object.entries(units)) {
    assert.ok(Array.isArray(unit.settingsSchema) && unit.settingsSchema.length > 0, id);
    for (const entry of unit.settingsSchema) {
      assert.deepEqual(Object.keys(entry).sort(), ['default', 'key', 'scope', 'type', 'validate'], `${id}.${entry.key}`);
      assert.ok(['global', 'property', 'article'].includes(entry.scope), `${id}.${entry.key}`);
      assert.equal(entry.validate(entry.default), null, `${id}.${entry.key} default`);
      assert.equal(typeof entry.validate(bad[entry.key]), 'string', `${id}.${entry.key} refuses ${JSON.stringify(bad[entry.key])}`);
    }
  }
});

test('rule 50 — validate(componentId, values) lists the keys a component refuses', () => {
  const provider = settingsProvider.create(seeded());
  assert.deepEqual(provider.validate('stayClock', { defaultCheckIn: '15:00', defaultCheckOut: '10:00' }), []);
  assert.deepEqual(provider.validate('stayClock', { defaultCheckIn: '15h', defaultCheckOut: '10:00' }).map((r) => r.key), ['defaultCheckIn']);
  assert.deepEqual(provider.validate('touristTax', provider.for('touristTax', { propertyId: 1 })), []);
});

test('rule 50 — the schema of every unit is what the provider resolves', () => {
  const provider = settingsProvider.create(seeded());
  for (const id of Object.keys(settingsProvider.SCHEMAS)) {
    assert.deepEqual(Object.keys(provider.for(id, { propertyId: 1 })), provider.schemaOf(id).map((entry) => entry.key));
  }
});
