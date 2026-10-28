// specs/public-online-payment.md rules 14-15 — the review of PR #841: a manual tick is not a refund,
// a stale link paid before its retirement is booked, the retirement leaves a trace, a legacy devis
// without its split is never compared, and the alerts say what the admin has to do.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { processPaidLink, retryPendingCancellations } = require('../utils/paymentPollRunner');
const { deactivateAbandonedLinks } = require('../utils/paymentLinkDeactivation');
const { settleRetiredDevisLinks } = require('../utils/retiredDevisLinks');
const notificationService = require('../utils/notificationService');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed({ deposit = 100, balance = 455 } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults,
      finalPrice, depositAmount, balanceAmount, devisStatus)
    VALUES ('devis', 1, 1, '2027-05-10', '2027-05-14', 1, ?, ?, ?, 'draft')`).run(deposit + balance, deposit, balance).lastInsertRowid);
  return { db, id, links: paymentLinksModel.buildModel(db), model: devisModel.buildModel(db) };
}

async function pay(db, links, model, link, paidAt = '2027-04-01T10:00:00Z') {
  const alerts = [];
  const confirmations = [];
  const out = await processPaidLink({
    database: db, devisModel: model, paymentLinksModel: links, link: links.findById(link.id),
    paidPayment: { paid: true, paymentId: `pay_${link.id}`, paidAt },
    sendConfirmation: async (rid) => confirmations.push(rid),
    notifyPaidAfterCancel: async (l, o) => alerts.push(o),
    emitPluginEvent: () => {},
  });
  return { out, alerts, confirmations };
}

function convertAndTick(db, model, id, day) {
  const rid = model.convertToReservation(id).data.reservationId;
  db.prepare('UPDATE reservations SET depositPaid = 1, depositPaidDate = ?, balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(day, day, rid);
  return rid;
}

test('review 1 — the operator converted by hand and ticked the same day: the stale link is that money, no refund wording', async () => {
  const { db, id, links, model } = seed();
  const link = links.create({ reservationId: id, type: 'full', amountCents: 54536, providerLinkId: 'pre18', url: 'u', status: 'open' });
  convertAndTick(db, model, id, '2027-04-01');
  const { out, alerts, confirmations } = await pay(db, links, model, link);
  assert.equal(out.effect, 'settled-elsewhere');
  assert.equal(out.status, 'paid');
  assert.deepEqual(alerts, []);
  assert.deepEqual(confirmations, []);
});

test('review 1 — ticked on an earlier day than the payment: « à vérifier », never « payé deux fois »', async () => {
  const { db, id, links, model } = seed();
  const link = links.create({ reservationId: id, type: 'full', amountCents: 54536, providerLinkId: 'pre18', url: 'u', status: 'open' });
  convertAndTick(db, model, id, '2027-03-20');
  const { out, alerts } = await pay(db, links, model, link);
  assert.equal(out.status, 'paid-after-settled');
  assert.deepEqual(alerts, [{ settledOn: '2027-03-20' }]);
});

test('review 5 — two live links both paid: the refund owed is kept on the converted stay\'s history', async () => {
  const { db, id, links, model } = seed();
  const first = links.create({ reservationId: id, type: 'full', amountCents: 55500, providerLinkId: 'l1', url: 'u', status: 'open' });
  const second = links.create({ reservationId: id, type: 'full', amountCents: 55500, providerLinkId: 'l2', url: 'u', status: 'open' });
  const one = await pay(db, links, model, first);
  const two = await pay(db, links, model, second);
  assert.equal(two.out.effect, 'double-payment');
  assert.deepEqual(two.alerts, [{ doublePaid: true }]);
  const rows = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ?").all(one.out.reservationId);
  const owed = rows.map((r) => JSON.parse(r.changedFields)).flat().find((c) => c.field === 'refundOwed');
  assert.ok(owed, 'a persisted marker');
  assert.match(owed.to, /555,00/);
});

test('review 2 — a stale link paid before the retirement: the devis is converted and the money booked at the amount received', async () => {
  const { db, id, links, model } = seed({ deposit: 0, balance: 463.12 });
  const stale = links.create({ reservationId: id, type: 'full', amountCents: 46312, providerLinkId: 'old', url: 'u', status: 'open' });
  db.prepare('UPDATE reservations SET balanceAmount = 610.12, finalPrice = 610.12 WHERE id = ?').run(id);
  const retired = model.__retireStaleLinks(id);
  const provider = {
    id: 'qonto', cancelLink: async () => { throw new Error('link is paid'); }, getLinkStatus: async () => 'paid',
    getPayment: async () => ({ paid: true, paymentId: 'pay1', paidAt: '2027-04-01T10:00:00Z' }),
  };
  await deactivateAbandonedLinks(retired, { paymentLinksModel: links, providerFor: () => provider });
  const alerts = [];
  const out = await retryPendingCancellations({
    paymentLinksModel: links, provider, database: db, devisModel: model, emitPluginEvent: () => {},
    notifyPaidAfterCancel: async (l, o) => alerts.push(o),
  });
  const devis = db.prepare('SELECT devisStatus, convertedReservationId FROM reservations WHERE id = ?').get(id);
  assert.ok(devis.convertedReservationId, 'converted');
  const resa = db.prepare('SELECT balanceAmount, balancePaid, complementAmount FROM reservations WHERE id = ?').get(devis.convertedReservationId);
  assert.equal(Number(resa.balanceAmount), 463.12);
  assert.equal(Number(resa.balancePaid), 1);
  assert.equal(Number(resa.complementAmount), 147);
  assert.equal(out.results[0].status, 'paid');
  assert.deepEqual(alerts, [{ amountMismatch: { expectedCents: 61012, receivedCents: 46312 } }]);
  assert.equal(links.findById(stale.id).status, 'paid');
});

test('review 2 — after the retirement the provider is asked first: a paid link is not cancelled, an unpaid one is', async () => {
  const { db, id, links, model } = seed({ deposit: 0, balance: 463.12 });
  const paidLink = links.create({ reservationId: id, type: 'full', amountCents: 46312, providerLinkId: 'paid', url: 'u', status: 'open' });
  const idleLink = links.create({ reservationId: id, type: 'deposit', amountCents: 5000, providerLinkId: 'idle', url: 'u', status: 'open' });
  db.prepare('UPDATE reservations SET depositAmount = 0, balanceAmount = 610.12, finalPrice = 610.12 WHERE id = ?').run(id);
  const retired = model.__retireStaleLinks(id);
  assert.equal(retired.length, 2);
  const cancelled = [];
  const provider = {
    id: 'qonto', cancelLink: async (pid) => cancelled.push(pid), getLinkStatus: async () => 'open',
    getPayment: async (pid) => (pid === 'paid' ? { paid: true, paymentId: 'p', paidAt: '2027-04-01T10:00:00Z' } : { paid: false }),
  };
  const result = await settleRetiredDevisLinks(retired, {
    database: db, paymentLinksModel: links, devisModel: model, provider, providerFor: () => provider,
    notifyPaidAfterCancel: async () => {},
  });
  assert.deepEqual(cancelled, ['idle'], 'the paid link is never deactivated');
  assert.equal(result.paid, true);
  assert.equal(links.findById(paidLink.id).status, 'paid', 'booked');
  assert.equal(links.findById(idleLink.id).remoteCancelPendingAt, null);
});

test('review 3 — the retirement leaves a history row on the devis and counts the links', () => {
  const { db, id, links, model } = seed();
  links.create({ reservationId: id, type: 'full', amountCents: 54536, providerLinkId: 'pre18', url: 'u', status: 'open' });
  const retired = model.__retireStaleLinks(id);
  assert.equal(retired.length, 1);
  const changes = db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ?').all(id)
    .map((r) => JSON.parse(r.changedFields)).flat();
  assert.deepEqual(changes.map((c) => [c.field, c.from.replace(/\s/g, ' ')]), [['paymentLinkRetired', '545,36 €']]);
});

test('review 6 — a legacy devis stored without its acompte/solde split is converted and ticked as before', async () => {
  const { db, id, links, model } = seed();
  db.prepare('UPDATE reservations SET depositAmount = NULL, balanceAmount = NULL WHERE id = ?').run(id);
  const link = links.create({ reservationId: id, type: 'full', amountCents: 30000, providerLinkId: 'legacy', url: 'u', status: 'open' });
  assert.deepEqual(model.__retireStaleLinks(id), [], 'nothing to compare with');
  const { out, alerts } = await pay(db, links, model, link);
  assert.equal(out.effect, 'converted');
  assert.equal(out.amountMismatch, undefined);
  assert.deepEqual(alerts, []);
});

test('review 4 — the mismatch alert says no confirmation went out and where the balance stands', () => {
  const { buildPaidAfterCancelEmail } = notificationService.__test;
  const resa = { id: 1, devisNumber: 'D-1', propertyName: 'Gite', startDate: '2027-05-10', endDate: '2027-05-14' };
  const short = buildPaidAfterCancelEmail(resa, { amountCents: 54536 }, '', { amountMismatch: { expectedCents: 55500 } }).text;
  assert.match(short, /Aucun e-mail de confirmation/);
  assert.match(short, /9,64.*complément d’arrivée/);
  const over = buildPaidAfterCancelEmail(resa, { amountCents: 56000 }, '', { amountMismatch: { expectedCents: 55500 } }).text;
  assert.match(over, /trop-perçu/);
});
