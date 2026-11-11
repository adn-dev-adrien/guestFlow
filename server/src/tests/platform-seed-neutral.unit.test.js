// specs/plugins-phase-p-productisation.md rule 32 — a fresh install lists no « GitesDeFrance » platform
// it never asked for: the fold of the Gîtes de France spellings creates its target only for an
// instance that already speaks of that brand.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { mergePlatformDuplicates } = require('../utils/platformMerge');

function db() {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT UNIQUE, color TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, platform TEXT, sourceIcalSourceId INTEGER);
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER, url TEXT, platformKey TEXT, platformLabel TEXT, name TEXT);
    CREATE TABLE ical_import_events (id INTEGER PRIMARY KEY, sourceId INTEGER);
    INSERT INTO platforms (name) VALUES ('direct');
  `);
  return d;
}
const fold = (d) => mergePlatformDuplicates(d, { slugs: ['gitedefrance', 'gitesdefrance'], targetName: 'GitesDeFrance' });
const names = (d) => d.prepare('SELECT name FROM platforms ORDER BY id').all().map((r) => r.name);

test('rule 32: a fresh install gets no Gîtes de France platform', () => {
  const d = db();
  fold(d);
  assert.deepEqual(names(d), ['direct']);
});

test('rule 32: an instance with a Gîtes de France spelling is folded as before', () => {
  const d = db();
  d.exec("INSERT INTO platforms (name) VALUES ('Gite de France'); INSERT INTO reservations (platform) VALUES ('Gite de France');");
  fold(d);
  assert.deepEqual(names(d), ['direct', 'GitesDeFrance']);
  assert.equal(d.prepare('SELECT platform FROM reservations').get().platform, 'GitesDeFrance');
});

test('rule 32: a reservation already on the canonical name keeps its platform row', () => {
  const d = db();
  d.exec("INSERT INTO reservations (platform) VALUES ('GitesDeFrance');");
  fold(d);
  assert.deepEqual(names(d), ['direct', 'GitesDeFrance']);
});
