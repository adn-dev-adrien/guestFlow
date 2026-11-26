// specs/pricing/pricing-components.md §3 rules 19, 29, 96 (loop t1 S-4, S-5) — the stay's first breakfast sold before the arrival is a new line routed to the
// arrival complement; a breakfast morning paid by card before the arrival, merged into that line, is settled by what the line grew.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stay, row, breakfast, morning } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');

const mornings = (id, n) => [{ articleRef: `option:${breakfast}`, quantity: 1, mornings: [morning(id, n)], time: '09:00', persons: 2 }];

test('S-5 — the first breakfast sold before the arrival is quoted and written in the arrival complement', () => {
  const id = stay(20);
  const quoted = extraSale.quote(id, mornings(id, 1));
  assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
  assert.deepEqual([quoted.buckets.plan, quoted.buckets.arrival], [0, quoted.totalCents]);
  const sold = extraSale.sell(id, mornings(id, 1), {});
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.equal(Math.round(Number(row(id).complementAmount) * 100), quoted.totalCents);
  assert.equal(sold.saleDetail.buckets.arrival, quoted.totalCents);
});

test('S-4 — a second morning paid by card before the arrival is settled on the breakfast line: nothing owed back, the complement unchanged', () => {
  const id = stay(20);
  assert.equal(extraSale.sell(id, mornings(id, 1), {}).status, 200);
  const complement = Number(row(id).complementAmount);
  const quoted = extraSale.quote(id, mornings(id, 2), { source: 'shop' });
  const sold = extraSale.sell(id, mornings(id, 2), { source: 'shop', orderRef: 'order:1', paid: { amountCents: quoted.totalCents, ref: '1' } });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.deepEqual([sold.settledCents, sold.overpaidCents], [quoted.totalCents, 0]);
  assert.equal(Number(row(id).complementAmount), complement, 'the card paid the new morning: the arrival complement does not ask it again');
});
