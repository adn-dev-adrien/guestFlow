// specs/pricing-components.md §3 rules 21, 72, 74 and specs/outside-booking-sas.md rules 15, 19, 41 — SETTLEMENT and REFUNDS take a sale document: the remaining amount,
// the allocation of a payment on the lines in sale order (session first), a surplus filed on no line, and the trop-perçu REFUNDS reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const { settleDocument, allocateDocumentPayment } = require('../utils/pricing/settlement');
const { owedOnDocument } = require('../utils/pricing/refunds/owed');

const lines = [
  { ref: 'line:a', totalCents: 3000 },
  { ref: 'line:b', totalCents: 650 },
  { ref: 'line:c', totalCents: 0, offered: true },
  { ref: 'line:d', totalCents: 400, cancelled: true },
  { ref: 'line:e', totalCents: 1300 },
];

test('rule 19 — a payment covers the unpaid lines in sale order, each whole before the next, the last one partly', () => {
  assert.deepEqual(allocateDocumentPayment({ lines, amountCents: 3300 }), [{ lineRef: 'line:a', amountCents: 3000 }, { lineRef: 'line:b', amountCents: 300 }]);
  const earlier = [{ lineRef: 'line:a', amountCents: 3000, kind: 'payment' }, { lineRef: 'line:b', amountCents: 300, kind: 'payment' }];
  assert.deepEqual(allocateDocumentPayment({ lines, allocations: earlier, amountCents: 1000 }), [{ lineRef: 'line:b', amountCents: 350 }, { lineRef: 'line:e', amountCents: 650 }]);
});

test('rule 15 — the remaining amount is the lines\' total less the money received; offered and cancelled lines ask nothing', () => {
  const none = settleDocument({ lines, allocations: [] });
  assert.deepEqual([none.totalCents, none.paidCents, none.remainingCents], [4950, 0, 4950]);
  assert.deepEqual(none.lines.map((l) => l.status), ['due', 'due', 'offered', 'cancelled', 'due']);
  const part = settleDocument({ lines, allocations: [{ lineRef: 'line:a', amountCents: 3000, kind: 'payment' }, { lineRef: 'line:b', amountCents: 300, kind: 'payment' }] });
  assert.deepEqual([part.paidCents, part.remainingCents], [3300, 1650]);
  assert.deepEqual(part.lines.map((l) => l.status), ['paid', 'due', 'offered', 'cancelled', 'due']);
});

test('rule 41 — a surplus is filed on no line, counted as received, and what the lines ask less than that is what REFUNDS owes', () => {
  assert.deepEqual(allocateDocumentPayment({ lines: [{ ref: 'line:a', totalCents: 500 }], amountCents: 800 }), [{ lineRef: 'line:a', amountCents: 500 }, { lineRef: null, amountCents: 300 }]);
  const settled = settleDocument({ lines: [{ ref: 'line:a', totalCents: 500, offered: true }], allocations: [{ lineRef: 'line:a', amountCents: 500, kind: 'payment' }, { lineRef: null, amountCents: 300, kind: 'payment' }] });
  assert.deepEqual([settled.totalCents, settled.paidCents, settled.remainingCents], [0, 800, 0]);
  assert.deepEqual(owedOnDocument({ dueCents: settled.totalCents, paidCents: settled.paidCents }), { owedCents: 800 });
});

test('rule 72 — what was given back is not owed twice', () => {
  assert.deepEqual(owedOnDocument({ dueCents: 500, paidCents: 800, refundedCents: 300 }), { owedCents: 0 });
  assert.deepEqual(owedOnDocument({ dueCents: 500, paidCents: 800, refundedCents: 100 }), { owedCents: 200 });
  assert.deepEqual(owedOnDocument({ dueCents: 900, paidCents: 800 }), { owedCents: 0 });
});

test('rule 74 — a refund given back is a negative allocation: the document\'s paid amount falls, its lines keep what they were covered with', () => {
  const settled = settleDocument({
    lines: [{ ref: 'line:a', totalCents: 500 }],
    allocations: [{ lineRef: 'line:a', amountCents: 500, kind: 'payment' }, { lineRef: 'line:a', amountCents: -200, kind: 'refund' }],
  });
  assert.deepEqual([settled.paidCents, settled.refundedCents, settled.remainingCents], [300, 200, 200]);
});
