// The `stay` block every gate key carries — contract v3, specs/sowel-stays-in-keys.md, written down
// as specs/gate-access-sowel-connector.md §3.1 rule 4b.
//
// `arrival` / `departure` are the stay's own check-in / check-out on the Europe/Paris wall clock,
// sent with their numeric offset: 2026-10-25 is the last Sunday of October, the night Paris goes
// from +02:00 to +01:00.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { freshDb, addStay, fakePush, silent } = require('./gateKeysFixtures');
const { buildKeyList } = require('../utils/gateKeys');
const { receiveResults } = require('../utils/gateResults');
const { toParisIso } = require('../utils/gateWindow');
const { migratePropertyId } = require('../models/gateKeysModel');

const at = (iso) => new Date(iso);
const NOW = at('2026-09-27T18:00:00.000Z');
const keyOf = (list, reservationId) => list.keys.find((k) => k.reservationId === String(reservationId));

test('a Paris instant is written with the offset the zone had at that instant', () => {
  assert.equal(toParisIso(at('2026-10-06T14:00:00.000Z')), '2026-10-06T16:00:00+02:00');
  assert.equal(toParisIso(at('2026-10-27T09:00:00.000Z')), '2026-10-27T10:00:00+01:00');
  // Either side of 03:00 summer time on 2026-10-25, which is 01:00Z.
  assert.equal(toParisIso(at('2026-10-25T00:59:00.000Z')), '2026-10-25T02:59:00+02:00');
  assert.equal(toParisIso(at('2026-10-25T01:00:00.000Z')), '2026-10-25T02:00:00+01:00');
  assert.equal(toParisIso(new Date(NaN)), null);
});

// specs/gate-access-sowel-connector.md §3.1 rule 4b — the wire shape of a create, v0.3.0 fields untouched.
test('a create carries the stay: property id and name, arrival and departure without the margins', () => {
  const { db, model } = freshDb();
  const stay = addStay(db, { propertyId: 2, clientId: 2, reservationNumber: 'R-2026-060', startDate: '2026-10-06', endDate: '2026-10-09', checkInTime: '16:00' });
  assert.deepEqual(buildKeyList(model, at('2026-10-02T12:00:00.000Z')).keys, [{
    reservationId: String(stay.id),
    action: 'create',
    label: 'Lodge · R-2026-060 · Paul',
    startsAt: '2026-10-06T11:00:00.000Z',
    endsAt: '2026-10-09T10:00:00.000Z',
    stay: { propertyId: 2, propertyName: 'Lodge', arrival: '2026-10-06T16:00:00+02:00', departure: '2026-10-09T10:00:00+02:00' },
  }]);
});

// specs/gate-access-sowel-connector.md §3.1 rule 4b — each stay's own times, not the defaults.
test('the stay honours the reservation check-in and check-out times, and falls back on 15:00 / 10:00', () => {
  const { db, model } = freshDb();
  const late = addStay(db, { checkInTime: '17:30', checkOutTime: '11:15' });
  const blank = addStay(db, { propertyId: 2, checkInTime: '', checkOutTime: '' });
  const list = buildKeyList(model, NOW);
  assert.deepEqual(keyOf(list, late.id).stay, {
    propertyId: 1, propertyName: 'Gîte', arrival: '2026-10-01T17:30:00+02:00', departure: '2026-10-04T11:15:00+02:00',
  });
  assert.deepEqual(keyOf(list, blank.id).stay, {
    propertyId: 2, propertyName: 'Lodge', arrival: '2026-10-01T15:00:00+02:00', departure: '2026-10-04T10:00:00+02:00',
  });
});

// specs/gate-access-sowel-connector.md §3.1 rule 4b — a stay across the last Sunday of October.
test('a stay spanning 2026-10-25 arrives in summer time and leaves in winter time', () => {
  const { db, model } = freshDb();
  const stay = addStay(db, { startDate: '2026-10-23', endDate: '2026-10-27' });
  const key = keyOf(buildKeyList(model, at('2026-10-20T12:00:00.000Z')), stay.id);
  assert.equal(key.stay.arrival, '2026-10-23T15:00:00+02:00');
  assert.equal(key.stay.departure, '2026-10-27T10:00:00+01:00');
  // The gate window around it is unchanged: still −3 h / +2 h on the real instants.
  assert.equal(key.startsAt, '2026-10-23T10:00:00.000Z');
  assert.equal(key.endsAt, '2026-10-27T11:00:00.000Z');
});

// specs/gate-access-sowel-connector.md §3.1 rule 4b — a cancelled stay still has its row.
test('the revoke of a cancelled stay carries the stay read from the reservation', () => {
  const { db, model } = freshDb();
  const stay = addStay(db, { propertyId: 2, kind: 'cancelled', checkInTime: '16:00' });
  model.upsertResult({ reservationId: stay.id, action: 'create', ok: true, state: 'not_yet', code: 'A', receivedAt: '2026-09-27T17:00:00Z' });
  const key = keyOf(buildKeyList(model, NOW), stay.id);
  assert.equal(key.action, 'revoke');
  assert.deepEqual(key.stay, {
    propertyId: 2, propertyName: 'Lodge', arrival: '2026-10-01T16:00:00+02:00', departure: '2026-10-04T10:00:00+02:00',
  });
});

// specs/gate-access-sowel-connector.md §3.1 rules 4b and 6 — a deleted stay, rebuilt from the results table.
test('the revoke of a deleted stay rebuilds its stay from the stored window and property, across DST', async () => {
  const { db, model } = freshDb();
  const stay = addStay(db, { propertyId: 2, clientId: 2, reservationNumber: 'R-2026-070', startDate: '2026-10-23', endDate: '2026-10-27', checkInTime: '16:00', checkOutTime: '11:00' });
  const now = at('2026-10-20T12:00:00.000Z');
  const before = keyOf(buildKeyList(model, now), stay.id);

  // The house files its outcome: the window AND the property are stored with it.
  const { status } = await receiveResults(
    { model, pushService: fakePush(), logger: silent, now },
    { results: [{ reservationId: String(stay.id), action: 'create', ok: true, state: 'not_yet', code: 'A' }] },
  );
  assert.equal(status, 200);
  assert.equal(model.get(stay.id).propertyId, 2);

  db.prepare('DELETE FROM reservations WHERE id = ?').run(stay.id);
  const key = keyOf(buildKeyList(model, now), stay.id);
  assert.equal(key.action, 'revoke');
  assert.equal(key.label, 'Lodge · R-2026-070 · Paul');
  assert.deepEqual(key.stay, before.stay);
  assert.deepEqual(key.stay, {
    propertyId: 2, propertyName: 'Lodge', arrival: '2026-10-23T16:00:00+02:00', departure: '2026-10-27T11:00:00+01:00',
  });
});

// specs/gate-access-sowel-connector.md §3.1 rule 4b — the block is optional, never invented.
test('a deleted stay filed before propertyId existed is revoked without a stay block', () => {
  const { db, model } = freshDb();
  const stay = addStay(db);
  model.upsertResult({
    reservationId: stay.id, action: 'create', ok: true, state: 'not_yet', code: 'A',
    label: 'Gîte · R-2026-050 · Marie', startsAt: '2026-10-01T10:00:00.000Z', endsAt: '2026-10-04T10:00:00.000Z',
    receivedAt: '2026-09-27T17:00:00Z',
  });
  db.prepare('DELETE FROM reservations WHERE id = ?').run(stay.id);

  const key = keyOf(buildKeyList(model, NOW), stay.id);
  assert.equal(key.action, 'revoke');
  assert.equal(key.endsAt, '2026-10-04T10:00:00.000Z');
  assert.equal('stay' in key, false);
});

// specs/gate-access-sowel-connector.md §3.1 rule 4b — a property that no longer exists names nothing.
test('a deleted stay whose property is gone too is revoked without a stay block', () => {
  const { db, model } = freshDb();
  const stay = addStay(db);
  model.upsertResult({
    reservationId: stay.id, action: 'create', ok: true, state: 'not_yet', code: 'A',
    label: 'Gîte · x · Marie', startsAt: '2026-10-01T10:00:00.000Z', endsAt: '2026-10-04T10:00:00.000Z',
    propertyId: 99, receivedAt: '2026-09-27T17:00:00Z',
  });
  db.prepare('DELETE FROM reservations WHERE id = ?').run(stay.id);
  assert.equal('stay' in keyOf(buildKeyList(model, NOW), stay.id), false);
});

// specs/gate-access-sowel-connector.md §3.2 rule 9 — a result without a stay keeps the stored property.
test('a later result that carries no property does not erase the stored one', () => {
  const { db, model } = freshDb();
  const stay = addStay(db, { propertyId: 2 });
  model.upsertResult({ reservationId: stay.id, action: 'create', ok: true, propertyId: 2, receivedAt: '2026-09-27T17:00:00Z' });
  model.upsertResult({ reservationId: stay.id, action: 'create', ok: false, error: 'internal_error', receivedAt: '2026-09-27T18:00:00Z' });
  assert.equal(model.get(stay.id).propertyId, 2);
});

test('the migration adds propertyId to an older table and backfills it from live reservations only', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL);
    CREATE TABLE gate_key_results (
      reservationId INTEGER PRIMARY KEY, action TEXT NOT NULL, ok INTEGER NOT NULL, state TEXT, code TEXT,
      url TEXT, error TEXT, message TEXT, label TEXT, startsAt TEXT, endsAt TEXT,
      receivedAt TEXT NOT NULL, alertedError TEXT
    );
    INSERT INTO reservations (id, propertyId) VALUES (1, 2);
    INSERT INTO gate_key_results (reservationId, action, ok, receivedAt) VALUES (1, 'create', 1, 'x'), (2, 'create', 1, 'x');
  `);

  assert.equal(migratePropertyId(db), 1);
  const rows = db.prepare('SELECT reservationId, propertyId FROM gate_key_results ORDER BY reservationId').all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ reservationId: 1, propertyId: 2 }, { reservationId: 2, propertyId: null }]);
  // Idempotent: a second start finds nothing left to fill.
  assert.equal(migratePropertyId(db), 0);
});
