const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { MIGRATIONS } = require('../migrations');
const laundryScheduleModel = require('../laundryScheduleModel');
const { createSchedule } = require('../laundrySchedule');

// specs/linen-laundry-days.md §5 + §3.1 rules 4-5, 24 — the dated versions table and its migration.

const MIGRATION = MIGRATIONS.find((m) => m.name === 'laundry_schedule_v1');

function freshDb({ weekday } = {}) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE plugin_settings (plugin_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (plugin_id, key))');
  if (weekday !== undefined) db.prepare("INSERT INTO plugin_settings (plugin_id, key, value) VALUES ('linen', 'laundryWeekday', ?)").run(weekday);
  return db;
}
const rows = (db) => db.prepare('SELECT effectiveFrom, weekdays, turnaroundDays FROM laundry_schedule_versions ORDER BY effectiveFrom').all();

test('specs/linen-laundry-days.md §3.1 rule 4: the migration turns laundryWeekday W into { [W], 1 day } effective from the beginning of time', () => {
  for (const [stored, expected] of [['2', '2'], ['5', '5'], ['0', '0'], ['6', '6']]) {
    const db = freshDb({ weekday: stored });
    MIGRATION.up(db);
    assert.deepEqual(rows(db), [{ effectiveFrom: '0001-01-01', weekdays: expected, turnaroundDays: 1 }], stored);
  }
});

test('specs/linen-laundry-days.md §3.1 rule 4: an absent, empty or invalid laundryWeekday seeds Tuesday', () => {
  for (const stored of [undefined, '', '  ', '9', '-1', 'mardi', '2.5']) {
    const db = freshDb({ weekday: stored });
    MIGRATION.up(db);
    assert.deepEqual(rows(db), [{ effectiveFrom: '0001-01-01', weekdays: '2', turnaroundDays: 1 }], String(stored));
  }
});

test('specs/linen-laundry-days.md §5: the migration is idempotent and never seeds over an existing version', () => {
  const db = freshDb({ weekday: '5' });
  MIGRATION.up(db);
  MIGRATION.up(db);
  assert.equal(rows(db).length, 1);
  db.prepare("INSERT INTO laundry_schedule_versions (effectiveFrom, weekdays, turnaroundDays) VALUES ('2026-06-10', '2,4', 2)").run();
  db.prepare("UPDATE plugin_settings SET value = '3' WHERE key = 'laundryWeekday'").run();
  MIGRATION.up(db);
  assert.equal(rows(db).length, 2);
  assert.equal(rows(db)[0].weekdays, '5');
});

test('specs/linen-laundry-days.md §5: the table refuses a malformed date and a turnaround outside 1..14', () => {
  const db = freshDb();
  MIGRATION.up(db);
  const insert = db.prepare('INSERT INTO laundry_schedule_versions (effectiveFrom, weekdays, turnaroundDays) VALUES (?, ?, ?)');
  assert.throws(() => insert.run('2026-6-1', '2', 1));
  assert.throws(() => insert.run('2026-06-10', '2', 0));
  assert.throws(() => insert.run('2026-06-10', '2', 15));
});

test('specs/linen-laundry-days.md §3.1 rule 4: the model reads the migrated version back as a schedule where every figure is unchanged', () => {
  const db = freshDb({ weekday: '4' });
  MIGRATION.up(db);
  const model = laundryScheduleModel.create(db);
  assert.deepEqual(model.listAll(), [{ effectiveFrom: '0001-01-01', weekdays: [4], turnaroundDays: 1 }]);
  const schedule = createSchedule(model.listAll());
  assert.equal(schedule.isRegularDay('2026-06-04'), true);
  assert.equal(schedule.isRegularDay('2026-06-02'), false);
  assert.equal(schedule.readyFrom('2026-06-04'), '2026-06-05');
});

test('specs/linen-laundry-days.md §3.1 rule 5: upsert writes a version, overwrites the same date, and keeps versions ordered', () => {
  const db = freshDb();
  MIGRATION.up(db);
  const model = laundryScheduleModel.create(db);
  model.upsert('2026-06-10', { weekdays: [4, 2], turnaroundDays: 2 });
  assert.deepEqual(model.listAll()[1], { effectiveFrom: '2026-06-10', weekdays: [2, 4], turnaroundDays: 2 });
  model.upsert('2026-06-10', { weekdays: [1], turnaroundDays: 5 });
  assert.equal(model.listAll().length, 2);
  assert.deepEqual(model.listAll()[1], { effectiveFrom: '2026-06-10', weekdays: [1], turnaroundDays: 5 });
  model.upsert('2026-05-01', { weekdays: [3], turnaroundDays: 1 });
  assert.deepEqual(model.listAll().map((v) => v.effectiveFrom), ['0001-01-01', '2026-05-01', '2026-06-10']);
});

test('specs/linen-laundry-days.md §3.1 rule 5: remove deletes one version and is idempotent', () => {
  const db = freshDb();
  MIGRATION.up(db);
  const model = laundryScheduleModel.create(db);
  model.upsert('2026-06-10', { weekdays: [4], turnaroundDays: 1 });
  model.remove('2026-06-10');
  model.remove('2026-06-10');
  assert.deepEqual(model.listAll().map((v) => v.effectiveFrom), ['0001-01-01']);
});

test('specs/linen-laundry-days.md §3.3 rule 24: dropping the table (the purge) and migrating again restarts from { [2], 1 }', () => {
  const db = freshDb({ weekday: '5' });
  MIGRATION.up(db);
  db.exec('DROP TABLE laundry_schedule_versions');
  db.prepare("DELETE FROM plugin_settings WHERE key = 'laundryWeekday'").run();
  MIGRATION.up(db);
  assert.deepEqual(rows(db), [{ effectiveFrom: '0001-01-01', weekdays: '2', turnaroundDays: 1 }]);
});
