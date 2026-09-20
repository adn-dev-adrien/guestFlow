// The stay feed published to the house — specs/gate-access-sowel-connector.md §3.1, rules 1-8.
//
// What is pinned here is the property that motivated computing it on read: NO write path calls
// this module, and yet nothing can escape it — a creation, a date change, a cancellation, a
// deletion, a hand-made fix in the database. The previous version hooked six paths and its own
// test plan admitted two of them had « nothing to hook ».

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const createGateStayFeed = require('../utils/gateStayFeed');

const DDL = `
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    reservationNumber TEXT, clientId INTEGER, propertyId INTEGER,
    startDate TEXT, endDate TEXT, checkInTime TEXT, checkOutTime TEXT
  );
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT);
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE gate_stay_feed (
    revision INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    state TEXT NOT NULL,
    payload TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

function setup() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Dupont')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Le Gîte')").run();
  return { db, feed: createGateStayFeed(db) };
}

const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

function insertStay(db, over = {}) {
  const row = {
    reservationNumber: '202609042',
    clientId: 1,
    propertyId: 1,
    startDate: future(5),
    endDate: future(12),
    checkInTime: '16:00',
    checkOutTime: '10:00',
    kind: 'reservation',
    ...over,
  };
  return db.prepare(`
    INSERT INTO reservations (kind, reservationNumber, clientId, propertyId, startDate, endDate, checkInTime, checkOutTime)
    VALUES (@kind, @reservationNumber, @clientId, @propertyId, @startDate, @endDate, @checkInTime, @checkOutTime)
  `).run(row).lastInsertRowid;
}

test('a reservation is published with its window, its lodging and the guest first name', () => {
  const { db, feed } = setup();
  insertStay(db);

  const page = feed.readSince(0);
  assert.equal(page.stays.length, 1);
  const stay = page.stays[0];
  assert.equal(stay.state, 'active');
  assert.equal(stay.property, 'Le Gîte');
  assert.equal(stay.guestName, 'Camille');
  assert.equal(stay.reservationNumber, '202609042');
  assert.ok(stay.startsAt.endsWith('Z'));
  assert.ok(new Date(stay.endsAt) > new Date(stay.startsAt));
  // A family name has no business on an equipment that opens a gate.
  assert.ok(!JSON.stringify(stay).includes('Dupont'));
});

test('reading again publishes nothing new while nothing moves', () => {
  const { db, feed } = setup();
  insertStay(db);
  const first = feed.readSince(0);
  assert.equal(first.stays.length, 1);

  const again = feed.readSince(first.cursor);
  assert.equal(again.stays.length, 0);
  assert.equal(again.cursor, first.cursor);
});

test('a date change publishes a new revision, a higher one', () => {
  const { db, feed } = setup();
  const id = insertStay(db);
  const first = feed.readSince(0);

  db.prepare('UPDATE reservations SET endDate = ? WHERE id = ?').run(future(14), id);
  const next = feed.readSince(first.cursor);
  assert.equal(next.stays.length, 1);
  assert.ok(next.stays[0].revision > first.stays[0].revision);
  assert.ok(new Date(next.stays[0].endsAt) > new Date(first.stays[0].endsAt));
});

test('changing the check-in hour moves the window, so it publishes', () => {
  const { db, feed } = setup();
  const id = insertStay(db);
  const first = feed.readSince(0);
  db.prepare("UPDATE reservations SET checkInTime = '18:00' WHERE id = ?").run(id);
  assert.equal(feed.readSince(first.cursor).stays.length, 1);
});

test('a cancellation is published as such, with no window', () => {
  const { db, feed } = setup();
  const id = insertStay(db);
  const first = feed.readSince(0);

  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(id);
  const next = feed.readSince(first.cursor);
  assert.equal(next.stays[0].state, 'cancelled');
  assert.equal(next.stays[0].startsAt, null);
});

test('a deletion detects itself — nobody hooked anything', () => {
  const { db, feed } = setup();
  const id = insertStay(db);
  const first = feed.readSince(0);

  db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
  const next = feed.readSince(first.cursor);
  assert.equal(next.stays.length, 1);
  assert.equal(next.stays[0].state, 'deleted');
  assert.equal(next.stays[0].reservationId, Number(id));

  // And only once: a deleted row is not republished on every read.
  assert.equal(feed.readSince(next.cursor).stays.length, 0);
});

test('a stay that finished long ago is not announced as deleted', () => {
  const { db, feed } = setup();
  const id = insertStay(db, { startDate: '2020-01-01', endDate: '2020-01-05' });
  // Nothing was ever published for it: it sits outside the watch window.
  assert.equal(feed.readSince(0).stays.length, 0);
  assert.ok(db.prepare('SELECT 1 FROM reservations WHERE id = ?').get(id));
});

test('a stay leaving the watch window is not deleted for all that', () => {
  const { db, feed } = setup();
  const id = insertStay(db);
  const first = feed.readSince(0);
  assert.equal(first.stays.length, 1);

  // It finishes and drifts away: its access ends on its own end date.
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?')
    .run('2019-01-01', '2019-01-05', id);
  const next = feed.readSince(first.cursor);
  assert.equal(next.stays.length, 0);
});

test('a devis is not a stay', () => {
  const { db, feed } = setup();
  insertStay(db, { kind: 'devis' });
  assert.equal(feed.readSince(0).stays.length, 0);
});

test('the page is bounded, and says there is more', () => {
  const { db, feed } = setup();
  for (let i = 0; i < 5; i++) insertStay(db, { reservationNumber: `20260904${i}` });

  const page = feed.readSince(0, 2);
  assert.equal(page.stays.length, 2);
  assert.equal(page.hasMore, true);
  const rest = feed.readSince(page.cursor, 10);
  assert.equal(rest.stays.length, 3);
  assert.equal(rest.hasMore, false);
});

test('the cursor never goes backwards, even read again from zero', () => {
  const { db, feed } = setup();
  const id = insertStay(db);
  feed.readSince(0);
  db.prepare('UPDATE reservations SET endDate = ? WHERE id = ?').run(future(20), id);
  const all = feed.readSince(0, 50);
  const revisions = all.stays.map((s) => s.revision);
  assert.deepEqual(revisions, [...revisions].sort((a, b) => a - b));
});

test('the purge only deletes what is both superseded AND old', () => {
  const { db, feed } = setup();
  const id = insertStay(db);
  feed.readSince(0);
  db.prepare('UPDATE reservations SET endDate = ? WHERE id = ?').run(future(20), id);
  feed.readSince(0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gate_stay_feed').get().n, 2);

  // Nothing is old: the purge touches nothing.
  assert.equal(feed.purge().deleted, 0);

  // Age everything: the superseded row goes, the last one stays — a consumer that has fallen
  // behind must still be able to catch up on the latest state.
  db.prepare("UPDATE gate_stay_feed SET createdAt = '2020-01-01T00:00:00.000Z'").run();
  assert.equal(feed.purge().deleted, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gate_stay_feed').get().n, 1);
});
