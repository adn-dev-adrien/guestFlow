// specs/plugins-phase-3a-online-payment.md rules 45 and 46 (audit R5 M1): an acompte ticked the day an old full link
// is paid is that link's own money even when the stay was re-priced meanwhile — whether the operator's tick
// or the webhook comes first, the stay ends the same, and the alert reads the full amount.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { processPaidLink, retryPendingCancellations } = require('../utils/paymentPollRunner');
const { storedOverpaymentOf } = require('../utils/overpayment');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const DAY = '2027-03-01';
const PAID_AT = `${DAY}T09:00:00Z`;

function seed({ asDevis = true } = {}) {
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
  const tick = (date = DAY) => db.prepare('UPDATE reservations SET depositPaid = 1, depositPaidDate = ? WHERE id = ?').run(date, rid);
  const reprice = (balance) => db.prepare('UPDATE reservations SET balanceAmount = ?, finalPrice = ? WHERE id = ?').run(balance, 100 + balance, rid);
  const retire = (reason) => {
    if (reason === 'settled') links.retireSettled();
    else links.retireForAmountChange(rid, 'full', 1);
  };
  const payRetired = async () => {
    const provider = { id: 'qonto', async getPayment() { return { paid: true, paymentId: 'pF', paidAt: PAID_AT }; }, async cancelLink() {} };
    const { results } = await retryPendingCancellations({ ...common, provider, only: F.id });
    return results.find((r) => r.id === F.id);
  };
  const payLive = () => processPaidLink({
    ...common, paymentLinksModel: Object.assign(Object.create(links), { retireSettled: () => [] }),
    link: links.findById(F.id), paidPayment: { paid: true, paymentId: 'pF', paidAt: PAID_AT },
  });
  const snapshot = () => {
    const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(rid);
    return {
      depositAmount: row.depositAmount, balanceAmount: row.balanceAmount, complementAmount: row.complementAmount,
      depositPaid: row.depositPaid, balancePaid: row.balancePaid,
      stored: storedOverpaymentOf({ row, captured: {} }),
    };
  };
  const refunds = () => db.prepare("SELECT 1 FROM reservation_history WHERE changedFields LIKE '%refundOwed%'").all();
  const alerts = () => calls.filter((c) => c[0] === 'alert');
  return { db, links, rid, F, reprice, tick, retire, payRetired, payLive, snapshot, refunds, alerts };
}

// The reference: nobody ticks, the webhook comes first (the link is paid for 455,36 whatever the stay asks).
const CASES = [
  { label: 'grown', balance: 455.36, expected: { depositAmount: 100, balanceAmount: 355.36, complementAmount: 100, stored: 0 }, expectedCents: 55536 },
  { label: 'shrunk', balance: 255.36, expected: { depositAmount: 100, balanceAmount: 355.36, complementAmount: 0, stored: 100 }, expectedCents: 35536 },
];

for (const { label, balance, expected, expectedCents } of CASES) {
  for (const [path_, reason] of [['live', null], ['retry settled', 'settled'], ['retry amount-changed', 'amount-changed']]) {
    test(`rule 45: ${label}, ${path_} — the acompte ticked the day of the payment gives the stay the webhook-first order gives`, async () => {
      const reference = seed();
      reference.reprice(balance);
      if (reason) { reference.retire('amount-changed'); await reference.payRetired(); } else await reference.payLive();
      const want = reference.snapshot();
      assert.deepEqual({ ...want, depositPaid: undefined, balancePaid: undefined }, { ...expected, depositPaid: undefined, balancePaid: undefined }, 'the reference itself');

      const s = seed();
      s.reprice(balance);
      s.tick(DAY);
      if (reason) { s.retire(reason); } 
      if (reason) await s.payRetired(); else await s.payLive();
      assert.deepEqual(s.snapshot(), want, 'identical stay whichever comes first');
      assert.equal(s.snapshot().depositPaid, 1);
      assert.equal(s.snapshot().balancePaid, 1);
      assert.equal(s.refunds().length, 0);
      assert.equal(s.alerts().length, 1);
      assert.deepEqual(s.alerts()[0][2].amountMismatch, { expectedCents, receivedCents: 45536 }, 'the alert compares with the full amount');
    });
  }
}

test('rule 45: an acompte ticked on an earlier day is still judged against the solde (rule 41 unchanged)', async () => {
  const s = seed();
  s.reprice(255.36);
  s.tick('2027-02-01');
  const out = await s.payLive();
  assert.deepEqual(out.amountMismatch, { expectedCents: 25536, receivedCents: 45536 });
  assert.equal(s.snapshot().stored, 200);
});

test('rule 45: a paid acompte link behind the tick keeps the acompte a second payment', async () => {
  const s = seed();
  s.reprice(255.36);
  s.links.create({ reservationId: s.rid, type: 'deposit', amountCents: 10000, provider: 'qonto', providerLinkId: 'D', url: 'ud', status: 'paid' });
  s.tick(DAY);
  const out = await s.payLive();
  assert.equal(out.effect, 'double-payment');
  assert.equal(s.refunds().length, 1);
});

test('rule 46: the alert of an amount equal to what the stay asks does not wait for a difference', () => {
  const { buildPaidAfterCancelEmail } = require('../utils/notificationService').__test;
  const link = { id: 1, amountCents: 45536 };
  const equal = buildPaidAfterCancelEmail({ id: 1 }, link, '', { amountMismatch: { expectedCents: 45536, receivedCents: 45536 } }).text;
  assert.match(equal, /Le montant reçu couvre ce que le séjour demande/);
  assert.doesNotMatch(equal, /différence/);
  assert.match(equal, /À vérifier : envoyer la confirmation au client\./);
  const owed = buildPaidAfterCancelEmail({ id: 1 }, link, '', { amountMismatch: { expectedCents: 55536, receivedCents: 45536 } }).text;
  assert.match(owed, /une fois la différence réglée/);
});
