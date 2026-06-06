// Selective cleanup popup — backend coverage for `listOrphans()` + `cleanupOrphansByIds()` and the
// matching controller endpoints (`GET /cleanup-orphans/preview`, `POST /cleanup-orphans/delete`).
// See specs/clients.md §3 rule 8 + §4.3.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const clientsModel = require('../models/clientsModel');
const clientsController = require('../controllers/clientsController');

const DDL = `
  CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lastName TEXT NOT NULL,
    firstName TEXT NOT NULL,
    streetNumber TEXT DEFAULT '',
    street TEXT DEFAULT '',
    postalCode TEXT DEFAULT '',
    city TEXT DEFAULT '',
    address TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'reservation',
    devisNumber TEXT, devisStatus TEXT,
    clientId INTEGER,
    startDate TEXT, endDate TEXT, finalPrice REAL
  );
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return { model: clientsModel.create(db), db };
}

function addReservation(db, clientId) {
  db.prepare(`INSERT INTO reservations (kind, clientId, startDate, endDate, finalPrice)
              VALUES ('reservation', ?, '2099-01-01', '2099-01-02', 0)`).run(clientId);
}

function addDevis(db, clientId) {
  db.prepare(`INSERT INTO reservations (kind, clientId, devisNumber, devisStatus, startDate, endDate, finalPrice)
              VALUES ('devis', ?, 'D-1', 'draft', '2099-02-01', '2099-02-02', 0)`).run(clientId);
}

// ---------- listOrphans ----------

test('listOrphans returns only clients with no reservation and no devis, sorted by lastName/firstName', () => {
  const { model, db } = freshModel();
  const orphanB = model.insert({ lastName: 'Bernard', firstName: 'Anne', email: 'b@x', phone: '0611' });
  const orphanA = model.insert({ lastName: 'Albert', firstName: 'Zoé', email: 'a@x', phone: '0622' });
  const withRes = model.insert({ lastName: 'Avec', firstName: 'Res' });
  const withDevis = model.insert({ lastName: 'Avec', firstName: 'Devis' });
  addReservation(db, withRes.id);
  addDevis(db, withDevis.id);

  const orphans = model.listOrphans();
  assert.equal(orphans.length, 2);
  // Sorted Albert, Bernard.
  assert.equal(orphans[0].id, orphanA.id);
  assert.equal(orphans[1].id, orphanB.id);
  // Columns surfaced match the popup needs.
  assert.deepEqual(Object.keys(orphans[0]).sort(), ['email', 'firstName', 'id', 'lastName', 'phone']);
  assert.equal(orphans[0].email, 'a@x');
  assert.equal(orphans[0].phone, '0622');
});

// ---------- cleanupOrphansByIds ----------

test('cleanupOrphansByIds([]) is a no-op', () => {
  const { model } = freshModel();
  model.insert({ lastName: 'Orphan', firstName: 'X' });
  const r = model.cleanupOrphansByIds([]);
  assert.deepEqual(r, { deletedCount: 0, skippedCount: 0 });
  assert.equal(model.listOrphans().length, 1);
});

test('cleanupOrphansByIds deletes orphans, skips clients that gained a reservation', () => {
  const { model, db } = freshModel();
  const orphan = model.insert({ lastName: 'Orphan', firstName: 'X' });
  const withRes = model.insert({ lastName: 'WithRes', firstName: 'Y' });
  addReservation(db, withRes.id);

  const r = model.cleanupOrphansByIds([orphan.id, withRes.id]);
  assert.equal(r.deletedCount, 1);
  assert.equal(r.skippedCount, 1);
  assert.equal(model.findById(orphan.id), undefined);
  assert.ok(model.findById(withRes.id), 'reservation-linked client must remain');
});

test('cleanupOrphansByIds skips devis-linked clients (protected, same filter as bulk)', () => {
  const { model, db } = freshModel();
  const orphan = model.insert({ lastName: 'Orphan', firstName: 'X' });
  const withDevis = model.insert({ lastName: 'WithDevis', firstName: 'Y' });
  addDevis(db, withDevis.id);

  const r = model.cleanupOrphansByIds([orphan.id, withDevis.id]);
  assert.equal(r.deletedCount, 1);
  assert.equal(r.skippedCount, 1);
  assert.equal(model.findById(orphan.id), undefined);
  assert.ok(model.findById(withDevis.id), 'devis-linked client must remain');
});

test('cleanupOrphansByIds with an unknown id counts it as skipped, no error', () => {
  const { model } = freshModel();
  const r = model.cleanupOrphansByIds([4242]);
  assert.deepEqual(r, { deletedCount: 0, skippedCount: 1 });
});

test('cleanupOrphansByIds deduplicates and rejects invalid ids silently', () => {
  const { model } = freshModel();
  const orphan = model.insert({ lastName: 'Orphan', firstName: 'X' });
  // Duplicate id + a non-numeric + a non-positive: dedup → single delete, no skip.
  const r = model.cleanupOrphansByIds([orphan.id, orphan.id, 'abc', 0, -3]);
  assert.equal(r.deletedCount, 1);
  assert.equal(r.skippedCount, 0);
  assert.equal(model.findById(orphan.id), undefined);
});

// ---------- controller ----------

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

test('controller cleanupOrphansPreview returns the orphan array as-is', () => {
  const fakeModel = { listOrphans: () => [{ id: 1, firstName: 'A', lastName: 'B', email: '', phone: '' }] };
  const ctl = clientsController.buildController(fakeModel);
  const res = makeRes();
  ctl.cleanupOrphansPreview({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { orphans: [{ id: 1, firstName: 'A', lastName: 'B', email: '', phone: '' }] });
});

test('controller cleanupOrphansDelete rejects missing/empty/non-numeric ids with 400 INVALID_IDS', () => {
  const fakeModel = { cleanupOrphansByIds: () => assert.fail('model must not be called on validation error') };
  const ctl = clientsController.buildController(fakeModel);

  let res = makeRes(); ctl.cleanupOrphansDelete({ body: {} }, res);
  assert.equal(res.statusCode, 400); assert.equal(res.body.error, 'INVALID_IDS');

  res = makeRes(); ctl.cleanupOrphansDelete({ body: { ids: [] } }, res);
  assert.equal(res.statusCode, 400);

  res = makeRes(); ctl.cleanupOrphansDelete({ body: { ids: ['x', 2] } }, res);
  assert.equal(res.statusCode, 400);

  res = makeRes(); ctl.cleanupOrphansDelete({ body: { ids: [0] } }, res);
  assert.equal(res.statusCode, 400);
});

test('controller cleanupOrphansDelete happy path returns { ok, deletedCount, skippedCount }', () => {
  const fakeModel = { cleanupOrphansByIds: (ids) => ({ deletedCount: ids.length, skippedCount: 0 }) };
  const ctl = clientsController.buildController(fakeModel);
  const res = makeRes();
  ctl.cleanupOrphansDelete({ body: { ids: [3, 4] } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, deletedCount: 2, skippedCount: 0 });
});
