// specs/payment-schedule-and-cancellation.md rule 50 — deleting a devis deactivates its open payment links
// at the provider first; a link that cannot be deactivated refuses the delete (audit 2026-10-28).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');
const paymentLinksModel = require('../models/paymentLinksModel');
const paymentLinkDeactivation = require('../utils/paymentLinkDeactivation');
const { buildController } = require('../controllers/devisController');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  const info = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, devisStatus, devisNumber)
                           VALUES ('devis', 1, 1, '2099-03-11', '2099-03-13', 'sent', 'D-1')`).run();
  return { db, id: Number(info.lastInsertRowid) };
}

function run(db, id, provider) {
  const model = devisModel.buildModel(db);
  const links = paymentLinksModel.buildModel(db);
  const original = model.deactivateLinksBeforeRemove;
  model.deactivateLinksBeforeRemove = (devisId) => paymentLinkDeactivation.deactivateOpenLinksBeforeDelete(devisId, { paymentLinksModel: links, providerFor: () => provider });
  assert.ok(original);
  const controller = buildController(model);
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return controller.remove({ params: { id } }, res).then(() => res);
}

const provider = (fail = false) => ({
  calls: [],
  async getPayment() { return { paid: false }; },
  async getLinkStatus() { return 'open'; },
  async cancelLink(linkId) { this.calls.push(linkId); if (fail) throw new Error('down'); },
});

test('deleting a devis deactivates its open link at the provider', async () => {
  const { db, id } = seed();
  paymentLinksModel.buildModel(db).create({ reservationId: id, type: 'deposit', amountCents: 9000, providerLinkId: 'ql_d', url: 'u', status: 'open' });
  const p = provider();
  const res = await run(db, id, p);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(p.calls, ['ql_d']);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM reservations WHERE id = ?").get(id).c, 0);
  assert.equal(db.prepare('SELECT status FROM payment_links').get().status, 'cancelled');
});

test('a link that cannot be deactivated refuses the devis delete', async () => {
  const { db, id } = seed();
  paymentLinksModel.buildModel(db).create({ reservationId: id, type: 'deposit', amountCents: 9000, providerLinkId: 'ql_d', url: 'u', status: 'open' });
  const res = await run(db, id, provider(true));
  assert.equal(res.statusCode, 502);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM reservations WHERE id = ?").get(id).c, 1);
  assert.equal(db.prepare('SELECT status FROM payment_links').get().status, 'open');
});

test('the CGV refusal comes before any link is touched', async () => {
  const { db, id } = seed();
  db.pragma('foreign_keys = OFF');
  db.prepare('UPDATE reservations SET convertedReservationId = 999 WHERE id = ?').run(id);
  db.prepare("INSERT INTO terms_acceptances (reservationId, termsVersionId, acceptedAt) VALUES (?, 1, datetime('now'))").run(id);
  paymentLinksModel.buildModel(db).create({ reservationId: id, type: 'deposit', amountCents: 9000, providerLinkId: 'ql_d', url: 'u', status: 'open' });
  const p = provider();
  const res = await run(db, id, p);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(p.calls, [], 'nothing deactivated for a delete that was refused');
  assert.equal(db.prepare('SELECT status FROM payment_links').get().status, 'open');
});
