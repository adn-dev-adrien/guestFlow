// specs/pricing-components.md §3 rule 72 — REFUNDS / refundable: the budget of a cancelled stay, the lines a refund can
// still draw from, and the two allocations that stay different on purpose (rule 38): `capInOrder` takes the excess off the
// lines in the order given, `spreadBucketRefund` spreads in proportion with the leftover cent on the earlier line.
const test = require('node:test');
const assert = require('node:assert/strict');
const refundable = require('../utils/pricing/refunds/refundable');
const legacy = require('../utils/refunds');
const money = require('../utils/pricing/money');

const { cancelledRefundBudget, buildRefundableLines, capInOrder, spreadBucketRefund } = refundable;

test('rule 72 — the legacy module re-exports the budget and the refundable lines', () => {
  assert.equal(legacy.cancelledRefundBudget, cancelledRefundBudget);
  assert.equal(legacy.buildRefundableLines, buildRefundableLines);
});

test('rule 72 — a cancelled stay: the indemnity left is what the avoir requalified less what was drawn from it, within what was collected', () => {
  const budget = cancelledRefundBudget({
    collectedTtc: 300,
    cashCollectedTtc: 50,
    refunds: [
      { id: 1, method: 'retained', totalTtc: 200, lines: [{ lineKey: 'accommodation', bucket: 'accommodation', amountTtc: 200 }] },
      { id: 2, method: 'internal', totalTtc: 20, lines: [{ bucket: 'accommodation', amountTtc: 20 }] },
      { id: 3, method: 'transfer', totalTtc: 30, lines: [{ bucket: 'indemnity', amountTtc: 30 }] },
    ],
  });
  assert.deepEqual(budget, { collectedTtc: 300, indemnityLeftTtc: 170, saleLeftTtc: 130, cashCollectedTtc: 50, cashLeftTtc: 30 });
  assert.deepEqual(cancelledRefundBudget({ collectedTtc: 0 }), {
    collectedTtc: 0, indemnityLeftTtc: 0, saleLeftTtc: 0, cashCollectedTtc: 0, cashLeftTtc: 0,
  });
});

test('rule 72 — a live stay: accommodation is the final price less the extras, a refund lowers only its own line', () => {
  const lines = buildRefundableLines({
    finalPrice: 480,
    touristTaxTotal: 13.2,
    vatRate: 10,
    options: [{ optionId: 7, title: 'Petit-déjeuner', totalPrice: 72, billedUnits: 6, offered: 0 }],
    refunds: [{ method: 'transfer', totalTtc: 24, lines: [{ lineKey: 'opt:7', amountTtc: 24 }] }],
  });
  assert.deepEqual(lines.map((line) => [line.key, line.billedTtc, line.refundedTtc, line.refundableTtc]), [
    ['accommodation', 408, 0, 408], ['opt:7', 72, 24, 48], ['touristTax', 13.2, 0, 13.2],
  ]);
});

test('rule 72 — a cancelled stay is capped on what the sale still holds', () => {
  const lines = buildRefundableLines({
    finalPrice: 480,
    touristTaxTotal: 13.2,
    vatRate: 10,
    cancelled: { collectedTtc: 100, indemnityLeftTtc: 60, saleLeftTtc: 40, cashCollectedTtc: 0, cashLeftTtc: 0 },
    refunds: [],
  });
  assert.deepEqual(lines.map((line) => [line.key, line.refundableTtc]), [['accommodation', 26.8], ['touristTax', 13.2]]);
});

test('rule 38 — capInOrder lowers the lines in the order given, earlier lines first', () => {
  const forward = [5000, 3000, 2000];
  capInOrder(forward, 6000, [0, 1, 2]);
  assert.deepEqual(forward, [1000, 3000, 2000]);
  const reverse = [5000, 3000, 2000];
  capInOrder(reverse, 6000, [2, 1, 0]);
  assert.deepEqual(reverse, [5000, 1000, 0]);
  const within = [100, 200];
  capInOrder(within, 1000, [0, 1]);
  assert.deepEqual(within, [100, 200]);
});

test('rule 38 — spreadBucketRefund spreads in proportion; a tied remainder goes to the earlier line, not the later one', () => {
  const lines = [0, 1, 2].map(() => ({ refundableTtc: 10, requalifiedTtc: 0, withheldTtc: 0 }));
  spreadBucketRefund(lines, 10);
  assert.deepEqual(lines.map((line) => line.requalifiedTtc), [3.34, 3.33, 3.33]);
  assert.deepEqual(lines.map((line) => line.refundableTtc), [6.66, 6.67, 6.67]);
  const tie = money.allocateCents(1000, [1, 1, 1]);
  assert.equal(tie.reduce((sum, cents) => sum + cents, 0), 1000, 'money.allocateCents is another allocation: not swapped in (rule 38)');
});

test('rule 72 — a withheld commission spread is also counted as withheld, and a line with no room takes nothing', () => {
  const lines = [{ refundableTtc: 4, requalifiedTtc: 0, withheldTtc: 0 }, { refundableTtc: 0, requalifiedTtc: 0, withheldTtc: 0 }];
  spreadBucketRefund(lines, 3, undefined, true);
  assert.deepEqual(lines[0], { refundableTtc: 1, requalifiedTtc: 3, withheldTtc: 3 });
  assert.deepEqual(lines[1], { refundableTtc: 0, requalifiedTtc: 0, withheldTtc: 0 });
});
