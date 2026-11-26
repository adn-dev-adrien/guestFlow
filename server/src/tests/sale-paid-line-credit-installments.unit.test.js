// specs/pricing/pricing-components.md §3 rules 104, 118, 119 on a direct stay paying by instalments (stabilisation loop t9, sale domain: what the round-9
// reviewer could not probe — the prod copy holds no plan). The plan is the stay's pre-arrival money: rule 104 never credits it (the engine's
// credit skips the acompte and the solde of a stay with a plan), so a paid line offered through the line API or at the arrival SAS — and a
// refund on its trop-perçu deleted — leaves the instalments, `installmentsTarget` and the buckets as they are; the freed money is owed back,
// the same on both screens, and Σ received − owed − total never moves.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refunds = require('../controllers/refundsController');
const installments = require('../models/installmentsModel');
const { withNow } = require('../utils/localDate');
const { storedBody } = require('../utils/stayOrderLines');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const registry = require('../plugins/sdk/registry');
const sas = optionalPlugin(() => require('../plugins/sas/controller'));

registry.configure({ isActive: () => true, allows: () => true });

const ADMIN = { id: 1, roles: ['admin'] };
const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const cents = (v) => Math.round(Number(v || 0) * 100);
const notes = (id) => JSON.parse(row(id).midStaySettledNotes || '[]').reduce((sum, note) => sum + cents(note.total), 0);
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
const refunded = (id) => cents(db.prepare('SELECT COALESCE(SUM(totalTtc), 0) AS s FROM reservation_refunds WHERE reservationId = ?').get(id).s);
const balanced = (id) => {
  const r = row(id);
  return cents(r.depositAmount) + cents(r.balanceAmount) + cents(r.complementAmount) + cents(r.endOfStayComplementAmount) + notes(id) - refunded(id) - owed(id)
    - cents(r.finalPrice) - cents(r.touristTaxTotal);
};
const plan = (id) => {
  const r = row(id);
  return {
    rows: db.prepare('SELECT amountCents, paid FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(id).map((i) => [i.amountCents, i.paid]),
    target: cents(r.installmentsTarget), unpaid: cents(r.installmentsUnpaidAmount), deposit: cents(r.depositAmount), balance: cents(r.balanceAmount),
  };
};
const beerLine = (id) => db.prepare('SELECT lineId, offered FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, beer);
const callSas = (fn, id, body) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  sas[fn]({ params: { id: String(id) }, body, user: ADMIN, query: {} }, res);
  return res;
};

// A direct stay of 300 € paid in three instalments (the first one paid), a beer ordered in the app 3 days before the arrival and paid by card (30 €).
function plannedStayWithCardLine() {
  const id = stay(3);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  const model = installments.buildModel(db);
  model.replacePlan(id, [10000, 10000, 10000].map((amountCents, i) => ({ number: i + 1, dueDate: addDaysToIsoDate(todayIso(), i), amountCents })), 30000);
  model.markPaid(model.listFor(id)[0].id, { paidDate: todayIso(), method: 'transfer' });
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-1' }, orderRef: 'order:1' }).status, 200);
  return id;
}

test('rules 104, 118 — a plan is no bucket the credit takes: the line API and the arrival SAS offer the paid line alike, the plan untouched, 30 € owed', { skip: skipWithout(['sas']) }, () => {
  const byApi = plannedStayWithCardLine();
  const bySas = plannedStayWithCardLine();
  const before = { api: [plan(byApi), balanced(byApi)], sas: [plan(bySas), balanced(bySas)] };
  assert.equal(before.api[0].target, 30000);

  const door = (id) => at(id, '15:00');
  const refused = extraSale.changeLine(byApi, `option:${beerLine(byApi).lineId}`, { offered: true }, { now: door(byApi) });
  assert.deepEqual([refused.status, refused.body.code], [409, 'OVERPAID'], 'nothing absorbs the credit: the trop-perçu is asked first');
  const api = extraSale.changeLine(byApi, `option:${beerLine(byApi).lineId}`, { offered: true }, { now: door(byApi), forceOverpayment: true });
  assert.equal(api.status, 200, JSON.stringify(api.body));

  const offered = { offered: [{ kind: 'option', id: beer }] };
  const sasRefused = withNow(door(bySas), () => callSas('commitArrival', bySas, offered));
  assert.deepEqual([sasRefused.statusCode, sasRefused.body.code], [409, 'OVERPAID'], 'the SAS asks the same confirmation');
  const done = withNow(door(bySas), () => callSas('commitArrival', bySas, { ...offered, forceOverpayment: true }));
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));

  for (const [id, key] of [[byApi, 'api'], [bySas, 'sas']]) {
    assert.equal(beerLine(id).offered, 1, key);
    assert.deepEqual(plan(id), before[key][0], `${key}: the instalments, installmentsTarget and the buckets do not move`);
    assert.equal(owed(id), 3000, `${key}: the freed money is owed back`);
    assert.equal(balanced(id), before[key][1], `${key}: Σ received − owed − total unchanged`);
  }
  assert.equal(row(bySas).finalPrice, row(byApi).finalPrice);
});

test('rule 119 — a refund on that trop-perçu deleted: the money is owed again, the plan and installmentsTarget untouched', () => {
  const id = plannedStayWithCardLine();
  const now = at(id, '15:00', -2);
  assert.equal(extraSale.changeLine(id, `option:${beerLine(id).lineId}`, { offered: true }, { now, forceOverpayment: true }).status, 200);
  const kept = plan(id);
  const gap = balanced(id);
  const over = ctrl.storedOverpayment(id);
  const res = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
  const made = res();
  refunds.create({
    params: { id: String(id) }, query: {}, user: { id: 1, role: 'admin' },
    body: {
      refundDate: todayIso(), method: over.overpaymentMethod || 'transfer', reason: 'Trop-perçu', fromOverpayment: true, overpaymentTtc: over.overpaymentTtc,
      lines: over.overpaymentLines.map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amountTtc: l.amountTtc })),
    },
  }, made);
  assert.equal(made.statusCode, 201, JSON.stringify(made.body));
  assert.deepEqual([owed(id), balanced(id), plan(id)], [0, gap, kept]);
  const gone = res();
  refunds.remove({ params: { id: String(id), refundId: String(made.body.refund.id) }, query: {}, user: { id: 1, role: 'admin' } }, gone);
  assert.equal(gone.statusCode, 200, JSON.stringify(gone.body));
  assert.deepEqual([owed(id), balanced(id), plan(id)], [3000, gap, kept]);
});
