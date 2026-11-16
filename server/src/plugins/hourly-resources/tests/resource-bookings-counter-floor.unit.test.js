// specs/plugin-removal-resilience.md rule 22 — an hourly-resources plugin erased then reinstalled does not hand out a booking id a sale still cites.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrationsFor } = require('../migrations');

test('after a reinstall the first booking id is above the highest `resource-booking:<id>` a sale still cites', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE resources (id INTEGER PRIMARY KEY); CREATE TABLE reservations (id INTEGER PRIMARY KEY);
           CREATE TABLE clients (id INTEGER PRIMARY KEY); CREATE TABLE properties (id INTEGER PRIMARY KEY);
           CREATE TABLE standalone_sales (id INTEGER PRIMARY KEY, originRef TEXT);`);
  db.prepare("INSERT INTO standalone_sales (originRef) VALUES ('resource-booking:3'), ('resource-booking:21'), (NULL)").run();
  migrationsFor(() => 20).forEach((m) => m.up(db));
  db.pragma('foreign_keys = OFF');
  const id = db.prepare("INSERT INTO resource_bookings (resourceId, date, startTime, endTime) VALUES (1, '2026-11-02', '10:00', '11:00')").run().lastInsertRowid; // date-literal-ok — fixture row
  assert.equal(id, 22);
});
