// specs/payment-schedule-and-cancellation.md rules 49-52 (and specs/terms-acceptance-record.md rule 29) — the
// DELETE /api/reservations/:id route used to bypass every read-only and archive guard of the fiche
// (audit 2026-10-28): it erased cancelled stays with their refunds and devis with their CGV proof,
// and left the payment links of a deleted row payable at the provider.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');
const paymentLinksModel = require('../models/paymentLinksModel');
const { deactivateOpenLinksBeforeDelete } = require('../utils/paymentLinkDeactivation');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed(overrides = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  const row = { kind: 'reservation', start: '2099-06-01', end: '2099-06-04', ...overrides };
  const info = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, sourceType)
                           VALUES (?, 1, 1, ?, ?, 'Direct', 'manual')`).run(row.kind, row.start, row.end);
  return { db, id: Number(info.lastInsertRowid) };
}

function fakeProvider({ failCancel = false, paid = false } = {}) {
  const calls = [];
  return {
    calls,
    id: 'qonto',
    getPayment: async () => ({ paid }),
    getLinkStatus: async () => 'open',
    cancelLink: async (linkId) => { calls.push(linkId); if (failCancel) throw new Error('provider down'); },
  };
}

function controllerFor(db, provider) {
  const model = reservationsModel.create(db);
  const links = paymentLinksModel.buildModel(db);
  const util = require('../utils/paymentLinkDeactivation');
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (id === '../models/reservationsModel') return model;
    if (id === '../models/paymentLinksModel') return links;
    if (id === '../utils/paymentLinkDeactivation') {
      return { ...util, deactivateOpenLinksBeforeDelete: (rid, deps) => util.deactivateOpenLinksBeforeDelete(rid, { ...deps, providerFor: () => provider }) };
    }
    if (id === '../plugins/sdk/eventBus') return { emit() {} };
    return origRequire.call(this, id);
  };
  try {
    delete require.cache[require.resolve('../controllers/reservationsController')];
    return require('../controllers/reservationsController');
  } finally {
    Module.prototype.require = origRequire;
  }
}

async function remove(controller, id) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await controller.remove({ params: { id: String(id) }, query: {}, user: { roles: ['admin'] } }, res);
  return res;
}

const exists = (db, id) => Boolean(db.prepare('SELECT 1 FROM reservations WHERE id = ?').get(id));

test('a plain upcoming stay is deleted', async () => {
  const { db, id } = seed();
  const res = await remove(controllerFor(db, fakeProvider()), id);
  assert.equal(res.statusCode, 200);
  assert.equal(exists(db, id), false);
});

test('a cancelled stay is history: refused, its refunds survive', async () => {
  const { db, id } = seed({ kind: 'cancelled' });
  db.prepare("INSERT INTO reservation_refunds (reservationId, refundDate, totalTtc) VALUES (?, '2099-05-01', 150)").run(id);
  const res = await remove(controllerFor(db, fakeProvider()), id);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'RESERVATION_NOT_DELETABLE');
  assert.equal(exists(db, id), true);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_refunds').get().c, 1);
});

test('a devis goes through /api/devis: refused here, its CGV proof survives', async () => {
  const { db, id } = seed({ kind: 'devis' });
  db.prepare("UPDATE reservations SET convertedReservationId = 999 WHERE id = ?").run(id);
  const cols = db.prepare('PRAGMA table_info(terms_acceptances)').all().map((c) => c.name);
  assert.ok(cols.includes('reservationId'));
  db.pragma('foreign_keys = OFF');
  db.prepare("INSERT INTO terms_acceptances (reservationId, termsVersionId, acceptedAt) VALUES (?, 1, datetime('now'))").run(id);
  const res = await remove(controllerFor(db, fakeProvider()), id);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /page Devis/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM terms_acceptances').get().c, 1);
});

test('a duplicate set aside is refused', async () => {
  const { db, id } = seed({ kind: 'superseded' });
  const res = await remove(controllerFor(db, fakeProvider()), id);
  assert.equal(res.statusCode, 409);
  assert.equal(exists(db, id), true);
});

for (const [label, sql] of [
  ['an acompte already collected', "UPDATE reservations SET depositPaid = 1 WHERE id = ?"],
  ['a solde already collected', "UPDATE reservations SET balancePaid = 1 WHERE id = ?"],
  ['an extras complement already collected', "UPDATE reservations SET complementPaid = 1 WHERE id = ?"],
  ['a refund', "INSERT INTO reservation_refunds (reservationId, refundDate, totalTtc) VALUES (?, '2099-05-01', 10)"],
  ['a paid payment link', "INSERT INTO payment_links (reservationId, type, amountCents, status) VALUES (?, 'deposit', 1000, 'paid')"],
  ['a compensation', "INSERT INTO cancellation_compensations (reservationId, expectedAmount) VALUES (?, 80)"],
]) {
  test(`a stay carrying money is refused: ${label}`, async () => {
    const { db, id } = seed();
    db.prepare(sql).run(id);
    const res = await remove(controllerFor(db, fakeProvider()), id);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'RESERVATION_CARRIES_MONEY');
    assert.equal(exists(db, id), true);
  });
}

test('rule 50 — an open payment link is deactivated at the provider before the stay goes', async () => {
  const { db, id } = seed();
  const links = paymentLinksModel.buildModel(db);
  const link = links.create({ reservationId: id, type: 'deposit', amountCents: 9000, providerLinkId: 'ql_1', url: 'u', status: 'open' });
  const provider = fakeProvider();
  const res = await remove(controllerFor(db, provider), id);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(provider.calls, ['ql_1']);
  assert.equal(exists(db, id), false);
  assert.equal(links.findById(link.id).status, 'cancelled');
});

test('rule 50 — a provider that cannot deactivate refuses the delete and the stay stays', async () => {
  const { db, id } = seed();
  const links = paymentLinksModel.buildModel(db);
  const link = links.create({ reservationId: id, type: 'deposit', amountCents: 9000, providerLinkId: 'ql_1', url: 'u', status: 'open' });
  const res = await remove(controllerFor(db, fakeProvider({ failCancel: true })), id);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'LINK_NOT_DEACTIVATED');
  assert.equal(exists(db, id), true);
  assert.equal(links.findById(link.id).status, 'open');
});

test('rule 50 — a link paid meanwhile refuses the delete', async () => {
  const { db, id } = seed();
  paymentLinksModel.buildModel(db).create({ reservationId: id, type: 'deposit', amountCents: 9000, providerLinkId: 'ql_1', url: 'u', status: 'open' });
  const res = await remove(controllerFor(db, fakeProvider({ paid: true })), id);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'LINK_ALREADY_PAID');
  assert.equal(exists(db, id), true);
});

test('rule 50 — a link deactivated before a later failure stays cancelled, the failing one stays open', async () => {
  const { db, id } = seed();
  const links = paymentLinksModel.buildModel(db);
  links.create({ reservationId: id, type: 'deposit', amountCents: 9000, providerLinkId: 'ql_a', url: 'u', status: 'open' });
  links.create({ reservationId: id, type: 'balance', amountCents: 9000, providerLinkId: 'ql_b', url: 'u', status: 'open' });
  const provider = fakeProvider();
  const original = provider.cancelLink;
  provider.cancelLink = async (linkId) => { if (linkId === 'ql_a') throw new Error('down'); return original(linkId); };
  await assert.rejects(deactivateOpenLinksBeforeDelete(id, { paymentLinksModel: links, providerFor: () => provider }), { httpStatus: 502 });
  const statuses = Object.fromEntries(links.listForReservation(id).map((l) => [l.providerLinkId, l.status]));
  assert.deepEqual(statuses, { ql_a: 'open', ql_b: 'cancelled' });
});

test('rule 51 — open links pointing at a missing reservation are listed for the boot log', () => {
  const { db, id } = seed();
  const links = paymentLinksModel.buildModel(db);
  links.create({ reservationId: id, type: 'deposit', amountCents: 100, providerLinkId: 'ql_ok', url: 'u', status: 'open' });
  links.create({ reservationId: 424242, type: 'deposit', amountCents: 100, providerLinkId: 'ql_orphan', url: 'u', status: 'open' });
  links.create({ reservationId: 424243, type: 'deposit', amountCents: 100, providerLinkId: 'ql_old', url: 'u', status: 'cancelled' });
  assert.deepEqual(links.listOrphanOpen().map((l) => l.reservationId), [424242]);
});

// ---- rule 49 / 50 — money and links of a devis converted into the stay (they keep the devis id) ----

function stayWithConvertedDevis(db) {
  const { id } = { id: Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, sourceType, devisStatus)
    VALUES ('devis', 1, 1, '2099-06-01', '2099-06-04', 'Direct', 'manual', 'converted')`).run().lastInsertRowid) };
  return id;
}

test('rule 49 — a paid link left on the devis converted into the stay refuses the stay delete, with the way out', async () => {
  const { db, id } = seed();
  const devis = stayWithConvertedDevis(db);
  db.prepare('UPDATE reservations SET convertedReservationId = ? WHERE id = ?').run(id, devis);
  paymentLinksModel.buildModel(db).create({ reservationId: devis, type: 'deposit', amountCents: 9000, providerLinkId: 'ql_p', url: 'u', status: 'paid' });
  const res = await remove(controllerFor(db, fakeProvider()), id);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'RESERVATION_CARRIES_MONEY');
  assert.equal(res.body.error, 'Un paiement est enregistré sur ce séjour : l’annuler plutôt que le supprimer.');
  assert.equal(exists(db, id), true);
});

test('rule 50 — an open link left on the converted devis is deactivated before the stay goes', async () => {
  const { db, id } = seed();
  const devis = stayWithConvertedDevis(db);
  db.prepare('UPDATE reservations SET convertedReservationId = ? WHERE id = ?').run(id, devis);
  const links = paymentLinksModel.buildModel(db);
  const link = links.create({ reservationId: devis, type: 'balance', amountCents: 9000, providerLinkId: 'ql_dv', url: 'u', status: 'open' });
  const provider = fakeProvider();
  const res = await remove(controllerFor(db, provider), id);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(provider.calls, ['ql_dv']);
  assert.equal(links.findById(link.id).status, 'cancelled');
});
