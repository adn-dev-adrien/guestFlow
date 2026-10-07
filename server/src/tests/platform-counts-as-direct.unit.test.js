// specs/plugins-phase-p-productisation.md rule 19 — a platform counts as a direct sale by an attribute,
// not by its name: `direct` always, the others when the operator says so, read again on every save.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  isDirectChannel, setDirectChannels, refreshDirectChannels, registerDirectChannelSql,
} = require('../utils/platformNameFormat');
const { applyProductisationSchema } = require('../utils/productisationMigration');

function db() {
  const d = new Database(':memory:');
  d.exec("CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL); CREATE TABLE app_settings (id INTEGER PRIMARY KEY)");
  applyProductisationSchema(d);
  d.prepare("INSERT INTO platforms (name) VALUES ('direct'), ('lodgify'), ('airbnb')").run();
  return d;
}

test.afterEach(() => setDirectChannels([]));

test('without the attribute, only `direct` (and an empty platform) is direct — Lodgify is a platform like any other', () => {
  refreshDirectChannels(db());
  assert.equal(isDirectChannel('direct'), true);
  assert.equal(isDirectChannel(''), true);
  assert.equal(isDirectChannel(null), true);
  assert.equal(isDirectChannel('Lodgify'), false);
});

test('a platform marked « Compté comme vente directe » is direct, whatever its case', () => {
  const d = db();
  d.prepare("UPDATE platforms SET countsAsDirect = 1 WHERE name = 'lodgify'").run();
  refreshDirectChannels(d);
  assert.equal(isDirectChannel('Lodgify'), true);
  assert.equal(isDirectChannel(' lodgify '), true);
  assert.equal(isDirectChannel('airbnb'), false);
});

test('the SQL reads follow the same set, read at query time', () => {
  const d = db();
  registerDirectChannelSql(d);
  registerDirectChannelSql(d);
  const count = () => d.prepare('SELECT COUNT(*) AS n FROM platforms WHERE is_direct_channel(name) = 1').get().n;
  refreshDirectChannels(d);
  assert.equal(count(), 1);
  d.prepare("UPDATE platforms SET countsAsDirect = 1 WHERE name = 'lodgify'").run();
  refreshDirectChannels(d);
  assert.equal(count(), 2, 'no restart needed');
});

test('a database without the column counts `direct` alone', () => {
  const d = new Database(':memory:');
  d.exec('CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT)');
  setDirectChannels(['lodgify']);
  refreshDirectChannels(d);
  assert.equal(isDirectChannel('lodgify'), false);
});
