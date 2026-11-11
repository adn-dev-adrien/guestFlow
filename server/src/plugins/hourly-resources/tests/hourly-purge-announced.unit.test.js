// specs/plugins-phase-3c-hourly-resources.md rule 17 — the erasure warning announces every resource
// setting the purge resets. A resource that only carries a heat-up / heat-retention time (the
// thermal model, 240 / 480 min in production) is reset by the purge, so it is announced too.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { resetHourlyColumns, countHourlySettings } = require('../migrations');

function db(rows) {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE resources (
    id INTEGER PRIMARY KEY, name TEXT,
    isComplex INTEGER DEFAULT 0, showsPlanningCard INTEGER DEFAULT 0, turnoverMinutes INTEGER DEFAULT 0,
    hourlyEveningStart TEXT, hourlyEveningRate REAL DEFAULT 0, hourlyExternalDayRate REAL DEFAULT 0,
    hourlyExternalEveningRate REAL DEFAULT 0, heatUpMinutes INTEGER DEFAULT 0, heatRetentionMinutes INTEGER DEFAULT 0
  )`);
  const insert = d.prepare('INSERT INTO resources (id, name) VALUES (?, ?)');
  rows.forEach(([id, columns]) => {
    insert.run(id, `r${id}`);
    for (const [column, value] of Object.entries(columns)) d.prepare(`UPDATE resources SET ${column} = ? WHERE id = ?`).run(value, id);
  });
  return d;
}

test('a resource with only a heat-up and a heat-retention time is announced', () => {
  const d = db([[1, { heatUpMinutes: 240, heatRetentionMinutes: 480 }]]);
  assert.equal(countHourlySettings(d), 1);
});

for (const [column, value] of [
  ['heatUpMinutes', 240], ['heatRetentionMinutes', 480], ['turnoverMinutes', 15], ['hourlyEveningStart', '20:00'],
  ['hourlyEveningRate', 50], ['hourlyExternalDayRate', 20], ['hourlyExternalEveningRate', 30],
  ['isComplex', 1], ['showsPlanningCard', 1],
]) {
  test(`${column} alone counts as a setting the purge resets`, () => {
    assert.equal(countHourlySettings(db([[1, { [column]: value }]])), 1);
  });
}

test('untouched resources are not announced, and what is announced is exactly what the purge resets', () => {
  const d = db([[1, {}], [2, { heatUpMinutes: 240 }], [3, { isComplex: 1, hourlyEveningStart: '20:00' }]]);
  assert.equal(countHourlySettings(d), 2);
  resetHourlyColumns(d);
  assert.equal(countHourlySettings(d), 0);
});

test('a base without the resources table announces nothing', () => {
  assert.equal(countHourlySettings(new Database(':memory:')), 0);
});
