const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { grossFromNet } = require('../utils/pricing');
const { create: createPlatformsModel } = require('../models/platformsModel');
const { buildModel: buildPropertiesModel } = require('../models/propertiesModel');

// specs/platform-price-from-commission.md — gross-up of a season net price by a platform commission %,
// widened by specs/tariff-recipes/spec.md §3.6 rules 31-34: whole-euro ceiling (a price to DISPLAY,
// not to bill), a direct row whose price covers the welcome pack after the booking-engine fee, and a
// per-channel extra-guest column.

// ── grossFromNet (pure) ──────────────────────────────────────────────────────

test('grossFromNet: euro_up default — gross = ceil((net + fixedCost) / (1 − c/100))', () => {
  assert.equal(grossFromNet(100, 20), 125);          // exact → ceil no-op
  assert.equal(grossFromNet(100, 15), 118);          // 117.647 → 118
  assert.equal(grossFromNet(80, 0), 80);             // no commission
  assert.equal(grossFromNet(80), 80);                // undefined %
  assert.equal(grossFromNet(80, -5), 80);            // negative clamped → net
  assert.equal(grossFromNet(100, 100), null);        // ≥100 → invalid
  assert.equal(grossFromNet(100, 150), null);
});

test('grossFromNet: cents mode keeps the historic 2-decimal rounding', () => {
  assert.equal(grossFromNet(100, 15, { rounding: 'cents' }), 117.65);
  assert.equal(grossFromNet(100, 20, { rounding: 'cents' }), 125);
});

test('grossFromNet: fixedCost covers the welcome pack after the fee — direct 179/216/247', () => {
  assert.equal(grossFromNet(160, 5, { fixedCost: 9.32 }), 179); // 169.32/0.95 = 178.23
  assert.equal(grossFromNet(195, 5, { fixedCost: 9.32 }), 216); // 204.32/0.95 = 215.07
  assert.equal(grossFromNet(225, 5, { fixedCost: 9.32 }), 247); // 234.32/0.95 = 246.65
});

// The full channel grid of spec rule 34 — nets 160/195/225 (+ extra guest 25).
const CHANNELS = [
  ['Abracadaroom', 20.0, [200, 244, 282], 32],
  ['Airbnb', 15.5, [190, 231, 267], 30],
  ['Booking', 15.0, [189, 230, 265], 30],
  ['Greengo', 14.5, [188, 229, 264], 30],
  ['Abritel', 13.0, [184, 225, 259], 29],
  ['Gîtes de France', 0.0, [160, 195, 225], 25],
];

test('grossFromNet reproduces the whole spec rule 34 grid', () => {
  for (const [name, commission, [low, mid, high], extra] of CHANNELS) {
    assert.equal(grossFromNet(160, commission), low, `${name} LOW`);
    assert.equal(grossFromNet(195, commission), mid, `${name} MID`);
    assert.equal(grossFromNet(225, commission), high, `${name} HIGH`);
    assert.equal(grossFromNet(25, commission), extra, `${name} extra guest`);
  }
  assert.equal(grossFromNet(25, 5), 27); // direct extra guest — no pack on the per-guest line
});

// ── platformsModel commissionPercent ─────────────────────────────────────────

function platformsDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
    commissionAccountNumber TEXT, hasVatOnCommission INTEGER NOT NULL DEFAULT 0,
    commissionPercent REAL NOT NULL DEFAULT 0, color TEXT
  );
  CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, platformLabel TEXT);
  CREATE TABLE reservations (id INTEGER PRIMARY KEY, platform TEXT);`);
  db.prepare("INSERT INTO platforms (name) VALUES ('direct'), ('Airbnb'), ('Booking')").run();
  return db;
}

test('setCommissionPercent clamps to [0, 99.99]; direct is editable (booking-engine fee, rule 32)', () => {
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

  m.setCommissionPercent(direct, 5);
  assert.equal(db.prepare('SELECT commissionPercent FROM platforms WHERE id = ?').get(direct).commissionPercent, 5);

  const list = m.listWithCommission();
  assert.deepEqual(list.map((p) => p.name).sort(), ['Airbnb', 'Booking']);
  assert.ok(!list.some((p) => p.name === 'direct'));
});

// ── propertiesModel.platformPrices grid ──────────────────────────────────────

function gridDb() {
  const db = platformsDb();
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, extraGuestPrice REAL DEFAULT 0,
      extraGuestPriceUnit TEXT DEFAULT 'per_stay', welcomePackCost REAL DEFAULT 0);
    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER NOT NULL, label TEXT,
      pricePerNight REAL NOT NULL DEFAULT 0, startDate TEXT,
      seasonKey TEXT, seasonRank INTEGER, netTargetPerNight REAL, extraGuestPrice REAL, extraGuestNetTarget REAL, extraGuestTiers TEXT
    );`);
  return db;
}

test('platformPrices: direct row first with the pack-covered price + extra-guest column', () => {
  const db = gridDb();
  db.prepare("UPDATE platforms SET commissionPercent = 5 WHERE name = 'direct'").run();
  db.prepare("UPDATE platforms SET commissionPercent = 15.5 WHERE name = 'Airbnb'").run();
  db.prepare("UPDATE platforms SET commissionPercent = 15 WHERE name = 'Booking'").run();
  db.prepare("INSERT INTO properties (id, name, extraGuestPrice, extraGuestPriceUnit, welcomePackCost) VALUES (1, 'Lodge', 27, 'per_night', 9.32)").run();
  db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, startDate, netTargetPerNight, extraGuestPrice, extraGuestNetTarget)
    VALUES (1, 'Basse', 179, '2026-01-01', 160, 27, 25), (1, 'Haute', 247, '2026-07-11', 225, 27, 25)`).run();

  const out = buildPropertiesModel(db).platformPrices(1);
  assert.equal(out.platforms[0].isDirect, true, 'direct row first');
  const direct = out.platforms[0];
  const airbnb = out.platforms.find((p) => p.name === 'Airbnb');

  const basse = out.seasons.find((s) => s.label === 'Basse');
  assert.equal(basse.netPerNight, 160);            // the net target, NOT the billed 179
  assert.equal(basse.byPlatform[direct.id], 179);  // ceil((160+9.32)/0.95)
  assert.equal(basse.byPlatform[airbnb.id], 190);  // ceil(160/0.845)
  assert.equal(basse.extraGuestByPlatform[direct.id], 27); // no pack on the per-guest line
  assert.equal(basse.extraGuestByPlatform[airbnb.id], 30);
  assert.equal(basse.extraGuestPriceUnit, 'per_night');

  const haute = out.seasons.find((s) => s.label === 'Haute');
  assert.equal(haute.byPlatform[direct.id], 247);
  assert.equal(haute.byPlatform[airbnb.id], 267);
  db.close();
});

test('platformPrices: legacy property (NULL net columns) grosses up the season price, euro-up', () => {
  const db = gridDb();
  db.prepare("UPDATE platforms SET commissionPercent = 20 WHERE name = 'Airbnb'").run();
  db.prepare("INSERT INTO properties (id, name, extraGuestPrice) VALUES (1, 'Gite', 15)").run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, startDate) VALUES (1, 'Basse', 100, '2026-01-01')").run();

  const out = buildPropertiesModel(db).platformPrices(1);
  const airbnb = out.platforms.find((p) => p.name === 'Airbnb');
  const direct = out.platforms.find((p) => p.isDirect);
  const basse = out.seasons[0];
  assert.equal(basse.netPerNight, 100);            // net = pricePerNight when no target stored
  assert.equal(basse.byPlatform[airbnb.id], 125);
  assert.equal(basse.byPlatform[direct.id], 100);  // direct 0 %, no pack → the season price itself
  assert.equal(basse.extraGuestNet, 15);           // falls back to the property's price
  assert.equal(basse.extraGuestPriceUnit, 'per_stay');
  db.close();
});

test('platformPrices: empty seasons → empty grid (direct + platforms still listed)', () => {
  const db = gridDb();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  const out = buildPropertiesModel(db).platformPrices(1);
  assert.equal(out.seasons.length, 0);
  assert.equal(out.platforms.length, 3); // direct + Airbnb + Booking
  assert.equal(out.platforms[0].isDirect, true);
  db.close();
});

test('platformPrices grosses up a tiered supplement from each band NET pivot, not the displayed price', () => {
  const db = gridDb();
  db.prepare("UPDATE platforms SET commissionPercent = 5 WHERE name = 'direct'").run();
  db.prepare("UPDATE platforms SET commissionPercent = 15.5 WHERE name = 'Airbnb'").run();
  db.prepare("INSERT INTO properties (id, name, extraGuestPrice, extraGuestPriceUnit) VALUES (1, 'Lodge', 15, 'per_night')").run();
  // The Aventura bands: displayed 15/8, net 14/7. Grossing up the DISPLAYED price was the review
  // finding this test pins: direct would show 16/9 — a grid nobody configured anywhere.
  db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, startDate, extraGuestTiers)
    VALUES (1, 'Haute', 247, '2026-07-11', ?)`).run(
    JSON.stringify([{ fromNight: 1, price: 15, netPrice: 14 }, { fromNight: 2, price: 8, netPrice: 7 }]),
  );
  const grid = buildPropertiesModel(db).platformPrices(1);
  const direct = grid.platforms.find((p) => p.isDirect);
  const season = grid.seasons[0];
  // ceil(14 / 0.95) = 15 and ceil(7 / 0.95) = 8 — the direct row REPRODUCES the displayed tiers.
  assert.deepEqual(season.extraGuestTiersByPlatform[direct.id], [
    { fromNight: 1, price: 15 },
    { fromNight: 2, price: 8 },
  ]);
  // A commissioned channel grosses the same nets up by its own rate: ceil(14/0.845)=17, ceil(7/0.845)=9.
  const airbnb = grid.platforms.find((p) => String(p.name).toLowerCase() === 'airbnb');
  assert.deepEqual(season.extraGuestTiersByPlatform[airbnb.id], [
    { fromNight: 1, price: 17 },
    { fromNight: 2, price: 9 },
  ]);
  // A band WITHOUT a net pivot uses its displayed price as its own net (the documented fallback).
  db.prepare(`UPDATE pricing_rules SET extraGuestTiers = ? WHERE propertyId = 1`).run(
    JSON.stringify([{ fromNight: 1, price: 15 }]),
  );
  const fallback = buildPropertiesModel(db).platformPrices(1);
  assert.deepEqual(fallback.seasons[0].extraGuestTiersByPlatform[direct.id], [{ fromNight: 1, price: 16 }]);
  db.close();
});

test('Lodgify is not listed on its own — the Direct row IS that channel', () => {
  // Its « moteur Lodgify » caption says so and its commission is the engine fee. Two rows would ask
  // the operator to configure the same channel twice, with two rates that must never disagree.
  const db = gridDb();
  db.prepare("INSERT INTO platforms (name) VALUES ('Lodgify')").run();
  db.prepare("UPDATE platforms SET commissionPercent = 5 WHERE name IN ('direct', 'Lodgify')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Lodge')").run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, startDate) VALUES (1, 'Basse', 179, '2026-01-01')").run();

  const names = buildPropertiesModel(db).platformPrices(1).platforms.map((p) => p.name);
  assert.equal(names[0].toLowerCase(), 'direct', 'the own channel leads the grid');
  assert.equal(names.filter((n) => /lodgify/i.test(n)).length, 0, 'and appears exactly once');
  assert.ok(names.includes('Airbnb'), 'commissioned platforms are untouched');
  db.close();
});
