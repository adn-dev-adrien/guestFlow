// specs/plugins/plugin-removal-resilience.md rule 22 — the id counter of a recreated plugin table restarts above every id a core row still cites.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { highestCitedId, raiseCounter } = require('../plugins/sdk/citedIdCounterFloor');

const lines = (refs) => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE lines (id INTEGER PRIMARY KEY, orderRef TEXT); CREATE TABLE things (id INTEGER PRIMARY KEY AUTOINCREMENT)');
  refs.forEach((ref) => db.prepare('INSERT INTO lines (orderRef) VALUES (?)').run(ref));
  return db;
};
const SOURCES = [{ table: 'lines', column: 'orderRef' }, { table: 'missing', column: 'x' }, { table: 'lines', column: 'nope' }];

test('the highest cited id wins, numerically, and a foreign prefix or a malformed ref is ignored', () => {
  const db = lines(['order:9:100', 'order:12:101', 'order:12:102', 'order:7', 'order:x:1', 'other:99:1', null]);
  assert.equal(highestCitedId(db, 'order:', SOURCES), 12);
  assert.equal(highestCitedId(lines([]), 'order:', SOURCES), 0);
});

test('the counter is created, raised, and never lowered; a missing table is left alone', () => {
  const db = lines([]);
  raiseCounter(db, 'things', 12);
  assert.equal(db.prepare('INSERT INTO things DEFAULT VALUES').run().lastInsertRowid, 13, 'the next id is above the cited one');
  raiseCounter(db, 'things', 5);
  assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'things'").get().seq, 13);
  raiseCounter(db, 'things', 40);
  assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'things'").get().seq, 40);
  raiseCounter(db, 'absent', 3);
  raiseCounter(db, 'things', 0);
  assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'things'").get().seq, 40);
});
