// Platforms & iCal rework (specs/platforms-and-ical-rework.md). Four concerns:
//   1. platformsModel global colour — setColor/getColor/colorMap (custom → built-in → grey; a colour
//      equal to the built-in clears the override) + listForProperty merges every platform with the
//      property's source config + global colour.
//   2. propertyIcalModel — URL iCal is OPTIONAL (empty allowed, http(s) when present); sync skips
//      empty-URL sources; createSource upserts one row per (property, platform); the per-property
//      `disabled` flag persists; disabledPlatformLabels returns the hidden set.
//   3. reservationsModel.list({propertyId}) hides a disabled-platform reservation (DISPLAY only) while
//      getOccupiedReservations (availability) still counts it — no double-booking regression.
//   4. The calendar colour endpoint (propertiesModel.getPlatformColors) is backed by platforms.color.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const platformsModel = require('../models/platformsModel');
const propertyIcalModel = require('../models/propertyIcalModel');
const reservationsModel = require('../models/reservationsModel');
const propertiesModel = require('../models/propertiesModel');
const { __test: { isPlatformCollectingTouristTax } } = require('../utils/pricing');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  return db;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. platformsModel — global colour + merged per-property list
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('platformsModel.setColor/getColor: custom override, built-in fallback, clear-on-built-in', () => {
  const db = freshDb();
  const platforms = platformsModel.create(db);

  // Unconfigured built-in → its brand colour. Unknown platform → grey default.
  assert.equal(platforms.getColor('Airbnb'), '#FF5A5F');
  assert.equal(platforms.getColor('TotallyUnknown'), '#757575');

  // A custom colour overrides + upserts the platform row (works for a never-used built-in).
  platforms.setColor('Airbnb', '#123456');
  assert.equal(platforms.getColor('Airbnb'), '#123456');
  assert.deepEqual(platforms.colorMap(), { airbnb: '#123456' });

  // Setting the colour back to the built-in brand colour CLEARS the override (stored NULL).
  platforms.setColor('Airbnb', '#FF5A5F');
  assert.equal(platforms.getColor('Airbnb'), '#FF5A5F');
  assert.deepEqual(platforms.colorMap(), {}, 'no override left once it matches the built-in');

  // Empty colour also clears.
  platforms.setColor('Booking', '#abcdef');
  assert.equal(platforms.colorMap().booking, '#abcdef');
  platforms.setColor('Booking', '');
  assert.equal(platforms.colorMap().booking, undefined);
});

test('platformsModel.listForProperty: every platform listed; source config + colour merged in', () => {
  const db = freshDb();
  const platforms = platformsModel.create(db);
  const pim = propertyIcalModel.buildModel(db);

  // No source yet: direct + the built-ins are all present with defaults.
  const base = platforms.listForProperty(1);
  const names = base.map((p) => p.platformLabel.toLowerCase());
  assert.ok(names.includes('direct'), 'direct is listed');
  assert.ok(names.some((n) => n === 'airbnb'), 'built-in Airbnb is listed');
  const airbnbBase = base.find((p) => p.platformKey === 'airbnb');
  assert.deepEqual(
    { url: airbnbBase.url, tax: airbnbBase.collectsTouristTax, disabled: airbnbBase.disabled, sourceId: airbnbBase.sourceId },
    { url: '', tax: 1, disabled: 0, sourceId: null },
    'unconfigured platform: empty URL, tax=platform-collects, not disabled, no source row',
  );
  assert.equal(base.find((p) => p.isDirect).platformLabel.toLowerCase(), 'direct');

  // Configure Airbnb (URL + owner-collected tax) and give it a global colour.
  platforms.setColor('Airbnb', '#222222');
  pim.createSource(1, { platformKey: 'airbnb', platformLabel: 'Airbnb', url: 'https://a/c.ics', collectsTouristTax: false });

  const merged = platforms.listForProperty(1);
  const airbnb = merged.find((p) => p.platformKey === 'airbnb');
  assert.equal(airbnb.url, 'https://a/c.ics');
  assert.equal(airbnb.collectsTouristTax, 0, 'owner-collected persisted');
  assert.equal(airbnb.color, '#222222', 'global colour reflected in the merged row');
  assert.ok(airbnb.sourceId, 'a source row now exists for this property+platform');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. propertyIcalModel — optional URL, skip-sync, upsert-by-platform, disabled
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('propertyIcalModel.createSource: empty URL allowed; bad URL rejected', () => {
  const db = freshDb();
  const pim = propertyIcalModel.buildModel(db);

  const empty = pim.createSource(1, { platformKey: 'airbnb', platformLabel: 'Airbnb', url: '' });
  assert.ok(!empty.error, 'empty URL is accepted (manual-entry platform)');
  assert.equal(empty.data.url, '');

  const bad = pim.createSource(1, { platformKey: 'booking', platformLabel: 'Booking', url: 'ftp://nope' });
  assert.ok(bad.error, 'a non-http(s) URL is rejected');
});

test('propertyIcalModel: createSource upserts ONE row per (property, platform)', () => {
  const db = freshDb();
  const pim = propertyIcalModel.buildModel(db);

  pim.createSource(1, { platformKey: 'airbnb', platformLabel: 'Airbnb', url: '' });
  pim.createSource(1, { platformKey: 'airbnb', platformLabel: 'Airbnb', url: 'https://a/c.ics', collectsTouristTax: false });

  const rows = db.prepare("SELECT * FROM ical_sources WHERE propertyId = 1 AND lower(platformKey) = 'airbnb'").all();
  assert.equal(rows.length, 1, 'configure-on-demand updates the existing row, never duplicates');
  assert.equal(rows[0].url, 'https://a/c.ics');
  assert.equal(rows[0].collectsTouristTax, 0);
});

test('propertyIcalModel: sync skips empty-URL sources (no fetch, status untouched)', async () => {
  const db = freshDb();
  const pim = propertyIcalModel.buildModel(db);
  const { data: source } = pim.createSource(1, { platformKey: 'airbnb', platformLabel: 'Airbnb', url: '' });

  const one = await pim.syncOne(1, source.id);
  assert.ok(one.error, 'syncOne refuses an empty-URL source');

  const all = await pim.syncAllForProperty(1);
  assert.deepEqual(all.results, [], 'sync-all skips empty-URL sources entirely (no error rows)');

  const after = db.prepare('SELECT lastSyncAt, lastSyncStatus FROM ical_sources WHERE id = ?').get(source.id);
  assert.equal(after.lastSyncAt, null, 'sync status left blank for a manual-entry platform');
  assert.equal(after.lastSyncStatus, null);
});

test('propertyIcalModel: disabled flag persists + disabledPlatformLabels returns the hidden set', () => {
  const db = freshDb();
  const pim = propertyIcalModel.buildModel(db);

  pim.createSource(1, { platformKey: 'airbnb', platformLabel: 'Airbnb', url: '', disabled: true });
  pim.createSource(1, { platformKey: 'booking', platformLabel: 'Booking', url: '' }); // not disabled

  const labels = pim.disabledPlatformLabels(1);
  assert.ok(labels.includes('airbnb'), 'the disabled platform label is returned (lowercased)');
  assert.ok(!labels.includes('booking'), 'a non-disabled platform is not returned');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. reservationsModel — disabled platform hidden from list, STILL blocks availability
// ─────────────────────────────────────────────────────────────────────────────────────────────

function seedStay(db, { id, platform }) {
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, platform, adults, finalPrice, totalPrice)
              VALUES (?, 'reservation', 1, 1, '2026-07-10', '2026-07-12', ?, 2, 300, 300)`).run(id, platform);
}

test('reservationsModel.list hides a disabled-platform reservation; availability still counts it', () => {
  const db = freshDb();
  const pim = propertyIcalModel.buildModel(db);
  const rm = reservationsModel.create(db);

  seedStay(db, { id: 1, platform: 'Airbnb' });
  seedStay(db, { id: 2, platform: 'Booking' });
  // Disable Airbnb for this property.
  pim.createSource(1, { platformKey: 'airbnb', platformLabel: 'Airbnb', url: '', disabled: true });

  const listed = rm.list({ propertyId: 1 }).map((r) => r.id).sort((a, b) => a - b);
  assert.deepEqual(listed, [2], 'the disabled-platform (Airbnb) reservation is hidden from the property list');

  const occupied = rm.getOccupiedReservations(1, '2026-07-01', '2026-07-31');
  assert.equal(occupied.length, 2, 'availability STILL sees both stays — a disabled platform never frees dates');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. Calendar colour endpoint is backed by platforms.color
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('propertiesModel.getPlatformColors is backed by platforms.color', () => {
  const db = freshDb();
  const platforms = platformsModel.create(db);
  const props = propertiesModel.buildModel(db);

  platforms.setColor('Booking', '#0a0b0c');
  const { knownColors, customColors } = props.getPlatformColors();
  assert.equal(knownColors.airbnb, '#FF5A5F', 'built-in defaults are still exposed');
  assert.equal(customColors.booking, '#0a0b0c', 'the global override wins for the calendar');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 5. Tourist-tax toggle resolves for multi-word / accented platforms (manual-entry path)
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('isPlatformCollectingTouristTax matches platformLabel OR platformKey (multi-word platforms)', () => {
  const db = freshDb();
  // A multi-word platform configured owner-collects (collectsTouristTax = 0). The iCal import stores the
  // hyphenated platformKey; a MANUAL reservation stores the concatenated label ('GitesDeFrance').
  db.prepare(`INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, platformColor, collectsTouristTax)
              VALUES (1, 'Gîtes de France', '', 'g-tes-de-france', 'GitesDeFrance', '#e6c832', 0)`).run();

  // Manual path: reservations.platform = 'GitesDeFrance' (matches platformLabel).
  assert.equal(isPlatformCollectingTouristTax(db, 1, 'GitesDeFrance'), false, 'owner-collects toggle honoured on the manual path');
  // iCal path: reservations.platform = the hyphenated key.
  assert.equal(isPlatformCollectingTouristTax(db, 1, 'g-tes-de-france'), false, 'owner-collects toggle honoured on the iCal path');
  // An unconfigured platform falls back to the legacy default (platform collects).
  assert.equal(isPlatformCollectingTouristTax(db, 1, 'Airbnb'), true, 'unconfigured non-direct platform defaults to platform-collects');
  // direct is never platform-collected.
  assert.equal(isPlatformCollectingTouristTax(db, 1, 'direct'), false);
});
