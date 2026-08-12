const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const propertiesModel = require('../models/propertiesModel');

// specs/tariff-recipes/spec.md §3.4 rules 25bis-25ter — the closed days are hidden from the SEASON
// DISPLAY only. The stored ranges keep their full span, so moving a closure re-reveals them; and the
// seasons come back ordered by the earliest date they actually cover.

const { subtractClosuresFromRanges } = propertiesModel.__test;

const r = (startDate, endDate, extra = {}) => ({ startDate, endDate, ...extra });

test('subtractClosuresFromRanges: trims, splits, drops — and keeps per-range overrides', () => {
  const closures = [r('2026-10-15', '2027-03-31')];
  // Straddles the start of the closure → trimmed at its eve.
  assert.deepEqual(
    subtractClosuresFromRanges([r('2026-08-29', '2026-12-31')], closures),
    [r('2026-08-29', '2026-10-14')],
  );
  // Straddles the end → trimmed at the day after.
  assert.deepEqual(
    subtractClosuresFromRanges([r('2027-01-01', '2027-05-05')], closures),
    [r('2027-04-01', '2027-05-05')],
  );
  // Fully inside → disappears.
  assert.deepEqual(subtractClosuresFromRanges([r('2026-12-01', '2026-12-20')], closures), []);
  // Contains the whole closure → split in two, both pieces keeping the override.
  assert.deepEqual(
    subtractClosuresFromRanges([r('2026-09-01', '2027-06-01', { minNights: 3 })], closures),
    [r('2026-09-01', '2026-10-14', { minNights: 3 }), r('2027-04-01', '2027-06-01', { minNights: 3 })],
  );
  // No closure at all → untouched.
  assert.deepEqual(subtractClosuresFromRanges([r('2026-05-01', '2026-05-10')], []), [r('2026-05-01', '2026-05-10')]);
});

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, label TEXT, pricePerNight REAL,
      pricingMode TEXT, progressiveTiers TEXT, dateRanges TEXT, color TEXT, startDate TEXT, endDate TEXT,
      minNights INTEGER, seasonKey TEXT, seasonRank INTEGER, netTargetPerNight REAL, extraGuestPrice REAL,
      extraGuestNetTarget REAL, maxNights INTEGER, changeoverArrival INTEGER, changeoverDeparture INTEGER);
    CREATE TABLE establishment_closures (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER,
      label TEXT NOT NULL DEFAULT '', startDate TEXT NOT NULL, endDate TEXT NOT NULL);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, type TEXT, name TEXT, filePath TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, name TEXT, url TEXT,
      platformKey TEXT, platformLabel TEXT, platformColor TEXT, isActive INTEGER,
      collectsTouristTax INTEGER NOT NULL DEFAULT 1, touristTaxRemittedByPlatform INTEGER NOT NULL DEFAULT 1,
      lastSyncAt TEXT, lastSyncStatus TEXT, lastSyncMessage TEXT, lastImportedCount INTEGER, createdAt TEXT, updatedAt TEXT);
  `);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Lodge')").run();
  return db;
}

test('getByIdWithDetails: seasons ordered by their earliest date, closed days hidden, data intact', () => {
  const db = createDb();
  const model = propertiesModel.buildModel(db);
  // Inserted deliberately OUT of date order to prove the sort.
  db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, startDate, minNights)
    VALUES (1, 'Haute', 247, '[{"startDate":"2026-07-11","endDate":"2026-08-21"}]', '2026-07-11', 1)`).run();
  db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, startDate, minNights)
    VALUES (1, 'Basse', 179, '[{"startDate":"2026-01-01","endDate":"2026-07-03"},{"startDate":"2026-08-29","endDate":"2026-12-31"}]', '2026-01-01', 1)`).run();
  db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (1, 'Fermeture hivernale', '2025-10-15', '2026-03-31')").run();
  db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (1, 'Fermeture hivernale', '2026-10-15', '2027-03-31')").run();

  const detail = model.getByIdWithDetails(1);
  assert.deepEqual(detail.pricingRules.map((r2) => r2.label), ['Basse', 'Haute']);

  const basse = detail.pricingRules.find((r2) => r2.label === 'Basse');
  // Stored ranges untouched — the closure only hides.
  assert.deepEqual(basse.dateRanges, [
    { startDate: '2026-01-01', endDate: '2026-07-03' },
    { startDate: '2026-08-29', endDate: '2026-12-31' },
  ]);
  // Displayed ranges: winter head and tail trimmed off.
  assert.deepEqual(basse.dateRangesVisible, [
    { startDate: '2026-04-01', endDate: '2026-07-03' },
    { startDate: '2026-08-29', endDate: '2026-10-14' },
  ]);
  // The closures themselves travel with the payload so the calendar can grey them.
  assert.equal(detail.closureRanges.length, 2);
  db.close();
});

test('a global closure (propertyId NULL) hides days on every property', () => {
  const db = createDb();
  const model = propertiesModel.buildModel(db);
  db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, startDate, minNights)
    VALUES (1, 'Annuel', 100, '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]', '2026-01-01', 1)`).run();
  db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (NULL, 'Congés', '2026-06-01', '2026-06-15')").run();

  const rule = model.getByIdWithDetails(1).pricingRules[0];
  assert.deepEqual(rule.dateRangesVisible, [
    { startDate: '2026-01-01', endDate: '2026-05-31' },
    { startDate: '2026-06-16', endDate: '2026-12-31' },
  ]);
  db.close();
});

test('a season entirely inside a closure keeps its data but shows no visible range', () => {
  const db = createDb();
  const model = propertiesModel.buildModel(db);
  db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, startDate, minNights)
    VALUES (1, 'Hiver', 100, '[{"startDate":"2026-12-01","endDate":"2026-12-20"}]', '2026-12-01', 1)`).run();
  db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (1, 'Fermeture', '2026-10-15', '2027-03-31')").run();

  const rule = model.getByIdWithDetails(1).pricingRules[0];
  assert.equal(rule.dateRanges.length, 1);
  assert.deepEqual(rule.dateRangesVisible, []);
  db.close();
});
