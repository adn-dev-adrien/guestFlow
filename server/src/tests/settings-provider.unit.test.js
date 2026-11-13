// specs/pricing-components.md §3 rules 48 and 50 — SettingsProvider: resolution article → property → global → default,
// a key's scope is the NARROWEST layer allowed to set it, NULL is a value, each moved unit's `settingsSchema` validates,
// and the PR A adapter returns exactly the values the engine read from the property row.
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

test('rule 50 — a NULL column answers NULL, an unknown property answers every default', () => {
  const provider = settingsProvider.create(seeded());
  assert.deepEqual(provider.for('stayClock', { propertyId: 2 }), { defaultCheckIn: null, defaultCheckOut: null });
  assert.deepEqual(provider.for('stayClock', { propertyId: 404 }), { defaultCheckIn: '15:00', defaultCheckOut: '10:00' });
  assert.deepEqual(provider.for('stayClock'), { defaultCheckIn: '15:00', defaultCheckOut: '10:00' });
  assert.equal(provider.for('extraGuests', { propertyId: 2 }).extraGuestPriceUnit, null);
  assert.equal(provider.for('extraGuests', { propertyId: 404 }).extraGuestPriceUnit, 'per_stay');
});

test('rule 50 — the tourist-tax collector is read per platform from the platform rows', () => {
  const provider = settingsProvider.create(seeded());
  assert.deepEqual(provider.for('touristTax', { propertyId: 1, platform: 'Booking.com' }).collector, { chargedByPlatform: true, remittedByOwner: true });
  assert.deepEqual(provider.for('touristTax', { propertyId: 1, platform: 'direct' }).collector, { chargedByPlatform: false, remittedByOwner: true });
});

test('rule 50 — resolution order: article, then property, then global, then the default', () => {
  const schema = [{ key: 'rate', type: 'number', default: 1, scope: 'article', validate: () => null }, { key: 'grid', type: 'string', default: 'd', scope: 'property', validate: () => null }];
  const layers = { global: { rate: 2, grid: 'g' }, property: { rate: 3 }, article: { rate: 4, grid: 'a' } };
  const make = (present) => settingsProvider.create(seeded(), {
    extra: { probe: { settingsSchema: schema, read: Object.fromEntries(present.map((layer) => [layer, () => layers[layer]])) } },
  }).for('probe', {});
  assert.deepEqual(make(['article', 'property', 'global']), { rate: 4, grid: 'g' });
  assert.deepEqual(make(['property', 'global']), { rate: 3, grid: 'g' });
  assert.deepEqual(make(['global']), { rate: 2, grid: 'g' });
  assert.deepEqual(make([]), { rate: 1, grid: 'd' });
});

test('rule 50 — a key declared at property scope is answered by the global layer when the property says nothing; an article layer is ignored', () => {
  const schema = [{ key: 'grid', type: 'string', default: 'd', scope: 'property', validate: () => null }];
  const make = (read) => settingsProvider.create(seeded(), { extra: { probe: { settingsSchema: schema, read } } }).for('probe', {});
  assert.equal(make({ global: () => ({ grid: 'g' }) }).grid, 'g');
  assert.equal(make({ global: () => ({ grid: 'g' }), property: () => ({ grid: 'p' }) }).grid, 'p');
  assert.equal(make({ global: () => ({ grid: 'g' }), article: () => ({ grid: 'a' }) }).grid, 'g');
  assert.equal(make({ article: () => ({ grid: 'a' }) }).grid, 'd');
});

test('rule 50 — a key declared at global scope is answered by the global layer only', () => {
  const schema = [{ key: 'rate', type: 'number', default: 1, scope: 'global', validate: () => null }];
  const make = (read) => settingsProvider.create(seeded(), { extra: { probe: { settingsSchema: schema, read } } }).for('probe', {});
  assert.equal(make({ global: () => ({ rate: 2 }), property: () => ({ rate: 3 }) }).rate, 2);
  assert.equal(make({ property: () => ({ rate: 3 }) }).rate, 1);
});

test('rule 50 — null is a value: a layer that answers null wins over the layers behind it and over the default', () => {
  const schema = [{ key: 'rate', type: 'number', default: 1, scope: 'article', validate: () => null }];
  const make = (read) => settingsProvider.create(seeded(), { extra: { probe: { settingsSchema: schema, read } } }).for('probe', {});
  assert.equal(make({ global: () => ({ rate: 2 }), property: () => ({ rate: null }) }).rate, null);
  assert.equal(make({ property: () => ({ rate: null }) }).rate, null);
  assert.equal(make({ global: () => ({ rate: 2 }), property: () => ({}) }).rate, 2);
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

test('rule 50 — for("vat") resolves the eight rate keys at null (the regime\'s rate); the regime is not one of them', () => {
  const values = settingsProvider.create(seeded()).for('vat', { propertyId: 1 });
  assert.equal(Object.keys(values).length, 8);
  assert.ok(Object.values(values).every((value) => value === null));
  assert.equal('regime' in values, false);
});

test('rule 50 — for("platformPrice") answers the platform\'s commissionPercent, raw, from the global layer', () => {
  const db = seeded();
  db.exec('ALTER TABLE platforms ADD COLUMN commissionPercent REAL');
  db.prepare("UPDATE platforms SET commissionPercent = 17.5 WHERE name = 'Booking.com'").run();
  db.prepare("INSERT INTO platforms (name) VALUES ('Airbnb')").run();
  const provider = settingsProvider.create(db);
  assert.deepEqual(provider.for('platformPrice', { platform: 'Booking.com' }), { commissionRate: 17.5 });
  assert.deepEqual(provider.for('platformPrice', { platform: 'Airbnb' }), { commissionRate: null });
  assert.deepEqual(provider.for('platformPrice', { platform: 'Unknown' }), { commissionRate: 0 });
  assert.deepEqual(provider.for('platformPrice', {}), { commissionRate: 0 });
  assert.deepEqual(settingsProvider.create(seeded()).for('platformPrice', { platform: 'Booking.com' }), { commissionRate: 0 });
});

test('rule 50 — for("articles"): the article layer overrides the global catalogue price, else the catalogue price answers', () => {
  const db = seeded();
  db.exec(`
    CREATE TABLE options (id INTEGER PRIMARY KEY, price REAL);
    CREATE TABLE resources (id INTEGER PRIMARY KEY, price REAL);
    CREATE TABLE property_option_prices (optionId INTEGER, propertyId INTEGER, price REAL, freeUnits INTEGER);
    CREATE TABLE property_resource_prices (resourceId INTEGER, propertyId INTEGER, price REAL, freeMinutes INTEGER);
    ALTER TABLE properties ADD COLUMN maxGuests INTEGER;
  `);
  db.exec(`
    INSERT INTO options VALUES (1, 12), (2, 30);
    INSERT INTO resources VALUES (5, 40), (6, 50);
    INSERT INTO property_option_prices VALUES (1, 1, 9, 2), (2, 1, NULL, NULL);
    INSERT INTO property_resource_prices VALUES (5, 1, 35, 30), (6, 1, NULL, NULL);
    UPDATE properties SET maxGuests = 6 WHERE id = 1;
  `);
  const provider = settingsProvider.create(db);
  const forOption = (id, propertyId) => provider.for('articles', { propertyId, articleRef: { kind: 'option', id } });
  const forResource = (id, propertyId) => provider.for('articles', { propertyId, articleRef: { kind: 'resource', id } });
  assert.deepEqual(forOption(1, 1), { price: 9, freeUnits: 2, freeMinutes: 0, maxGuests: 6 });
  assert.deepEqual(forOption(1, 2), { price: 12, freeUnits: 0, freeMinutes: 0, maxGuests: null });
  assert.equal(forOption(2, 1).price, null, 'an override row with a NULL price is a value, as the catalogue read it');
  assert.equal(forResource(5, 1).price, 35);
  assert.equal(forResource(5, 1).freeMinutes, 30);
  assert.equal(forResource(6, 1).price, 50, 'a NULL resource override column is no override');
  assert.equal(forResource(6, 1).freeMinutes, 0);
  assert.equal(forResource(5, 2).price, 40);
});

test('rule 50 — parity: a property row with every column NULL, or a schema without the column, gives the engine\'s own reading', () => {
  // The coercions below are the ones the steps apply to the row (steps/schedule.js, extraGuests.js, touristTax.js,
  // nights.js): the provider hands the value over unchanged, so a coercion of the provider's value equals a coercion of the row's.
  const engine = {
    depositPercent: (v) => Number(v || 0),
    depositEnabled: (v) => !(v !== undefined && v !== null && Number(v) !== 1),
    includedGuests: (v) => Math.max(0, Number(v || 0)),
    extraGuestPrice: (v) => Math.max(0, Number(v || 0)),
    extraGuestPriceUnit: (v) => v === 'per_night',
    mode: (v) => String(v || 'per_day_per_person'),
    perPersonNight: (v) => Number(v || 0),
    percentage: (v) => Number(v || 0),
    departmentPercentage: (v) => Number(v || 0),
    fixedAmount: (v) => Number(v || 0),
    defaultCheckIn: (v) => v || '15:00',
    defaultCheckOut: (v) => v || '10:00',
  };
  const columns = {
    depositPercent: ['schedule', 'depositPercent'], depositEnabled: ['schedule', 'depositEnabled'],
    includedGuests: ['extraGuests', 'basePriceIncludedGuests'], extraGuestPrice: ['extraGuests', 'extraGuestPrice'],
    extraGuestPriceUnit: ['extraGuests', 'extraGuestPriceUnit'], mode: ['touristTax', 'touristTaxMode'],
    perPersonNight: ['touristTax', 'touristTaxPerDayPerPerson'], percentage: ['touristTax', 'touristTaxPercentage'],
    departmentPercentage: ['touristTax', 'touristTaxDepartmentPercentage'], fixedAmount: ['touristTax', 'touristTaxFixedAmount'],
    defaultCheckIn: ['stayClock', 'defaultCheckIn'], defaultCheckOut: ['stayClock', 'defaultCheckOut'],
  };
  const names = [...new Set(Object.values(columns).map(([, column]) => column))];
  const nullDb = new Database(':memory:');
  nullDb.exec(`CREATE TABLE properties (id INTEGER PRIMARY KEY, ${names.map((name) => `${name} ${name.includes('Mode') || name.includes('Unit') || name.includes('Check') ? 'TEXT' : 'REAL'}`).join(', ')})`);
  nullDb.prepare('INSERT INTO properties (id) VALUES (1)').run();
  const bareDb = new Database(':memory:');
  bareDb.exec('CREATE TABLE properties (id INTEGER PRIMARY KEY)');
  bareDb.prepare('INSERT INTO properties (id) VALUES (1)').run();
  for (const [key, [component, column]] of Object.entries(columns)) {
    const fromNullRow = settingsProvider.create(nullDb).for(component, { propertyId: 1 })[key];
    assert.equal(engine[key](fromNullRow), engine[key](nullDb.prepare('SELECT * FROM properties WHERE id = 1').get()[column]), `${key} on a NULL column`);
    const fromBareRow = settingsProvider.create(bareDb).for(component, { propertyId: 1 })[key];
    assert.equal(engine[key](fromBareRow), engine[key](bareDb.prepare('SELECT * FROM properties WHERE id = 1').get()[column]), `${key} on an absent column`);
  }
});
