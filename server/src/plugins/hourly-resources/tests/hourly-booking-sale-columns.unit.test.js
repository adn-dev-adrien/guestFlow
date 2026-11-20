// the outside-visit spec (outside-booking-sas) rules 27 and 34 — migration `resource_bookings_v6`: `saleRef` and `noShowAt`, additive, NULL on every booking
// stored before, a second run changes nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrationsFor, bookingsV6 } = require('../migrations');

test('resource_bookings_v6 is registered after v5 and adds the two columns as NULL', () => {
  const names = migrationsFor(() => 20).map((m) => m.name);
  assert.ok(names.indexOf('resource_bookings_v6') > names.indexOf('resource_bookings_v5'));
  const db = new Database(':memory:');
  db.exec('CREATE TABLE resource_bookings (id INTEGER PRIMARY KEY, reservationId INTEGER)');
  db.prepare('INSERT INTO resource_bookings (id) VALUES (1)').run();
  bookingsV6(db);
  assert.deepEqual(db.prepare('SELECT saleRef, noShowAt FROM resource_bookings WHERE id = 1').get(), { saleRef: null, noShowAt: null });
  bookingsV6(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pragma_table_info(\'resource_bookings\') WHERE name IN (\'saleRef\', \'noShowAt\')').get().n, 2);
});

test('a database with no resource_bookings table is left alone', () => {
  assert.doesNotThrow(() => bookingsV6(new Database(':memory:')));
});
