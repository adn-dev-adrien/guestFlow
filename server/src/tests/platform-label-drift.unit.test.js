// specs/normalize-platform-names.md addendum 2026-10-27, item 22 — saving a calendar must not respell its
// platform. A sentence-case pass before `formatPlatformName` turned `GitesDeFrance` into `Gitesdefrance`
// and `AirbnbTente` into `Airbnbtente`: a second catalogue row with no commission, every import tagged
// with it, and the GdF intake reading 0 % instead of 10 %. The boot de-duplication now groups spellings
// by slug, so such a pair merges back into the operator's row.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const db = require('../database');
const platformsModel = require('../models/platformsModel');
const icalModel = require('../models/propertyIcalModel');
const { runPlatformSlugDedup } = require('../utils/platformSlugDedupMigration');

const propertyId = Number(db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 8)").run().lastInsertRowid);

for (const [name, commission] of [['GitesDeFrance', 10], ['AirbnbTente', 15]]) {
  test(`saving the « ${name} » calendar keeps the catalogue's spelling and its commission`, () => {
    db.prepare('INSERT INTO platforms (name, commissionPercent) VALUES (?, ?)').run(name, commission);
    const row = platformsModel.listForProperty(propertyId).find((r) => r.platformLabel === name);
    const created = icalModel.createSource(propertyId, { platformKey: row.platformKey, platformLabel: row.platformLabel, url: 'https://example.invalid/f.ics' });
    assert.equal(created.data.platformLabel, name);
    icalModel.updateSource(propertyId, created.data.id, { url: 'https://example.invalid/g.ics' });
    assert.equal(db.prepare('SELECT platformLabel FROM ical_sources WHERE id = ?').get(created.data.id).platformLabel, name);
    const rows = db.prepare('SELECT name, commissionPercent FROM platforms WHERE lower(name) = lower(?)').all(name);
    assert.deepEqual(rows, [{ name, commissionPercent: commission }], 'no second catalogue row');
  });
}

test('a free-typed label is still put in canonical form', () => {
  const created = icalModel.createSource(propertyId, { platformLabel: 'gîtes de france', url: '' });
  assert.equal(created.data.platformLabel, 'GitesDeFrance');
});

test('the boot de-duplication merges spellings of one slug into the most-referenced one, keeping every setting', () => {
  const mem = new Database(':memory:');
  mem.exec(`CREATE TABLE platforms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
      commissionPercent REAL NOT NULL DEFAULT 0, countsAsDirect INTEGER NOT NULL DEFAULT 0, forbidsGuestChores INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, platformLabel TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT);`);
  mem.prepare("INSERT INTO platforms (id, name, commissionPercent, forbidsGuestChores) VALUES (2, 'AirbnbTente', 15, 1), (3, 'Airbnbtente', 0, 0)").run();
  mem.prepare("INSERT INTO platforms (id, name, commissionPercent, countsAsDirect) VALUES (4, 'Gitesdefrance', 0, 1), (5, 'GitesDeFrance', 10, 0)").run();
  // The operator's rows carry the history (more stays); the drifted ones a few imports since the bad save.
  mem.prepare("INSERT INTO ical_sources (id, platformLabel) VALUES (1, 'Airbnbtente'), (2, 'Gitesdefrance'), (3, 'AirbnbTente'), (4, 'GitesDeFrance')").run();
  mem.prepare(`INSERT INTO reservations (platform) VALUES ('Airbnbtente'), ('Gitesdefrance'), ('gites-de-france'),
    ('AirbnbTente'), ('AirbnbTente'), ('GitesDeFrance'), ('GitesDeFrance'), ('GitesDeFrance')`).run();

  const result = runPlatformSlugDedup(mem);
  assert.equal(result.mergedCount, 2);
  assert.deepEqual(mem.prepare('SELECT name, commissionPercent, countsAsDirect, forbidsGuestChores FROM platforms ORDER BY name').all(), [
    { name: 'AirbnbTente', commissionPercent: 15, countsAsDirect: 0, forbidsGuestChores: 1 },
    { name: 'GitesDeFrance', commissionPercent: 10, countsAsDirect: 1, forbidsGuestChores: 0 },
  ]);
  assert.deepEqual(mem.prepare('SELECT platformLabel FROM ical_sources ORDER BY id').all().map((r) => r.platformLabel), ['AirbnbTente', 'GitesDeFrance', 'AirbnbTente', 'GitesDeFrance']);
  assert.deepEqual(mem.prepare('SELECT DISTINCT platform FROM reservations ORDER BY platform').all().map((r) => r.platform), ['AirbnbTente', 'GitesDeFrance']);
  assert.deepEqual(runPlatformSlugDedup(mem), { mergedCount: 0, renamedCount: 0, normalisedRefs: 0 }, 'idempotent');
});

// Amendment of addendum item 23, after the PR #798 review — the surviving name is the most-referenced row's (stays +
// iCal sources), then the lowest id; « most segments » only breaks a tie between unreferenced rows. A
// stray `AirBnb` row must not rename the established `Airbnb`: the Qonto reconciliation matches names
// exactly. The cancellation compensations follow the merge like the stays.
test('the established, referenced spelling survives a stray variant; compensations follow', () => {
  const mem = new Database(':memory:');
  mem.exec(`CREATE TABLE platforms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
      commissionPercent REAL NOT NULL DEFAULT 0);
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, platformLabel TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT);
    CREATE TABLE cancellation_compensations (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT);`);
  mem.prepare("INSERT INTO platforms (id, name, commissionPercent) VALUES (3, 'Airbnb', 15), (40, 'AirBnb', 0), (5, 'Greengo', 12), (41, 'GreenGo', 0), (6, 'Lodgify', 0), (42, 'LodGify', 0)").run();
  mem.prepare("INSERT INTO ical_sources (id, platformLabel) VALUES (1, 'Airbnb'), (2, 'Airbnb'), (3, 'Greengo')").run();
  mem.prepare("INSERT INTO reservations (platform) VALUES ('Airbnb'), ('Airbnb'), ('AirBnb'), ('Greengo')").run();
  mem.prepare("INSERT INTO cancellation_compensations (platform) VALUES ('AirBnb'), ('GreenGo')").run();

  runPlatformSlugDedup(mem);
  assert.deepEqual(mem.prepare('SELECT id, name, commissionPercent FROM platforms ORDER BY id').all(), [
    { id: 3, name: 'Airbnb', commissionPercent: 15 },
    { id: 5, name: 'Greengo', commissionPercent: 12 },
    { id: 42, name: 'LodGify', commissionPercent: 0 },
  ], 'referenced rows keep their name; between two unreferenced rows the most-segmented spelling wins');
  assert.deepEqual(mem.prepare('SELECT DISTINCT platform FROM reservations ORDER BY platform').all().map((r) => r.platform), ['Airbnb', 'Greengo']);
  assert.deepEqual(mem.prepare('SELECT DISTINCT platformLabel FROM ical_sources ORDER BY platformLabel').all().map((r) => r.platformLabel), ['Airbnb', 'Greengo']);
  assert.deepEqual(mem.prepare('SELECT platform FROM cancellation_compensations ORDER BY id').all().map((r) => r.platform), ['Airbnb', 'Greengo']);
});
