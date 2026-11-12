// specs/pricing-components.md §3 rule 65 (class E4b) — an hourly booking cuts its VAT like every other reader that moved onto the VAT
// component: the VAT is the rounded share of the TTC, the net what is left. At 2.1, 5.5, 8.5 and 10 % the figures are the former
// net-first ones; at 20 % a tie amount moves its net by one cent, the total never changes.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { vatOf } = require('../plugins/hourly-resources/bookingPricing');
const { splitTtc } = require('../utils/pricing/vat');

const former = (total, rate) => { const net = Math.round((total / (1 + rate / 100)) * 100) / 100; return { amount: Math.round((total - net) * 100) / 100, net }; };

test('rule 65 — the hourly VAT is splitTtc, and the former net-first cut elsewhere than 20 %', () => {
  for (const rate of [2.1, 5.5, 8.5, 10]) {
    for (let cents = 1; cents <= 20000; cents += 7) {
      const total = cents / 100;
      assert.deepEqual(vatOf(total, { rate }), { rate, ...former(total, rate) }, `${total} @ ${rate}`);
    }
  }
});

test('rule 65 (E4b) — at 20 % a tie amount moves by a cent, the sum stays the total; no VAT, no cut', () => {
  const moved = [];
  for (let cents = 1; cents <= 5000; cents += 1) {
    const total = cents / 100;
    const cut = vatOf(total, { rate: 20 });
    assert.equal(Math.round((cut.amount + cut.net) * 100), cents);
    assert.deepEqual([cut.amount, cut.net], [splitTtc(total, 20).vat, splitTtc(total, 20).net]);
    if (cut.net !== former(total, 20).net) moved.push(total);
  }
  assert.ok(moved.length > 0 && moved.includes(0.09), 'e.g. 0.09 € : net 0.07, VAT 0.02 (was 0.08 and 0.01)');
  assert.equal(vatOf(10, null), null);
  assert.equal(vatOf(10, { rate: null }), null);
});
