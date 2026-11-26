// specs/plugins/plugin-removal-resilience.md rule 22 — a guest app erased then reinstalled does not hand out an order id a stay line still cites.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { MIGRATIONS } = require('../migrations');

const run = (db) => MIGRATIONS.forEach((m) => m.up(db));

test('after a reinstall the first order id is above the highest `order:<id>:<n>` a line still cites', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE reservation_options (lineId INTEGER PRIMARY KEY, orderRef TEXT);
           CREATE TABLE reservation_custom_options (lineId INTEGER PRIMARY KEY, orderRef TEXT);`);
  db.prepare("INSERT INTO reservation_options (orderRef) VALUES ('order:4:1'), (NULL)").run();
  db.prepare("INSERT INTO reservation_custom_options (orderRef) VALUES ('order:17:102')").run();
  run(db);
  const id = db.prepare("INSERT INTO guest_orders (reservationId, payment, status, linesJson, total, createdAt) VALUES (1, 'none', 'confirmed', '[]', 0, '2026-11-01')").run().lastInsertRowid; // date-literal-ok — fixture row
  assert.equal(id, 18);
  run(db);
});

test('a fresh install with no cited order starts at 1', () => {
  const db = new Database(':memory:');
  run(db);
  const id = db.prepare("INSERT INTO guest_orders (reservationId, payment, status, linesJson, total, createdAt) VALUES (1, 'none', 'confirmed', '[]', 0, '2026-11-01')").run().lastInsertRowid; // date-literal-ok — fixture row
  assert.equal(id, 1);
});

// Loop t2 D2-2 — an unpaid card order is cited by its payment link only (specs/guest-app/guest-app.md rule 108): the reinstall restarts above it too.
test('after a reinstall the first order id is above the order an open card link still names', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE reservation_options (lineId INTEGER PRIMARY KEY, orderRef TEXT);
           CREATE TABLE payment_links (id INTEGER PRIMARY KEY, basketJson TEXT);`);
  db.prepare("INSERT INTO reservation_options (orderRef) VALUES ('order:10:1')").run();
  db.prepare('INSERT INTO payment_links (basketJson) VALUES (?), (?), (?), (NULL)').run(JSON.stringify({ source: 'guestOrder', ref: 12 }), JSON.stringify({ source: 'shopOrder', ref: '40' }), 'not json');
  run(db);
  const id = db.prepare("INSERT INTO guest_orders (reservationId, payment, status, linesJson, total, createdAt) VALUES (1, 'none', 'confirmed', '[]', 0, '2026-11-01')").run().lastInsertRowid; // date-literal-ok — fixture row
  assert.equal(id, 13);
});
