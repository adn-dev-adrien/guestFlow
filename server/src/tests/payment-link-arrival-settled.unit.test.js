// specs/plugins-phase-3a-online-payment.md rule 39 (audit R4 Q1): a bucket collected at arrival (the fiche's
// « Paiement unique » or the SAS check-in) retires its open link at once, and a link paid on a bucket
// already settled never silently re-marks it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { create: createReservationsModel } = require('../models/reservationsModel');
const { processPaidLink } = require('../utils/paymentPollRunner');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'J', 'D', 'j@x.fr')").run();
  const rid = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount, depositDisabled, createdAt)
    VALUES ('reservation', 1, 1, '2027-05-10', '2027-05-14', 1, 463.12, 0, 463.12, 1, '2027-01-01')`).run().lastInsertRowid);
  const links = paymentLinksModel.buildModel(db);
  const model = createReservationsModel(db);
  const B = links.create({ reservationId: rid, type: 'balance', amountCents: 46312, provider: 'qonto', providerLinkId: 'B', url: 'u', status: 'open' });
  const calls = [];
  const common = {
    database: db, devisModel: devisModel.buildModel(db), paymentLinksModel: links,
    sendConfirmation: async (id) => calls.push(['confirm', id]), notifyPaidAfterCancel: async (l, o) => calls.push(['alert', l.id, o]), emitPluginEvent: () => {},
  };
  // The webhook lands before any retirement: the link is still open when the money arrives.
  const payLive = (link, at) => processPaidLink({
    ...common, paymentLinksModel: Object.assign(Object.create(links), { retireSettled: () => [] }),
    link, paidPayment: { paid: true, paymentId: `p${link.id}`, paidAt: at },
  });
  const refunds = () => db.prepare("SELECT COUNT(*) n FROM reservation_history WHERE changedFields LIKE '%refundOwed%'").get().n;
  return { db, links, model, rid, B, calls, payLive, refunds };
}

test('rule 39: the arrival payment retires the open link of the bucket it collected', () => {
  const s = seed();
  const res = s.model.settleArrivalBuckets(s.rid, { mode: 'card', date: '2027-05-10' });
  assert.deepEqual(res.buckets, ['balance']);
  const link = s.links.findById(s.B.id);
  assert.equal(link.status, 'cancelled');
  assert.equal(link.cancelReason, 'settled');
});

test('rule 39: a link paid on an earlier-collected bucket alerts when the arrival was dated before the payment', async () => {
  const s = seed();
  s.model.settleArrivalBuckets(s.rid, { mode: 'card', date: '2027-05-10' });
  s.db.prepare("UPDATE payment_links SET status = 'open', remoteCancelPendingAt = NULL, cancelReason = NULL WHERE id = ?").run(s.B.id);
  const out = await s.payLive(s.links.findById(s.B.id), '2027-05-11T10:00:00Z');
  assert.equal(out.status, 'paid-after-settled');
  assert.equal(out.settledOn, '2027-05-10');
  assert.ok(s.calls.some((c) => c[0] === 'alert' && c[2] && c[2].settledOn === '2027-05-10'));
  assert.ok(!s.calls.some((c) => c[0] === 'confirm'));
});

test('rule 39: a link paid the very day the bucket was collected stays silent and sends no confirmation', async () => {
  const s = seed();
  s.model.settleArrivalBuckets(s.rid, { mode: 'card', date: '2027-05-11' });
  s.db.prepare("UPDATE payment_links SET status = 'open', remoteCancelPendingAt = NULL, cancelReason = NULL WHERE id = ?").run(s.B.id);
  const out = await s.payLive(s.links.findById(s.B.id), '2027-05-11T10:00:00Z');
  assert.equal(out.status, 'paid');
  assert.equal(out.effect, 'settled-elsewhere');
  assert.equal(s.calls.length, 0);
  assert.equal(s.refunds(), 0);
});

test('rule 39: a full link paid after the solde was collected is not confirmed again', async () => {
  const s = seed();
  const F = s.links.create({ reservationId: s.rid, type: 'full', amountCents: 46312, provider: 'qonto', providerLinkId: 'F', url: 'u', status: 'open' });
  s.db.prepare("UPDATE reservations SET balancePaid = 1, balancePaidDate = '2027-05-10' WHERE id = ?").run(s.rid);
  const out = await s.payLive(s.links.findById(F.id), '2027-05-11T10:00:00Z');
  assert.equal(out.status, 'paid-after-settled');
  assert.ok(!s.calls.some((c) => c[0] === 'confirm'));
});

test('rule 39: the SAS arrival collection retires the open link of the stay it collected', () => {
  const s = seed();
  s.model.commitArrivalSas(s.rid, { stayPaid: true, stayPaidCash: false });
  assert.equal(s.db.prepare('SELECT balancePaid FROM reservations WHERE id = ?').get(s.rid).balancePaid, 1);
  assert.equal(s.links.findById(s.B.id).status, 'cancelled');
});
