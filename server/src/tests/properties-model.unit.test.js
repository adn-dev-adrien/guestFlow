const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const propertiesModel = require('../models/propertiesModel');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE pricing_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, label TEXT, pricePerNight REAL,
    pricingMode TEXT, progressiveTiers TEXT, dateRanges TEXT, color TEXT, startDate TEXT, endDate TEXT, minNights INTEGER
  );
  CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, type TEXT, name TEXT, filePath TEXT);
  CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE ical_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, name TEXT, url TEXT, platformKey TEXT,
    platformLabel TEXT, platformColor TEXT, isActive INTEGER,
    collectsTouristTax INTEGER NOT NULL DEFAULT 1,
    lastSyncAt TEXT, lastSyncStatus TEXT,
    lastSyncMessage TEXT, lastImportedCount INTEGER, createdAt TEXT, updatedAt TEXT
  );
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite'), (2, 'Tente')").run();
  return { db, model: propertiesModel.buildModel(db) };
}

const range = (startDate, endDate) => [{ startDate, endDate }];

test('addPricingRule inserts a rule and rejects an overlapping one (400)', () => {
  const { model } = freshModel();
  const first = model.addPricingRule(1, { label: 'Été', pricePerNight: 120, dateRanges: range('2026-07-01', '2026-07-31') });
  assert.ok(first.data.id);

  const overlap = model.addPricingRule(1, { label: 'Haute', pricePerNight: 150, dateRanges: range('2026-07-15', '2026-08-15') });
  assert.equal(overlap.status, 400);
  assert.ok(overlap.conflictingRule);
  assert.equal(overlap.conflictingRule.label, 'Été');
});

test('addPricingRule allows a non-overlapping range', () => {
  const { model } = freshModel();
  model.addPricingRule(1, { label: 'Été', pricePerNight: 120, dateRanges: range('2026-07-01', '2026-07-31') });
  const ok = model.addPricingRule(1, { label: 'Automne', pricePerNight: 90, dateRanges: range('2026-09-01', '2026-09-30') });
  assert.ok(ok.data.id);
});

test('applyPricingTo copies seasons to an empty target', () => {
  const { db, model } = freshModel();
  model.addPricingRule(1, { label: 'Été', pricePerNight: 120, dateRanges: range('2026-07-01', '2026-07-31') });
  const result = model.applyPricingTo(1, { targetPropertyId: 2 });
  assert.equal(result.data.copiedRules, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM pricing_rules WHERE propertyId = 2').get().c, 1);
});

test('applyPricingTo returns 409 PRICING_OVERLAP when target conflicts (no replace)', () => {
  const { model } = freshModel();
  model.addPricingRule(1, { label: 'Été', pricePerNight: 120, dateRanges: range('2026-07-01', '2026-07-31') });
  model.addPricingRule(2, { label: 'Cible', pricePerNight: 100, dateRanges: range('2026-07-10', '2026-07-20') });
  const result = model.applyPricingTo(1, { targetPropertyId: 2 });
  assert.equal(result.status, 409);
  assert.equal(result.code, 'PRICING_OVERLAP');
});

test('applyPricingTo with replaceExisting wipes + copies', () => {
  const { db, model } = freshModel();
  model.addPricingRule(1, { label: 'Été', pricePerNight: 120, dateRanges: range('2026-07-01', '2026-07-31') });
  model.addPricingRule(2, { label: 'Cible', pricePerNight: 100, dateRanges: range('2026-07-10', '2026-07-20') });
  const result = model.applyPricingTo(1, { targetPropertyId: 2, replaceExisting: true });
  assert.equal(result.data.copiedRules, 1);
  const targetRules = db.prepare('SELECT label FROM pricing_rules WHERE propertyId = 2').all();
  assert.equal(targetRules.length, 1);
  assert.equal(targetRules[0].label, 'Été');
});

test('applyPricingTo validates source/target', () => {
  const { model } = freshModel();
  assert.equal(model.applyPricingTo(1, {}).status, 400); // no target
  assert.equal(model.applyPricingTo(1, { targetPropertyId: 1 }).status, 400); // same
  assert.equal(model.applyPricingTo(1, { targetPropertyId: 99 }).status, 404); // unknown target
});

test('getByIdWithDetails returns enriched payload; setOptions links options', () => {
  const { db, model } = freshModel();
  model.addPricingRule(1, { label: 'Été', pricePerNight: 120, dateRanges: range('2026-07-01', '2026-07-31') });
  db.prepare("INSERT INTO documents (propertyId, type, name, filePath) VALUES (1, 'other', 'Guide', '/uploads/g.pdf')").run();
  model.setOptions(1, [7, 9]);

  const detail = model.getByIdWithDetails(1);
  assert.equal(detail.id, 1);
  assert.equal(detail.pricingRules.length, 1);
  assert.ok(Array.isArray(detail.pricingRules[0].dateRanges));
  assert.equal(detail.documents.length, 1);
  assert.deepEqual(detail.optionIds.sort(), [7, 9]);
  assert.deepEqual(detail.icalSources, []);
  assert.equal(model.getByIdWithDetails(999), null);
});

test('getByIdWithDetails exposes collectsTouristTax on each iCal source', () => {
  const { db, model } = freshModel();
  db.prepare(`
    INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, isActive, collectsTouristTax)
    VALUES
      (1, 'Airbnb', 'http://example.test/a.ics', 'airbnb', 'Airbnb', 1, 1),
      (1, 'Gîtes de France', 'http://example.test/g.ics', 'gitedefrance', 'Gîtes de France', 1, 0)
  `).run();

  const detail = model.getByIdWithDetails(1);
  assert.equal(detail.icalSources.length, 2);
  const byKey = Object.fromEntries(detail.icalSources.map((s) => [s.platformKey, s]));
  assert.equal(byKey.airbnb.collectsTouristTax, 1);
  assert.equal(byKey.gitedefrance.collectsTouristTax, 0);
});
