// specs/plugin-removal-resilience.md rule 19 — only the tables of the plugins a tree ships are compared.
// specs/self-update-and-releases.md rule 44 — the tables the plugins of v3.18.0 own keep every column on
// a current install (the core floor of rule 39 excludes them: a fresh core install does not have them).
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const pluginFloor = require('./fixtures/rollback-floor-v3.18.0-plugin-tables.json');
const { applyPluginSchema, listPlugins } = require('../plugins/sdk/testing');

// The plugin that creates each table of the floor: a tree without a plugin (specs/plugin-removal-resilience.md
// rules 4, 5) has no such table to keep, so its tables leave the comparison.
const OWNER = {
  airbnb_intakes: 'airbnb-intake',
  booking_intakes: 'booking-intake',
  booking_dismissals: 'booking-intake',
  gate_key_results: 'gate-access',
  gate_connector_state: 'gate-access',
  gdf_intakes: 'gites-de-france-intake',
  resource_bookings: 'hourly-resources',
  laundry_trip_skips: 'linen',
  laundry_trip_manual_additions: 'linen',
  laundry_extra_trips: 'linen',
  neat_subscriptions: 'neat',
  neat_price_cache: 'neat',
  school_holidays: 'school-holidays',
  school_holidays_sync_state: 'school-holidays',
  tariff_recipe_runs: 'tariff-recipes',
  weather_vigilance_cache: 'weather-alerts',
};


test('rule 44 - every column of the v3.18.0 plugin-owned tables survives the current plugin migrations', () => {
  require('../plugins').forEach((mod) => applyPluginSchema(db, mod.id));
  const lost = [];
  const shipped = listPlugins();
  for (const [table, columns] of Object.entries(pluginFloor).filter(([table]) => shipped.includes(OWNER[table]))) {
    const have = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (have.length === 0) lost.push(`${table} (table)`);
    for (const column of columns) if (!have.includes(column)) lost.push(`${table}.${column}`);
  }
  assert.deepEqual(lost, []);
});

test('rule 44 - the floor lists the 16 plugin tables of v3.18.0', () => {
  assert.equal(Object.keys(pluginFloor).length, 16);
});

test('rule 44 - every table of the floor has an owning plugin', () => {
  assert.deepEqual(Object.keys(pluginFloor).filter((table) => !OWNER[table]), []);
});
