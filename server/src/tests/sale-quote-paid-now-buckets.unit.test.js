// specs/pricing-components.md §3 rule 30 (stabilisation loop t4, S4-4, 2026-11-16) — a quote paid now (cash, card terminal) announces the buckets the
// sale writes: the note settles the departure remainder in the same transaction, so the departure does not move. Before: `{ departure: 4500 }`.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const c = (v) => Math.round(Number(v || 0) * 100);
const buckets = (r) => ({ plan: c(r.depositAmount) + c(r.balanceAmount), arrival: c(r.complementAmount), departure: c(r.endOfStayComplementAmount) });

for (const payment of ['cash', 'card-terminal']) {
  test(`S4-4 — a ${payment} quote: its buckets are the ones the sale writes`, () => {
    const id = stay(20);
    const now = at(id, '12:00', 1);
    const basket = [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }];
    const before = buckets(row(id));
    const quote = extraSale.quote(id, basket, { now, payment });
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    const sold = extraSale.sell(id, basket, { now, payment, acceptedTotalCents: quote.totalCents });
    assert.equal(sold.status, 200, JSON.stringify(sold.body));
    const after = buckets(row(id));
    assert.deepEqual(quote.buckets, { plan: after.plan - before.plan, arrival: after.arrival - before.arrival, departure: after.departure - before.departure });
    assert.equal(quote.buckets.departure, 0);
  });
}
