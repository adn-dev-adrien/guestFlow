// specs/plugins-phase-3a-online-payment.md rules 41, 42 and 44 (audit R4 Q3, Q4, R2: the alert reads the solde): a full link whose acompte was collected
// another way is judged against the stay it pays — a re-priced stay books what was received, a same-day
// tick is the same money, and only a real second acompte is a refund.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { processPaidLink, retryPendingCancellations } = require('../utils/paymentPollRunner');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed({ asDevis }) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'J', 'D', 'j@x.fr')").run();
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount, devisStatus)
    VALUES (?, 1, 1, '2027-05-10', '2027-05-14', 1, 455.36, 100, 355.36, ?)`).run(asDevis ? 'devis' : 'reservation', asDevis ? 'draft' : null).lastInsertRowid);
  const links = paymentLinksModel.buildModel(db);
  const dm = devisModel.buildModel(db);
  const F = links.create({ reservationId: id, type: 'full', amountCents: 45536, provider: 'qonto', providerLinkId: 'F', url: 'u', status: 'open' });
  const rid = asDevis ? dm.convertToReservation(id).data.reservationId : id;
  const calls = [];
  const common = {
    database: db, devisModel: dm, paymentLinksModel: links,
    sendConfirmation: async (x) => calls.push(['confirm', x]), notifyPaidAfterCancel: async (l, o) => calls.push(['alert', l.id, o]), emitPluginEvent: () => {},
  };
  const tickDeposit = (date = '2027-03-01') => db.prepare('UPDATE reservations SET depositPaid = 1, depositPaidDate = ? WHERE id = ?').run(date, rid);
  const reprice = (balance) => db.prepare('UPDATE reservations SET balanceAmount = ?, finalPrice = ? WHERE id = ?').run(balance, 100 + balance, rid);
  const payRetired = async (at = '2027-03-01T15:00:00Z') => {
    const provider = { id: 'qonto', async getPayment() { return { paid: true, paymentId: 'pF', paidAt: at }; }, async cancelLink() {} };
    const { results } = await retryPendingCancellations({ ...common, provider, only: F.id });
    return results.find((r) => r.id === F.id);
  };
  const payLive = (at = '2027-03-01T15:00:00Z') => processPaidLink({
    ...common, paymentLinksModel: Object.assign(Object.create(links), { retireSettled: () => [] }),
    link: links.findById(F.id), paidPayment: { paid: true, paymentId: 'pF', paidAt: at },
  });
  const refunds = () => db.prepare("SELECT changedFields FROM reservation_history WHERE changedFields LIKE '%refundOwed%'").all();
  const stay = () => db.prepare('SELECT depositPaid, balancePaid, depositAmount, balanceAmount FROM reservations WHERE id = ?').get(rid);
  return { db, links, rid, F, calls, tickDeposit, reprice, payRetired, payLive, refunds, stay };
}

for (const [balance, label] of [[455.36, 'grown'], [255.36, 'shrunk']]) {
  test(`rule 41: a settled-retired full link paid after the stay was re-priced (${label}) books what was received`, async () => {
    const s = seed({ asDevis: true });
    s.tickDeposit('2027-02-01');
    s.links.retireSettled();
    assert.equal(s.links.findById(s.F.id).cancelReason, 'settled');
    s.reprice(balance);
    const out = await s.payRetired('2027-03-01T15:00:00Z');
    assert.equal(out.status, 'paid');
    assert.deepEqual(out.amountMismatch, { expectedCents: Math.round(balance * 100), receivedCents: 45536 }, 'compared with the solde the link was booked as');
    const { buildPaidAfterCancelEmail } = require('../utils/notificationService').__test;
    const text = buildPaidAfterCancelEmail({ id: 1 }, s.links.findById(s.F.id), '', { amountMismatch: out.amountMismatch }).text;
    if (balance > 455) assert.doesNotMatch(text, /à percevoir|à rembourser/, 'grown: nothing to chase');
    else assert.match(text, /Trop-perçu de 200,00/, 'shrunk: the true excess');
    const stay = s.db.prepare('SELECT * FROM reservations WHERE id = ?').get(s.rid);
    const { storedOverpaymentOf } = require('../utils/overpayment');
    const stored = storedOverpaymentOf({ row: stay, captured: {} });
    assert.equal(stored, balance > 455 ? 0 : 200, 'the fiche refund block reads the same excess');
    assert.equal(s.refunds().length, 0, 'no fixed « acompte payé deux fois » row');
    assert.equal(s.stay().balancePaid, 1);
    assert.equal(s.stay().balanceAmount, 455.36, 'the solde is what the link brought in');
    assert.ok(s.calls.some((c) => c[0] === 'alert' && c[2] && c[2].amountMismatch));
  });
}

test('rule 41: a settled-retired full link whose amount still matches keeps the acompte duplicate', async () => {
  const s = seed({ asDevis: true });
  s.tickDeposit('2027-02-01');
  s.links.retireSettled();
  const out = await s.payRetired();
  assert.equal(out.status, 'paid-after-cancel');
  assert.equal(out.duplicateCents, 10000);
  assert.equal(s.refunds().length, 1);
});

test('rule 41: a devis-owned open full link paid on a re-priced stay is not the acompte duplicate (live path)', async () => {
  const s = seed({ asDevis: true });
  s.tickDeposit('2027-02-01');
  s.reprice(255.36);
  const out = await s.payLive();
  assert.equal(out.status, 'paid');
  assert.deepEqual(out.amountMismatch, { expectedCents: 25536, receivedCents: 45536 });
  assert.equal(s.refunds().length, 0);
});

test('rule 42: the acompte ticked the day the full link was paid is the same money, not a refund (retry path)', async () => {
  const s = seed({ asDevis: false });
  s.tickDeposit('2027-03-01');
  s.links.retireSettled();
  const out = await s.payRetired('2027-03-01T09:00:00Z');
  assert.equal(out.status, 'paid');
  assert.equal(out.effect, 'settled-elsewhere');
  assert.equal(s.refunds().length, 0);
  assert.equal(s.calls.length, 0);
  assert.equal(s.stay().balancePaid, 1);
});

test('rule 42: an acompte ticked on an earlier day is still a second acompte', async () => {
  const s = seed({ asDevis: false });
  s.tickDeposit('2027-02-01');
  s.links.retireSettled();
  const out = await s.payRetired('2027-03-01T09:00:00Z');
  assert.equal(out.status, 'paid-after-cancel');
  assert.equal(out.duplicateCents, 10000);
});

test('rule 42: the same-day reasoning also holds on the live path', async () => {
  const s = seed({ asDevis: false });
  s.tickDeposit('2027-03-01');
  const out = await s.payLive('2027-03-01T09:00:00Z');
  assert.equal(out.status, 'paid');
  assert.equal(s.refunds().length, 0);
  assert.equal(s.stay().balancePaid, 1);
});

test('rule 42: an acompte link paid the same day is still a real second acompte', async () => {
  const s = seed({ asDevis: false });
  const D = s.links.create({ reservationId: s.rid, type: 'deposit', amountCents: 10000, provider: 'qonto', providerLinkId: 'D', url: 'ud', status: 'open' });
  const p = (link, at) => processPaidLink({
    database: s.db, devisModel: devisModel.buildModel(s.db), paymentLinksModel: Object.assign(Object.create(s.links), { retireSettled: () => [] }),
    link: s.links.findById(link), paidPayment: { paid: true, paymentId: `p${link}`, paidAt: at }, notifyPaidAfterCancel: async () => {}, emitPluginEvent: () => {},
  });
  await p(D.id, '2027-03-01T08:00:00Z');
  const out = await p(s.F.id, '2027-03-01T09:00:00Z');
  assert.equal(out.effect, 'double-payment');
  assert.equal(s.refunds().length, 1);
});
