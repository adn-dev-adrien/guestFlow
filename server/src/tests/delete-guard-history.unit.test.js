// specs/payment-schedule-and-cancellation.md rule 53 — the client and property deletes (forced or not)
// obey the refusals of the per-row routes: cancelled stays and CGV acceptance proofs are never wiped.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const clientsModel = require('../models/clientsModel');
const propertiesModel = require('../models/propertiesModel');
const { buildController: buildClientsController } = require('../controllers/clientsController');
const { HISTORY_MESSAGES } = require('../utils/deletionGuard');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  const insert = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, sourceType)
                             VALUES (?, 1, 1, ?, ?, 'Direct', 'manual')`);
  const add = (kind, s = '2099-06-01', e = '2099-06-04') => Number(insert.run(kind, s, e).lastInsertRowid);
  return { db, add };
}
const fakeRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const count = (db, table) => db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;
const acceptCgv = (db, reservationId) => {
  db.prepare("INSERT INTO terms_versions (id, version, markdownFr, markdownEn, htmlFr, htmlEn, variablesJson, contentHash, publishedAt) VALUES (1, 1, 'x', 'x', 'x', 'x', '{}', 'h', '2099-01-01')").run();
  db.prepare("INSERT INTO terms_acceptances (reservationId, termsVersionId, acceptedAt) VALUES (?, 1, '2099-01-02')").run(reservationId);
};

test('rule 53 — a forced client delete is refused while a cancelled stay would go with it', async () => {
  const { db, add } = seed();
  add('cancelled');
  const res = fakeRes();
  await buildClientsController(clientsModel.create(db)).remove({ params: { id: '1' }, query: { force: 'true' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CLIENT_KEEPS_HISTORY');
  assert.equal(res.body.error, 'Ce client a une réservation annulée.');
  assert.equal(count(db, 'clients'), 1);
  assert.equal(count(db, 'reservations'), 1);
});

test('rule 53 — a forced client delete is refused while a converted devis carries the CGV acceptance', async () => {
  const { db, add } = seed();
  const stay = add('reservation');
  const devis = add('devis');
  db.prepare('UPDATE reservations SET convertedReservationId = ? WHERE id = ?').run(stay, devis);
  acceptCgv(db, devis);
  const res = fakeRes();
  await buildClientsController(clientsModel.create(db)).remove({ params: { id: '1' }, query: { force: 'true' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CLIENT_KEEPS_HISTORY');
  assert.equal(res.body.error, 'Ce client a accepté des CGV.');
  assert.equal(count(db, 'terms_acceptances'), 1);
  assert.equal(count(db, 'reservations'), 2);
});

test('rule 53 — the client delete preview lists the cancelled stays that would be removed', () => {
  const { db, add } = seed();
  add('cancelled');
  add('superseded', '2099-07-01', '2099-07-03');
  const impact = clientsModel.create(db).getDeleteImpact(1);
  assert.equal(impact.reservationsCount, 2);
  assert.deepEqual(impact.reservations.map((r) => r.kind).sort(), ['cancelled', 'superseded']);
});

test('rule 53 — the first, unforced delete of a client holding a cancelled stay already answers KEEPS_HISTORY', async () => {
  const { db, add } = seed();
  add('cancelled');
  const res = fakeRes();
  await buildClientsController(clientsModel.create(db)).remove({ params: { id: '1' }, query: {} }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CLIENT_KEEPS_HISTORY');
  assert.equal(count(db, 'reservations'), 1);
});

test('rule 53 — the delete preview carries the refusal, so the sheet shows it before any confirmation', () => {
  const { db, add } = seed();
  assert.equal(clientsModel.create(db).getDeleteImpact(1).blocker, null);
  add('cancelled');
  assert.equal(clientsModel.create(db).getDeleteImpact(1).blocker, 'Ce client a une réservation annulée.');
});

test('rule 53 — the property delete is refused for a cancelled stay or a CGV proof, and removeGuarded deletes nothing', () => {
  const { db, add } = seed();
  const model = propertiesModel.buildModel(db);
  assert.equal(model.deletionBlocker(1), null);
  add('cancelled');
  assert.equal(model.deletionBlocker(1), HISTORY_MESSAGES.property.cancelled);
  assert.deepEqual(model.removeGuarded(1), { blocker: HISTORY_MESSAGES.property.cancelled });
  assert.equal(count(db, 'properties'), 1);
  assert.equal(count(db, 'reservations'), 1);

  const other = seed();
  const stay = other.add('reservation');
  const devis = other.add('devis');
  other.db.prepare('UPDATE reservations SET convertedReservationId = ? WHERE id = ?').run(stay, devis);
  acceptCgv(other.db, devis);
  assert.equal(propertiesModel.buildModel(other.db).deletionBlocker(1), HISTORY_MESSAGES.property.cgv);
});

test('rule 53 — plain stays and unconverted devis still cascade on a forced delete', async () => {
  const { db, add } = seed();
  add('reservation');
  add('devis', '2099-08-01', '2099-08-03');
  const res = fakeRes();
  await buildClientsController(clientsModel.create(db)).remove({ params: { id: '1' }, query: { force: 'true' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(count(db, 'reservations'), 0);
});
