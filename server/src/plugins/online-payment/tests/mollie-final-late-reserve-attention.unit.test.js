// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rules 4 and 13 — a reserve past its window is « en retard » whether or
// not a proposal waits for the operator: it is on the home alert, and not counted twice among the gaps.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, dayAt, build, reset, paidStay, mollieCredit } = require('./mollieFixture');

test.beforeEach(() => { reset(); });

test('rule 13 — a late reserve with a pending « probable » proposal is in /reserve-attention, and not among the gaps', () => {
  const { reservationId } = paidStay({ cents: 10000, daysAgo: 120 });
  const { controller, transactions } = build({ startDate: dayAt(-200) });
  transactions.upsertMany([mollieCredit('c1', 2000, 1)], { bankAccountId: 'acc-1' });
  const items = ['todo', 'waiting', 'done'].flatMap((view) => controller.list({ view }).body.items);
  const reserve = items.find((i) => i.reservation.id === reservationId && i.ledgerKey === 'balance#retenue');
  assert.equal(reserve.state, 'proposed');
  assert.equal(reserve.mollie.late, true);
  const attention = controller.reserveAttention();
  assert.equal(attention.count, 1);
  assert.equal(attention.items[0].reservationId, reservationId);
  assert.equal(controller.attention().items.some((i) => i.key === reserve.key), false, 'a proposed item is not a gap: never counted twice');
});
