#!/usr/bin/env node
/**
 * seed-plugin-data.js — the data every plugin leaves behind, for the removal matrix
 * (specs/plugin-removal-resilience.md rule 11).
 *
 *   DB_PATH=/tmp/x.db REMOVAL_SEED_OUT=/tmp/seed.json node server/scripts/seed-plugin-data.js
 *
 * Runs after `seed-e2e.js` (every plugin installed). Creates one property with a per-hour resource, one
 * client and two stays — a direct one and a platform one — then runs each shipped plugin's own
 * `plugins/<id>/tests/removalSeed.js` (`seed(db, { stays })`, or `seed: null` with a `reason`). Writes
 * the stays and, for every plugin, the row count of each table it erases, so a removal run can prove
 * the rows were left untouched after the plugin's code is gone.
 *
 * A plugin whose seed is missing or throws fails the whole script, naming it: it never seeds less.
 */

const fs = require('fs');
const path = require('path');
const db = require('../src/database');
const loader = require('../src/plugins/loader');
const registry = require('../src/plugins/sdk/registry');
const { listPlugins } = require('../src/plugins/sdk/testing');
const pluginsModel = require('../src/models/pluginsModel');
const { PLUGIN_CATALOG } = require('../src/constants/plugins');

const PLUGINS_DIR = path.join(__dirname, '..', 'src', 'plugins');
const OUT = process.env.REMOVAL_SEED_OUT;

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function seedCore() {
  const propertyId = db.prepare("INSERT INTO properties (name) VALUES ('Gîte du retrait')").run().lastInsertRowid;
  const clientId = db.prepare("INSERT INTO clients (firstName, lastName, email) VALUES ('Camille', 'Retrait', 'camille.retrait@example.test')").run().lastInsertRowid;
  const resourceId = db.prepare(`INSERT INTO resources (name, quantity, price, priceType, propertyId, isComplex)
    VALUES ('Bain nordique', 1, 30, 'per_hour', ?, 1)`).run(propertyId).lastInsertRowid;
  const stay = (platform, offset) => {
    const startDate = addDays(offset);
    const id = db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, adults, platform, kind, totalPrice, finalPrice,
        depositAmount, depositDueDate, balanceAmount, balanceDueDate, reservationNumber)
      VALUES (?, ?, ?, ?, 2, ?, 'reservation', 630, 630, 189, ?, 441, ?, ?)`)
      .run(propertyId, clientId, startDate, addDays(offset + 3), platform, addDays(offset - 20), addDays(offset - 7), `RET-${platform}`).lastInsertRowid;
    return { id: Number(id), propertyId: Number(propertyId), clientId: Number(clientId), resourceId: Number(resourceId), startDate };
  };
  const stays = { direct: stay('direct', 30), platform: stay('booking', 60) };
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, sessions)
    VALUES (?, ?, 1, 30, 1, 'per_hour', 30, ?)`).run(stays.direct.id, resourceId, JSON.stringify([{ date: stays.direct.startDate, startTime: '18:00', endTime: '19:00' }]));
  return stays;
}

function seedPlugins(stays) {
  const skipped = {};
  listPlugins().forEach((id) => {
    const file = path.join(PLUGINS_DIR, id, 'tests', 'removalSeed.js');
    if (!fs.existsSync(file)) throw new Error(`[seed-plugin-data] ${id}: tests/removalSeed.js is missing`);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const mod = require(file);
    if (mod.seed === null) {
      if (!mod.reason) throw new Error(`[seed-plugin-data] ${id}: seed is null without a reason`);
      skipped[id] = mod.reason;
      return;
    }
    try {
      db.transaction(() => mod.seed(db, { stays }))();
    } catch (err) {
      throw new Error(`[seed-plugin-data] ${id}: ${err.message}`);
    }
  });
  return skipped;
}

function countRows() {
  loader.registerAll({ db });
  const counts = {};
  registry.all().forEach((record) => {
    const tables = (record.data && record.data.tables) || [];
    counts[record.id] = Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));
  });
  return counts;
}

// A running release stores each bundled plugin's manifest in its row at boot; the cell's server never
// booted with the plugin, so the seed does it — the Plugins page then names a removed plugin.
function storeManifests() {
  PLUGIN_CATALOG.forEach((manifest) => pluginsModel.syncBundled(manifest.id, manifest, null));
}

try {
  storeManifests();
  const stays = seedCore();
  const skipped = seedPlugins(stays);
  const rows = countRows();
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ stays, rows, skipped }, null, 2));
  const seeded = Object.values(rows).reduce((n, tables) => n + Object.values(tables).reduce((a, b) => a + b, 0), 0);
  console.log(`[seed-plugin-data] ${listPlugins().length - Object.keys(skipped).length} plugin(s) seeded, ${seeded} plugin row(s), ${Object.keys(skipped).length} without a table.`);
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
