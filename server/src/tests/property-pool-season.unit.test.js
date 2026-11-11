// specs/guest-email-texts-made-simple.md rule 34 — the pool season belongs to the property that has
// the pool, set on its Séjour tab, not in the instance's email settings. The upgrade copies the season
// once onto every property, so no email of an existing instance moves.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { applyGuestEmailSequenceSchema } = require('../utils/guestEmailSequenceSchema');
const { validatePropertyInput } = require('../utils/propertyValidation');
const { freshDb } = require('./guestEmailSequenceFixtures');
const propertiesModelModule = require('../models/propertiesModel');
const settingsResponse = require('../utils/settingsResponse');

function legacyDb(season) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, poolSeasonStart TEXT DEFAULT '', poolSeasonEnd TEXT DEFAULT '');
    INSERT INTO properties (id, name) VALUES (1, 'La Granja'), (2, 'L''Estiva');
  `);
  db.prepare('INSERT INTO app_settings (id, poolSeasonStart, poolSeasonEnd) VALUES (1, ?, ?)').run(season[0], season[1]);
  return db;
}

test('rule 34: the upgrade copies the instance season onto every property, once', () => {
  const db = legacyDb(['06-15', '08-31']);
  applyGuestEmailSequenceSchema(db);
  assert.deepEqual(db.prepare('SELECT poolSeasonStart AS s, poolSeasonEnd AS e FROM properties ORDER BY id').all().map((r) => [r.s, r.e]),
    [['06-15', '08-31'], ['06-15', '08-31']]);
  db.prepare("UPDATE properties SET poolSeasonStart = '', poolSeasonEnd = '' WHERE id = 2").run();
  applyGuestEmailSequenceSchema(db);
  assert.equal(db.prepare('SELECT poolSeasonStart FROM properties WHERE id = 2').get().poolSeasonStart, '', 'never copied again');
});

test('rule 34: an instance without a pool gets none on its properties', () => {
  const db = legacyDb(['', '']);
  applyGuestEmailSequenceSchema(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM properties WHERE poolSeasonStart != ''").get().n, 0);
});

test('rule 34: both dates or none, each a real day of the year', () => {
  assert.deepEqual(validatePropertyInput({ poolSeasonStart: '06-15', poolSeasonEnd: '08-31' }), {});
  assert.deepEqual(validatePropertyInput({ poolSeasonStart: '', poolSeasonEnd: '' }), {});
  assert.equal(validatePropertyInput({ poolSeasonStart: '06-15', poolSeasonEnd: '' }).poolSeasonEnd, 'Les deux dates.');
  assert.ok(validatePropertyInput({ poolSeasonStart: '13-40', poolSeasonEnd: '08-31' }).poolSeasonStart);
});

test('rule 34: the property page saves it; the email settings no longer carry it', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Le Gîte')").run();
  await propertiesModelModule.buildModel(db).update(1, { name: 'Le Gîte', poolSeasonStart: '07-01', poolSeasonEnd: '08-31' });
  assert.deepEqual({ ...db.prepare('SELECT poolSeasonStart, poolSeasonEnd FROM properties WHERE id = 1').get() }, { poolSeasonStart: '07-01', poolSeasonEnd: '08-31' });
  const shaped = settingsResponse.shapeResponse({ poolSeasonStart: '06-15', poolSeasonEnd: '08-31' });
  assert.ok(!('poolSeasonStart' in shaped.emails));
});
