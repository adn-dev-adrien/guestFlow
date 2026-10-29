// specs/self-update-and-releases.md rule 44 — the tables the plugins of v3.18.0 own keep every column on
// a current install (the core floor of rule 39 excludes them: a fresh core install does not have them).
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const pluginFloor = require('./fixtures/rollback-floor-v3.18.0-plugin-tables.json');
const { applyPluginSchema } = require('../plugins/sdk/testing');

test('rule 44 - every column of the v3.18.0 plugin-owned tables survives the current plugin migrations', () => {
  require('../plugins').forEach((mod) => applyPluginSchema(db, mod.id));
  const lost = [];
  for (const [table, columns] of Object.entries(pluginFloor)) {
    const have = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (have.length === 0) lost.push(`${table} (table)`);
    for (const column of columns) if (!have.includes(column)) lost.push(`${table}.${column}`);
  }
  assert.deepEqual(lost, []);
});

test('rule 44 - the floor lists the 16 plugin tables of v3.18.0', () => {
  assert.equal(Object.keys(pluginFloor).length, 16);
});
