// Platform-duplicate merge (utils/platformMerge): fold the legacy singular "Gîte de France" and the
// plural "Gîtes de France" into a single canonical "GitesDeFrance" across reservations, ical_sources
// and the platforms registry — slug-based, idempotent, and non-destructive for real feeds.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { mergePlatformDuplicates, slugOf } = require('../utils/platformMerge');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte A'), (2, 'Gîte B')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  // Registry: the legacy no-'s' row carries a custom colour; the plural has none yet.
  db.prepare("INSERT INTO platforms (name, color) VALUES ('Gitedefrance', '#abcdef'), ('GitesDeFrance', NULL)").run();
  // Reservations across three spellings.
  const ins = db.prepare(`INSERT INTO reservations (kind, clientId, propertyId, startDate, endDate, platform)
                          VALUES ('reservation', 1, 1, '2026-07-10', '2026-07-12', ?)`);
  ins.run('Gitedefrance');     // legacy singular
  ins.run('GitesDeFrance');    // plural
  ins.run('Gîtes de France');  // spaced + accented variant
  ins.run('Airbnb');           // untouched control
  // ical_sources: property 1 has an empty-URL placeholder (singular) + a real URL'd feed (plural).
  db.prepare(`INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, platformColor)
              VALUES (1, 'Gitedefrance', '', 'gitedefrance', 'Gitedefrance', '#e6c832')`).run();
  db.prepare(`INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, platformColor)
              VALUES (1, 'GitesDeFrance', 'https://gites/c.ics', 'gitesdefrance', 'GitesDeFrance', '#e6c832')`).run();
  // property 2 has a single spaced-variant source.
  db.prepare(`INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, platformColor)
              VALUES (2, 'Gîtes de France', 'https://b/c.ics', 'g-tes-de-france', 'Gîtes de France', '#e6c832')`).run();
  return db;
}

const MERGE = { slugs: ['gitedefrance', 'gitesdefrance'], targetName: 'GitesDeFrance' };

test('slugOf collapses every Gîtes-de-France spelling to one slug', () => {
  assert.equal(slugOf('Gitedefrance'), 'gitedefrance');
  assert.equal(slugOf('Gîtes de France'), 'gitesdefrance');
  assert.equal(slugOf('GitesDeFrance'), 'gitesdefrance');
});

test('mergePlatformDuplicates: reservations, sources and registry all fold into GitesDeFrance', () => {
  const db = seed();
  mergePlatformDuplicates(db, MERGE);

  // 1. reservations — every Gîtes variant becomes the canonical; the control is untouched.
  const platforms = db.prepare('SELECT platform FROM reservations ORDER BY id').all().map((r) => r.platform);
  assert.deepEqual(platforms, ['GitesDeFrance', 'GitesDeFrance', 'GitesDeFrance', 'Airbnb']);

  // 2. registry — only the canonical row remains; it inherited the legacy custom colour.
  const rows = db.prepare("SELECT name, color FROM platforms WHERE lower(name) LIKE 'gite%' ORDER BY name").all();
  assert.deepEqual(rows, [{ name: 'GitesDeFrance', color: '#abcdef' }]);

  // 3. ical_sources — property 1: the empty-URL placeholder is dropped, the real feed kept + relabeled.
  const p1 = db.prepare('SELECT platformKey, platformLabel, name, url FROM ical_sources WHERE propertyId = 1').all();
  assert.equal(p1.length, 1, 'the empty-URL duplicate placeholder was removed');
  assert.deepEqual(
    { key: p1[0].platformKey, label: p1[0].platformLabel, name: p1[0].name, url: p1[0].url },
    { key: 'gitesdefrance', label: 'GitesDeFrance', name: 'GitesDeFrance', url: 'https://gites/c.ics' },
  );
  // property 2: the lone spaced-variant feed is relabeled (kept — it has a URL).
  const p2 = db.prepare('SELECT platformKey, platformLabel, url FROM ical_sources WHERE propertyId = 2').get();
  assert.deepEqual(p2, { platformKey: 'gitesdefrance', platformLabel: 'GitesDeFrance', url: 'https://b/c.ics' });
});

test('mergePlatformDuplicates is idempotent (a second run changes nothing)', () => {
  const db = seed();
  mergePlatformDuplicates(db, MERGE);
  const second = mergePlatformDuplicates(db, MERGE);
  assert.deepEqual(second, { reservations: 0, sources: 0, sourcesDeleted: 0, platforms: 0 });
});
