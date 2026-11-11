// specs/pricing-components.md §3 rules 38 and 6 — the shared money helpers: `roundMoney` is the engine's own
// (same function, same results as before the move), `toCents` / `fromCents` convert, `allocateCents` is the
// largest-remainder split whose shares always sum to the total.
const test = require('node:test');
const assert = require('node:assert/strict');
const money = require('../utils/pricing/money');
const pricing = require('../utils/pricing');

test('rule 38 — roundMoney rounds to the cent like the engine always did', () => {
  assert.equal(money.roundMoney(1.006), 1.01);
  assert.equal(money.roundMoney(2.675), 2.68);
  assert.equal(money.roundMoney('12.344'), 12.34);
  assert.equal(money.roundMoney(null), 0);
  assert.equal(money.roundMoney(undefined), 0);
  assert.equal(money.roundMoney(-0.005), -0);
  assert.equal(money.roundMoney(-1.235), -1.24);
});

test('rule 6 — pricing.js re-exports the very same roundMoney', () => {
  assert.equal(pricing.roundMoney, money.roundMoney);
});

test('rule 38 — toCents and fromCents convert and tolerate blanks', () => {
  assert.equal(money.toCents(12.34), 1234);
  assert.equal(money.toCents('0.1') + money.toCents(0.2), 30);
  assert.equal(money.toCents(null), 0);
  assert.equal(money.toCents(19.99), 1999);
  assert.equal(money.fromCents(1234), 12.34);
  assert.equal(money.fromCents(undefined), 0);
  assert.equal(money.fromCents(money.toCents(8.05)), 8.05);
});

test('rule 38 — allocateCents: shares sum to the total, leftover cents go to the largest remainders', () => {
  assert.deepEqual(money.allocateCents(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(money.allocateCents(10, [3, 1]), [8, 2]);
  assert.deepEqual(money.allocateCents(1, [1, 1]), [1, 0]);
  const shares = money.allocateCents(9999, [1234, 5678, 91011, 1213]);
  assert.equal(shares.reduce((a, b) => a + b, 0), 9999);
  assert.ok(shares.every((s) => Number.isInteger(s) && s >= 0));
});

test('rule 38 — allocateCents: a tie goes to the earliest item, a zero weight never gets a cent', () => {
  assert.deepEqual(money.allocateCents(2, [1, 1, 1]), [1, 1, 0]);
  assert.deepEqual(money.allocateCents(1, [0, 5, 5]), [0, 1, 0]);
  assert.deepEqual(money.allocateCents(5, [0, 0]), [0, 0]);
  assert.deepEqual(money.allocateCents(0, [3, 4]), [0, 0]);
  assert.deepEqual(money.allocateCents(7, []), []);
});

test('rule 38 and 40 — allocateCents: a group holding a discount shares in proportion to the signed amounts', () => {
  assert.deepEqual(money.allocateCents(-7, [3, -1]), [-10, 3]);
  assert.deepEqual(money.allocateCents(5, [4, -1]).reduce((a, b) => a + b, 0), 5);
  assert.deepEqual(money.allocateCents(5, [2, -2]), [0, 0], 'weights that cancel out share nothing');
  assert.deepEqual(money.allocateCents(-3, [1, 1, 1]), [-1, -1, -1]);
});

test('rule 38 — roundMoney rounds half toward +infinity on the float product', () => {
  assert.equal(money.roundMoney(-0.125), -0.12);
  assert.equal(money.roundMoney(0.125), 0.13);
});
