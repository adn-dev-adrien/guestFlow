// specs/payment-schedule-and-cancellation.md rule 52 — the delete guard covers every path that can drop a
// stay: a forced client delete and a property delete (FK cascades) refuse when anything under them carries
// money; a devis carrying money is kept; an iCal cancellation approval never hard-deletes a stay carrying
// money (it is cancelled and kept). Money on the devis converted into a stay counts for the stay.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const Database = require('better-sqlite3');

const clientsModel = require('../models/clientsModel');
const propertiesModel = require('../models/propertiesModel');
const devisModel = require('../models/devisModel');
const paymentLinksModel = require('../models/paymentLinksModel');
const icalCancellationModel = require('../models/icalCancellationModel');
const { buildController: buildClientsController } = require('../controllers/clientsController');
const { MONEY_MESSAGE, CLIENT_MONEY_MESSAGE, PROPERTY_MONEY_MESSAGE } = require('../utils/deletionGuard');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  const insert = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, sourceType)
                             VALUES (?, 1, 1, ?, ?, 'Airbnb', 'ical')`);
  const stay = Number(insert.run('reservation', '2099-06-01', '2099-06-04').lastInsertRowid);
  return { db, stay, insert };
}

const fakeRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const count = (db, table) => db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;

test('rule 52 — a forced client delete is refused when a stay of the client carries money', async () => {
  const { db, stay } = seed();
  db.prepare("INSERT INTO reservation_refunds (reservationId, refundDate, totalTtc) VALUES (?, '2099-05-01', 40)").run(stay);
  const controller = buildClientsController(clientsModel.create(db));
  const res = fakeRes();
  await controller.remove({ params: { id: '1' }, query: { force: 'true' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CLIENT_CARRIES_MONEY');
  assert.equal(res.body.error, CLIENT_MONEY_MESSAGE);
  assert.equal(count(db, 'clients'), 1);
  assert.equal(count(db, 'reservation_refunds'), 1);
});

test('rule 52 — a forced client delete is refused for money on a devis converted into a stay of the client', async () => {
  const { db, stay, insert } = seed();
  const devis = Number(insert.run('devis', '2099-06-01', '2099-06-04').lastInsertRowid);
  db.prepare('UPDATE reservations SET convertedReservationId = ? WHERE id = ?').run(stay, devis);
  paymentLinksModel.buildModel(db).create({ reservationId: devis, type: 'deposit', amountCents: 100, providerLinkId: 'ql_1', url: 'u', status: 'paid' });
  const res = fakeRes();
  await buildClientsController(clientsModel.create(db)).remove({ params: { id: '1' }, query: { force: 'true' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(count(db, 'clients'), 1);
});

test('rule 52 — a forced client delete without money still cascades', async () => {
  const { db } = seed();
  const res = fakeRes();
  await buildClientsController(clientsModel.create(db)).remove({ params: { id: '1' }, query: { force: 'true' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(count(db, 'clients'), 0);
  assert.equal(count(db, 'reservations'), 0);
});

test('rule 52 — a cancelled stay with a refund also blocks the client delete', () => {
  const { db, stay } = seed();
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(stay);
  db.prepare("INSERT INTO reservation_refunds (reservationId, refundDate, totalTtc) VALUES (?, '2099-05-01', 40)").run(stay);
  assert.equal(clientsModel.create(db).deletionBlocker(1), CLIENT_MONEY_MESSAGE);
});

test('rule 52 — a property delete is refused when a stay or devis of the property carries money', () => {
  const { db, stay } = seed();
  const model = propertiesModel.buildModel(db);
  assert.equal(model.deletionBlocker(1), null);
  db.prepare('UPDATE reservations SET depositPaid = 1 WHERE id = ?').run(stay);
  assert.equal(model.deletionBlocker(1), PROPERTY_MONEY_MESSAGE);
  assert.equal(model.deletionBlocker(2), null, 'another property is not concerned');
});

test('rule 52 — the property controller answers 409 and deletes nothing', async () => {
  const { db, stay } = seed();
  db.prepare('UPDATE reservations SET balancePaid = 1 WHERE id = ?').run(stay);
  const model = propertiesModel.buildModel(db);
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (id === '../models/propertiesModel') return model;
    return origRequire.call(this, id);
  };
  let controller;
  try {
    delete require.cache[require.resolve('../controllers/propertiesController')];
    controller = require('../controllers/propertiesController');
  } finally {
    Module.prototype.require = origRequire;
  }
  const res = fakeRes();
  await controller.remove({ params: { id: '1' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'PROPERTY_CARRIES_MONEY');
  assert.equal(count(db, 'properties'), 1);
  assert.equal(count(db, 'reservations'), 1);
});

test('rule 49 — a link retired after the guest paid it (cancelled with paidAt) still counts as money', () => {
  const { db, stay } = seed();
  const links = paymentLinksModel.buildModel(db);
  const link = links.create({ reservationId: stay, type: 'deposit', amountCents: 100, providerLinkId: 'ql_r', url: 'u', status: 'open' });
  assert.equal(propertiesModel.buildModel(db).deletionBlocker(1), null);
  db.prepare("UPDATE payment_links SET status = 'cancelled', paidAt = '2099-05-01T10:00:00Z' WHERE id = ?").run(link.id);
  assert.equal(propertiesModel.buildModel(db).deletionBlocker(1), PROPERTY_MONEY_MESSAGE);
  assert.equal(require('../models/reservationsModel').create(db).deletionBlocker(stay), MONEY_MESSAGE);
});

test('rule 52 — a devis carrying a paid link is kept (409)', () => {
  const { db, insert } = seed();
  const devis = Number(insert.run('devis', '2099-06-01', '2099-06-04').lastInsertRowid);
  paymentLinksModel.buildModel(db).create({ reservationId: devis, type: 'deposit', amountCents: 100, providerLinkId: 'ql_1', url: 'u', status: 'paid' });
  const refusal = devisModel.buildModel(db).removeRefusal(devis);
  assert.equal(refusal.status, 409);
  assert.equal(refusal.code, 'DEVIS_CARRIES_MONEY');
  assert.match(refusal.error, /conserver plutôt que le supprimer/);
});

function pendingCancellation(db, stay) {
  db.prepare("INSERT INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel) VALUES (1, 1, 'Airbnb', 'http://x.test/a.ics', 'airbnb', 'Airbnb')").run();
  db.prepare("UPDATE reservations SET icalSyncLocked = 0, sourceIcalSourceId = 1 WHERE id = ?").run(stay);
  return Number(db.prepare("INSERT INTO ical_cancellation_alerts (reservationId, sourceId, eventUid) VALUES (?, 1, 'E1')").run(stay).lastInsertRowid);
}

test('rule 52 — approving an iCal cancellation hard-deletes a stay with no money (as before)', () => {
  const { db, stay } = seed();
  const alert = pendingCancellation(db, stay);
  const result = icalCancellationModel.buildModel(db).approve(alert);
  assert.equal(result.outcome, 'approved');
  assert.equal(count(db, 'reservations'), 0);
});

test('rule 52 — approving an iCal cancellation never deletes a stay carrying money: cancelled and kept', () => {
  const { db, stay } = seed();
  db.prepare("INSERT INTO reservation_refunds (reservationId, refundDate, totalTtc) VALUES (?, '2099-05-01', 30)").run(stay);
  const alert = pendingCancellation(db, stay);
  const result = icalCancellationModel.buildModel(db).approve(alert);
  assert.equal(result.outcome, 'approved_kept');
  assert.equal(result.reservationId, stay);
  const row = db.prepare('SELECT kind, cancellationReason, cancelledAt FROM reservations WHERE id = ?').get(stay);
  assert.equal(row.kind, 'cancelled');
  assert.ok(row.cancelledAt);
  assert.equal(count(db, 'reservation_refunds'), 1, 'the refund survives');
  assert.equal(db.prepare('SELECT outcome FROM ical_cancellation_alerts WHERE id = ?').get(alert).outcome, 'approved');
  assert.equal(count(db, 'ical_import_events'), 0, 'its mappings are gone, the sync cannot resurrect it');
});

test('the messages point at the way out', () => {
  assert.equal(MONEY_MESSAGE, 'Un paiement est enregistré sur ce séjour : l’annuler plutôt que le supprimer.');
});

test('rule 52 — a link marked paid during the provider await refuses the client delete and the property delete', async () => {
  for (const which of ['client', 'property']) {
    const { db, stay } = seed();
    const links = paymentLinksModel.buildModel(db);
    const link = links.create({ reservationId: stay, type: 'deposit', amountCents: 100, providerLinkId: 'ql_race', url: 'u', status: 'open' });
    const util = require('../utils/paymentLinkDeactivation');
    const provider = {
      async getPayment() { return { paid: false }; },
      async getLinkStatus() { return 'open'; },
      async cancelLink() { db.prepare("UPDATE payment_links SET status = 'paid', paidAt = '2099-05-01T10:00:00Z' WHERE id = ?").run(link.id); },
    };
    const origRequire = Module.prototype.require;
    const cm = clientsModel.create(db);
    const pm = propertiesModel.buildModel(db);
    Module.prototype.require = function patched(id) {
      if (id === '../models/propertiesModel') return pm;
      if (id === '../models/paymentLinksModel') return links;
      if (id === '../utils/paymentLinkDeactivation') {
        return { ...util, deactivateOpenLinksBeforeDelete: (ids, deps) => util.deactivateOpenLinksBeforeDelete(ids, { ...deps, paymentLinksModel: links, providerFor: () => provider }) };
      }
      return origRequire.call(this, id);
    };
    let controller;
    try {
      const target = which === 'client' ? '../controllers/clientsController' : '../controllers/propertiesController';
      delete require.cache[require.resolve(target)];
      controller = which === 'client' ? require(target).buildController(cm) : require(target);
    } finally {
      Module.prototype.require = origRequire;
    }
    const res = fakeRes();
    await controller.remove({ params: { id: '1' }, query: { force: 'true' } }, res);
    assert.equal(res.statusCode, 409, which);
    assert.equal(count(db, which === 'client' ? 'clients' : 'properties'), 1, which);
    assert.equal(count(db, 'reservations'), 1, which);
  }
});

test('rule 52 — an approved cancellation abandons the stay\'s open links (retry marker) and returns them for deactivation after the commit', () => {
  for (const withMoney of [false, true]) {
    const { db, stay } = seed();
    if (withMoney) db.prepare("INSERT INTO reservation_refunds (reservationId, refundDate, totalTtc) VALUES (?, '2099-05-01', 30)").run(stay);
    const links = paymentLinksModel.buildModel(db);
    const link = links.create({ reservationId: stay, type: 'deposit', amountCents: 100, providerLinkId: 'ql_i', url: 'u', status: 'open' });
    const result = icalCancellationModel.buildModel(db).approve(pendingCancellation(db, stay));
    assert.deepEqual(result.cancelledLinks.map((l) => l.id), [link.id], String(withMoney));
    const row = links.findById(link.id);
    assert.equal(row.status, 'cancelled');
    assert.ok(row.remoteCancelPendingAt, 'the poll retries it if the provider call fails');
  }
});

test('rule 52 — the dashboard controller deactivates those links after the response', async () => {
  const { buildController } = require('../controllers/dashboardController');
  const deactivated = [];
  const controller = buildController({
    icalCancellationModel: { approve: () => ({ ok: true, outcome: 'approved_kept', reservationId: 7, compensationId: null, cancelledLinks: [{ id: 3 }] }) },
    emitPluginEvent: () => {},
    deactivateLinks: async (links) => { deactivated.push(...links); },
  });
  const res = fakeRes();
  controller.approveIcalCancellation({ params: { id: '1' }, body: {} }, res);
  assert.equal(res.body.outcome, 'approved_kept');
  await Promise.resolve();
  assert.deepEqual(deactivated, [{ id: 3 }]);
});
