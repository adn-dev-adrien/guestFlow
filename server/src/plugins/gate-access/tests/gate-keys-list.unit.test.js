// The list of gate keys Sowel reads — specs/gate-access-sowel-connector.md §3.1.
//
// Every date below is a UTC instant: that is what the server compares. The fixture stay arrives on
// 2026-10-01 at 15:00 Paris (13:00Z) and leaves on 2026-10-04 at 10:00 Paris: its key opens 3 h
// before check-in (10:00Z) and closes 2 h after check-out (12:00 Paris = 10:00Z).

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, addStay } = require('./gateKeysFixtures');
const { buildKeyList, keyLabel } = require('../keys');
const { buildController } = require('../controller');

const at = (iso) => new Date(iso);
const ids = (list, action) => list.keys.filter((k) => k.action === action).map((k) => k.reservationId);

// specs/gate-access-sowel-connector.md §3.1 rule 2 — the J-7 boundary, to the millisecond.
test('a stay enters the list exactly 7 days before its key opens', () => {
  const { db, model } = freshDb();
  const stay = addStay(db);
  assert.deepEqual(ids(buildKeyList(model, at('2026-09-24T09:59:59.999Z')), 'create'), []);
  assert.deepEqual(ids(buildKeyList(model, at('2026-09-24T10:00:00.000Z')), 'create'), [String(stay.id)]);
});

// specs/gate-access-sowel-connector.md §3.1 rule 2 + rule 4 — the wire shape of a create.
test('a create carries the reservation id as a string, the label and the Paris window in UTC', () => {
  const { db, model } = freshDb();
  const stay = addStay(db, { reservationNumber: 'R-2026-041' });
  const list = buildKeyList(model, at('2026-09-27T18:00:00.000Z'));
  assert.equal(list.now, '2026-09-27T18:00:00.000Z');
  assert.deepEqual(list.keys, [{
    reservationId: String(stay.id),
    action: 'create',
    label: 'Gîte · R-2026-041 · Marie',
    startsAt: '2026-10-01T10:00:00.000Z',
    endsAt: '2026-10-04T10:00:00.000Z',
  }]);
});

// specs/gate-access-sowel-connector.md §3.1 rule 2 — booked late.
test('a stay booked less than 7 days ahead is listed at once, and so is one already under way', () => {
  const { db, model } = freshDb();
  const tomorrow = addStay(db, { startDate: '2026-09-28', endDate: '2026-09-30' });
  const underWay = addStay(db, { startDate: '2026-09-25', endDate: '2026-09-29' });
  const list = buildKeyList(model, at('2026-09-27T18:00:00.000Z'));
  assert.deepEqual(ids(list, 'create').sort(), [String(tomorrow.id), String(underWay.id)].sort());
});

// specs/gate-access-sowel-connector.md §3.1 rule 7 — ended stays are never listed.
test('a stay whose window has ended is not listed, up to the 2 extra hours after check-out', () => {
  const { db, model } = freshDb();
  const stay = addStay(db, { startDate: '2026-09-24', endDate: '2026-09-27' });
  // 10:00 Paris + 2 h = 10:00Z on 2026-09-27.
  assert.deepEqual(ids(buildKeyList(model, at('2026-09-27T09:59:59.000Z')), 'create'), [String(stay.id)]);
  assert.deepEqual(buildKeyList(model, at('2026-09-27T10:00:00.000Z')).keys, []);
});

// specs/gate-access-sowel-connector.md §3.1 rule 2 — never a devis.
test('a devis is not a stay', () => {
  const { db, model } = freshDb();
  addStay(db, { kind: 'devis' });
  assert.deepEqual(buildKeyList(model, at('2026-09-27T18:00:00.000Z')).keys, []);
});

// specs/gate-access-sowel-connector.md §3.1 rule 3 — dates moved after the key was made.
test('a stay that may hold a key stays listed with its new dates, even beyond 7 days', () => {
  const { db, model } = freshDb();
  const stay = addStay(db);
  model.upsertResult({ reservationId: stay.id, action: 'create', ok: true, state: 'not_yet', code: 'A', receivedAt: '2026-09-27T17:00:00Z' });
  db.prepare("UPDATE reservations SET startDate = '2026-11-10', endDate = '2026-11-12' WHERE id = ?").run(stay.id);

  const list = buildKeyList(model, at('2026-09-27T18:00:00.000Z'));
  assert.equal(list.keys.length, 1);
  assert.equal(list.keys[0].action, 'create');
  // 2026-11-10 is winter time: 15:00 Paris = 14:00Z, minus 3 h.
  assert.equal(list.keys[0].startsAt, '2026-11-10T11:00:00.000Z');

  // A key already revoked does not count: the stay is back under the J-7 rule.
  model.upsertResult({ reservationId: stay.id, action: 'revoke', ok: true, state: 'revoked', receivedAt: '2026-09-27T17:30:00Z' });
  assert.deepEqual(buildKeyList(model, at('2026-09-27T18:00:00.000Z')).keys, []);
});

// specs/gate-access-sowel-connector.md §3.1 rule 6 — a cancellation revokes only when a key may exist.
test('a cancelled stay is revoked only when guestFlow holds a result that is not a successful revoke', () => {
  const { db, model } = freshDb();
  const never = addStay(db, { kind: 'cancelled' });
  const created = addStay(db, { kind: 'cancelled', clientId: 2, propertyId: 2 });
  const failed = addStay(db, { kind: 'cancelled' });
  const revoked = addStay(db, { kind: 'cancelled' });
  model.upsertResult({ reservationId: created.id, action: 'create', ok: true, state: 'not_yet', code: 'A', receivedAt: '2026-09-27T17:00:00Z' });
  model.upsertResult({ reservationId: failed.id, action: 'create', ok: false, error: 'unknown_profile', receivedAt: '2026-09-27T17:00:00Z' });
  model.upsertResult({ reservationId: revoked.id, action: 'revoke', ok: true, state: 'revoked', receivedAt: '2026-09-27T17:00:00Z' });

  const list = buildKeyList(model, at('2026-09-27T18:00:00.000Z'));
  assert.deepEqual(ids(list, 'create'), []);
  assert.deepEqual(ids(list, 'revoke').sort(), [String(created.id), String(failed.id)].sort());
  assert.ok(!ids(list, 'revoke').includes(String(never.id)));
  const revoke = list.keys.find((k) => k.reservationId === String(created.id));
  assert.equal(revoke.label, `Lodge · ${created.reservationNumber} · Paul`);
  assert.equal(revoke.endsAt, '2026-10-04T10:00:00.000Z');
});

// specs/gate-access-sowel-connector.md §3.1 rule 6 — a failed revoke is listed again.
test('a revoke that failed is listed again', () => {
  const { db, model } = freshDb();
  const stay = addStay(db, { kind: 'cancelled' });
  model.upsertResult({ reservationId: stay.id, action: 'revoke', ok: false, error: 'internal_error', receivedAt: '2026-09-27T17:00:00Z' });
  assert.deepEqual(ids(buildKeyList(model, at('2026-09-27T18:00:00.000Z')), 'revoke'), [String(stay.id)]);
});

// specs/gate-access-sowel-connector.md §3.1 rule 6 + §3.2 rule 9 — a deleted stay, from the stored window.
test('a deleted stay is revoked with the window stored with its last result', () => {
  const { db, model } = freshDb();
  const stay = addStay(db, { reservationNumber: 'R-2026-050' });
  model.upsertResult({
    reservationId: stay.id, action: 'create', ok: true, state: 'not_yet', code: 'A',
    label: 'Gîte · R-2026-050 · Marie', startsAt: '2026-10-01T13:00:00.000Z', endsAt: '2026-10-04T09:00:00.000Z',
    receivedAt: '2026-09-27T17:00:00Z',
  });
  db.prepare('DELETE FROM reservations WHERE id = ?').run(stay.id);

  assert.deepEqual(buildKeyList(model, at('2026-09-27T18:00:00.000Z')).keys, [{
    reservationId: String(stay.id),
    action: 'revoke',
    label: 'Gîte · R-2026-050 · Marie',
    startsAt: '2026-10-01T13:00:00.000Z',
    endsAt: '2026-10-04T09:00:00.000Z',
  }]);
});

// specs/gate-access-sowel-connector.md §3.1 rule 7 — an ended stay is not revoked either.
test('a cancelled or deleted stay whose window has ended is not revoked', () => {
  const { db, model } = freshDb();
  const cancelled = addStay(db, { kind: 'cancelled', startDate: '2026-09-20', endDate: '2026-09-22' });
  model.upsertResult({ reservationId: cancelled.id, action: 'create', ok: true, code: 'A', receivedAt: '2026-09-19T00:00:00Z' });
  model.upsertResult({
    reservationId: 9999, action: 'create', ok: true, code: 'B', label: 'Gîte · X · Y',
    startsAt: '2026-09-20T13:00:00.000Z', endsAt: '2026-09-22T09:00:00.000Z', receivedAt: '2026-09-19T00:00:00Z',
  });
  assert.deepEqual(buildKeyList(model, at('2026-09-27T18:00:00.000Z')).keys, []);
});

// specs/gate-access-sowel-connector.md §3.1 rule 5 — the label.
test('the label is property · number · first name, never the family name', () => {
  assert.equal(
    keyLabel({ id: 7, propertyName: 'Gîte', reservationNumber: 'R-2026-041', clientFirstName: 'Marie', clientLastName: 'Durand' }),
    'Gîte · R-2026-041 · Marie',
  );
  // No number yet: the id stands in, so the label is never empty.
  assert.equal(keyLabel({ id: 7, propertyName: 'Lodge', reservationNumber: null, clientFirstName: ' Paul ' }), 'Lodge · #7 · Paul');
});

// specs/gate-access-sowel-connector.md §3.1 rule 8 — the read is stamped.
test('every successful read of the list records lastReadAt', () => {
  const { model } = freshDb();
  const controller = buildController({ model: () => model, clock: () => at('2026-09-27T18:00:00.000Z') });
  let payload = null;
  controller.keys({}, { json(body) { payload = body; return this; } });
  assert.deepEqual(payload, { now: '2026-09-27T18:00:00.000Z', keys: [] });
  assert.equal(model.readState().lastReadAt, '2026-09-27T18:00:00.000Z');
});
