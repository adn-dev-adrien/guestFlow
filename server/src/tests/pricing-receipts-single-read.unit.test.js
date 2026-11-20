// specs/pricing-components.md §3 rule 48 — `PaymentLedger.receipts(id)` is the one read of what a stay received: SCHEDULE
// and REFUNDS take the split each bucket received from it; its settlements and allocations are read only by a reader that asks
// for them (a quote reads neither, and never the default database). Same figures as the direct read.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  controller, respond, ADMIN, TODAY, rowOf, NO_ACOMPTE, forced, fiche,
} = require('./moneyLedgerFixture');
const { readSplitReceived } = require('../utils/splitReceived');
const paymentLedger = require('../models/ports/paymentLedger');
const db = require('../database');

const cents = (euros) => Math.round(Number(euros) * 100);
const card = (amountCents) => ({ method: 'card', amountCents, internal: false });

function call(handler, params, body) {
  const res = respond();
  handler({ params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), body, user: ADMIN }, res);
  return res;
}

// A direct stay with no acompte and an 80 € line at the arrival, its solde and complement paid in one settlement short of 50 €.
function pooledStay() {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(80)] });
  const r0 = rowOf(stay.id);
  const due = cents(r0.balanceAmount) + cents(r0.complementAmount);
  const res = call(controller.settleArrivalPayment, { id: stay.id }, {
    mode: 'split', date: TODAY, expectedAmountCents: due, tenders: [card(due - 5000)], shortfall: { kind: 'due' },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return stay;
}

test('rule 48 — receipts(id).splitReceived is the direct read of the split, a pool included', () => {
  const stay = pooledStay();
  const receipts = paymentLedger.create(db).receipts(stay.id);
  assert.equal(receipts.settlements.length, 1);
  assert.ok(receipts.splitReceived && receipts.splitReceived.pools.length === 1);
  assert.deepEqual(receipts.splitReceived, readSplitReceived(db, stay.id));
  assert.deepEqual(paymentLedger.create(db).splitReceived(stay.id), receipts.splitReceived);
});

test('rule 48 — a stay with no settlement receives no split; an unknown or unsaved stay neither', () => {
  const stay = fiche(NO_ACOMPTE, 'direct', {});
  const ledger = paymentLedger.create(db);
  assert.equal(ledger.receipts(stay.id).splitReceived, null);
  assert.equal(ledger.receipts(0).splitReceived, null);
  assert.deepEqual(ledger.receipts(0).settlements, []);
  assert.equal(readSplitReceived(db, stay.id), null);
});

test('rule 48 — receipts reads the settlements and the allocations only when they are asked for', () => {
  const stay = pooledStay();
  const seen = [];
  const spy = new Proxy(db, {
    get(target, key) {
      if (key === 'prepare') return (sql) => { seen.push(sql); return target.prepare(sql); };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const receipts = paymentLedger.create(spy).receipts(stay.id);
  assert.ok(!seen.some((sql) => /payment_allocations|SELECT \* FROM payment_settlements/.test(sql)), 'the split alone reads neither');
  assert.ok(Array.isArray(receipts.allocations));
  assert.equal(receipts.settlements.length, 1);
  assert.ok(seen.some((sql) => /payment_allocations/.test(sql)));
  assert.ok(seen.some((sql) => /SELECT \* FROM payment_settlements/.test(sql)));
});

test('rule 48 — the fiche reads the same plan whether SCHEDULE reads the receipts or the split directly', async () => {
  const stay = pooledStay();
  const before = rowOf(stay.id);
  const res = respond();
  await controller.update({ params: { id: stay.id }, body: stay.body, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const after = rowOf(stay.id);
  for (const column of ['finalPrice', 'depositAmount', 'balanceAmount', 'complementAmount', 'splitShortfallDue']) {
    assert.equal(after[column], before[column], column);
  }
});
