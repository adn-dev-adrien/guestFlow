const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { grossFromNet } = require('../utils/pricing');
const { create: createPlatformsModel } = require('../models/platformsModel');
const { buildModel: buildPropertiesModel } = require('../models/propertiesModel');

// specs/platform-price-from-commission.md — gross-up of a season net price by a platform commission %.

// ── grossFromNet (pure) ──────────────────────────────────────────────────────

test('grossFromNet: gross = net / (1 − c/100), rounded to cents', () => {
  assert.equal(grossFromNet(100, 20), 125);          // 100 / 0.8
  assert.equal(grossFromNet(100, 15), 117.65);       // 100 / 0.85 = 117.647 → 117.65
  assert.equal(grossFromNet(80, 0), 80);             // no commission
  assert.equal(grossFromNet(80), 80);                // undefined %
  assert.equal(grossFromNet(80, -5), 80);            // negative clamped → net
  assert.equal(grossFromNet(100, 100), null);        // ≥100 → invalid
  assert.equal(grossFromNet(100, 150), null);
});

// ── platformsModel commissionPercent ─────────────────────────────────────────

function platformsDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
    commissionAccountNumber TEXT, hasVatOnCommission INTEGER NOT NULL DEFAULT 0,
    commissionPercent REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, platformLabel TEXT);
  CREATE TABLE reservations (id INTEGER PRIMARY KEY, platform TEXT);`);
  db.prepare("INSERT INTO platforms (name) VALUES ('direct'), ('Airbnb'), ('Booking')").run();
  return db;
}

test('setCommissionPercent clamps to [0, 99.99] and listWithCommission excludes direct', () => {
  const db = platformsDb();
  const m = createPlatformsModel(db);
  const airbnb = db.prepare("SELECT id FROM platforms WHERE name = 'Airbnb'").get().id;
  const direct = db.prepare("SELECT id FROM platforms WHERE name = 'direct'").get().id;

  m.setCommissionPercent(airbnb, 15);
  assert.equal(db.prepare('SELECT commissionPercent FROM platforms WHERE id = ?').get(airbnb).commissionPercent, 15);
  m.setCommissionPercent(airbnb, 250);
  assert.equal(db.prepare('SELECT commissionPercent FROM platforms WHERE id = ?').get(airbnb).commissionPercent, 99.99);
  m.setCommissionPercent(airbnb, -3);
  assert.equal(db.prepare('SELECT commissionPercent FROM platforms WHERE id = ?').get(airbnb).commissionPercent, 0);

  assert.equal(m.setCommissionPercent(direct, 10), null, 'direct is never editable');

  const list = m.listWithCommission();
  assert.deepEqual(list.map((p) => p.name).sort(), ['Airbnb', 'Booking']);
  assert.ok(!list.some((p) => p.name === 'direct'));
});

// ── propertiesModel.platformPrices grid ──────────────────────────────────────

test('platformPrices: seasons × non-direct platforms grid with grossed-up prices', () => {
  const db = platformsDb();
  db.exec(`CREATE TABLE pricing_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER NOT NULL, label TEXT,
    pricePerNight REAL NOT NULL DEFAULT 0, startDate TEXT
  );`);
  db.prepare("UPDATE platforms SET commissionPercent = 20 WHERE name = 'Airbnb'").run();
  db.prepare("UPDATE platforms SET commissionPercent = 0 WHERE name = 'Booking'").run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, startDate) VALUES (1, 'Basse', 100, '2026-01-01'), (1, 'Haute', 200, '2026-07-01')").run();

  const out = buildPropertiesModel(db).platformPrices(1);
  assert.deepEqual(out.platforms.map((p) => p.name).sort(), ['Airbnb', 'Booking']);
  const airbnb = out.platforms.find((p) => p.name === 'Airbnb');
  const booking = out.platforms.find((p) => p.name === 'Booking');

  const basse = out.seasons.find((s) => s.label === 'Basse');
  assert.equal(basse.netPerNight, 100);
  assert.equal(basse.byPlatform[airbnb.id], 125);   // 100 / 0.8
  assert.equal(basse.byPlatform[booking.id], 100);  // 0% → net

  const haute = out.seasons.find((s) => s.label === 'Haute');
  assert.equal(haute.byPlatform[airbnb.id], 250);   // 200 / 0.8
});

test('platformPrices: empty seasons → empty grid (platforms still listed)', () => {
  const db = platformsDb();
  db.exec(`CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, label TEXT, pricePerNight REAL, startDate TEXT);`);
  const out = buildPropertiesModel(db).platformPrices(1);
  assert.equal(out.seasons.length, 0);
  assert.equal(out.platforms.length, 2);
});
