// specs/guest-email-texts-made-simple.md rule 34 — an instance upgraded from the release where an
// empty pool bound still meant 06-15 → 08-31 (its app_settings columns declared with those defaults)
// keeps that season on its properties, so « et pour la piscine » does not vanish from its J-7 email.
// An instance created after plugins-phase-p-productisation.md rule 14 (columns defaulting to '')
// reads empty as « no pool ».
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { applyGuestEmailSequenceSchema } = require('../utils/guestEmailSequenceSchema');

function dbWith({ startDefault, endDefault, season }) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, poolSeasonStart TEXT DEFAULT '${startDefault}', poolSeasonEnd TEXT DEFAULT '${endDefault}');
    INSERT INTO properties (id, name) VALUES (1, 'La Granja'), (2, 'L''Estiva');
  `);
  db.prepare('INSERT INTO app_settings (id, poolSeasonStart, poolSeasonEnd) VALUES (1, ?, ?)').run(season[0], season[1]);
  return db;
}

const seasons = (db) => db.prepare('SELECT poolSeasonStart AS s, poolSeasonEnd AS e FROM properties ORDER BY id').all().map((r) => [r.s, r.e]);

test('rule 34 — a pre-rule-14 instance with both bounds emptied keeps 06-15 → 08-31', () => {
  const db = dbWith({ startDefault: '06-15', endDefault: '08-31', season: ['', ''] });
  applyGuestEmailSequenceSchema(db);
  assert.deepEqual(seasons(db), [['06-15', '08-31'], ['06-15', '08-31']]);
});

test('rule 34 — a pre-rule-14 instance with NULL or one empty bound keeps the default for that bound only', () => {
  const db = dbWith({ startDefault: '06-15', endDefault: '08-31', season: ['07-01', null] });
  applyGuestEmailSequenceSchema(db);
  assert.deepEqual(seasons(db), [['07-01', '08-31'], ['07-01', '08-31']]);
});

test('rule 34 — a pre-rule-14 instance with its own season copies it unchanged', () => {
  const db = dbWith({ startDefault: '06-15', endDefault: '08-31', season: ['05-20', '09-30'] });
  applyGuestEmailSequenceSchema(db);
  assert.deepEqual(seasons(db), [['05-20', '09-30'], ['05-20', '09-30']]);
});

test('rule 34 — an instance created after rule 14 with empty bounds gets no pool', () => {
  const db = dbWith({ startDefault: '', endDefault: '', season: ['', ''] });
  applyGuestEmailSequenceSchema(db);
  assert.deepEqual(seasons(db), [['', ''], ['', '']]);
});
