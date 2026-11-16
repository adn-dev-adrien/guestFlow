// specs/pricing-components.md §3 rule 30 (loop t1 S-7) — a quote refuses what the sale would refuse before pricing: a payment taken now before the arrival.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stay, beer } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');

test('S-7 — a cash quote before the arrival answers 409 PAYMENT_BEFORE_ARRIVAL, like the sale; a later quote still prices', () => {
  const id = stay(20);
  const request = [{ articleRef: `option:${beer}`, quantity: 1 }];
  const quoted = extraSale.quote(id, request, { payment: 'cash' });
  assert.deepEqual([quoted.status, quoted.body && quoted.body.code], [409, 'PAYMENT_BEFORE_ARRIVAL']);
  assert.equal(extraSale.sell(id, request, { payment: 'cash' }).body.code, 'PAYMENT_BEFORE_ARRIVAL');
  assert.equal(extraSale.quote(id, request).status, 200);
});
