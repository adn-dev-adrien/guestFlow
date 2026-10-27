// specs/normalize-platform-names.md rule 22 (audit 2026-10-27) — saving a calendar must not respell its
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

test('the boot de-duplication merges spellings of one slug into the most-segmented one, keeping every setting', () => {
  const mem = new Database(':memory:');
  mem.exec(`CREATE TABLE platforms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
      commissionPercent REAL NOT NULL DEFAULT 0, countsAsDirect INTEGER NOT NULL DEFAULT 0, forbidsGuestChores INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, platformLabel TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT);`);
  mem.prepare("INSERT INTO platforms (id, name, commissionPercent, forbidsGuestChores) VALUES (2, 'AirbnbTente', 15, 1), (3, 'Airbnbtente', 0, 0)").run();
  mem.prepare("INSERT INTO platforms (id, name, commissionPercent, countsAsDirect) VALUES (4, 'Gitesdefrance', 0, 1), (5, 'GitesDeFrance', 10, 0)").run();
  mem.prepare("INSERT INTO ical_sources (id, platformLabel) VALUES (1, 'Airbnbtente'), (2, 'Gitesdefrance')").run();
  mem.prepare("INSERT INTO reservations (platform) VALUES ('Airbnbtente'), ('Gitesdefrance'), ('gites-de-france')").run();

  const result = runPlatformSlugDedup(mem);
  assert.equal(result.mergedCount, 2);
  assert.deepEqual(mem.prepare('SELECT name, commissionPercent, countsAsDirect, forbidsGuestChores FROM platforms ORDER BY name').all(), [
    { name: 'AirbnbTente', commissionPercent: 15, countsAsDirect: 0, forbidsGuestChores: 1 },
    { name: 'GitesDeFrance', commissionPercent: 10, countsAsDirect: 1, forbidsGuestChores: 0 },
  ]);
  assert.deepEqual(mem.prepare('SELECT platformLabel FROM ical_sources ORDER BY id').all().map((r) => r.platformLabel), ['AirbnbTente', 'GitesDeFrance']);
  assert.deepEqual(mem.prepare('SELECT DISTINCT platform FROM reservations ORDER BY platform').all().map((r) => r.platform), ['AirbnbTente', 'GitesDeFrance']);
  assert.deepEqual(runPlatformSlugDedup(mem), { mergedCount: 0, renamedCount: 0, normalisedRefs: 0 }, 'idempotent');
});
