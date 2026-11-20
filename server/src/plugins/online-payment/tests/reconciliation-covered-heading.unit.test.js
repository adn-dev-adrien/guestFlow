// specs/mollie-rolling-reserve-and-incoming-payments.md rule 1 (second half) (stabilisation loop t12 UI12-2, 2026-11-17) — every
// « couvre aussi » entry carries the server's `clientHeading` (the client name of a stay), so the screen never prints a
// doubled label for an anonymous sale. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { addReservation, credit, build, reset, dayAt } = require('./reconciliationFixture');

test.beforeEach(() => { reset(); });

test('rule 1 — a proposal\'s alsoCovers entries carry the client heading of the other stay', () => {
  const unrecorded = (gross, due) => addReservation({
    platform: 'Booking', platformGrossAmount: gross, finalPrice: gross, balanceAmount: gross, depositAmount: 0, balanceDueDate: due,
  });
  const a = unrecorded(500, dayAt(-15));
  unrecorded(300, dayAt(-14));
  const { controller, transactions } = build();
  const est = (gross) => Math.round(gross * 100 * (1 - 0.1644));
  transactions.upsertMany([credit('p', est(500) + est(300), { settledAt: `${dayAt(-8)}T09:00:00.000Z`, counterpartyName: 'BOOKING.COM B.V.', reference: 'NO.Z/ID.9' })], { bankAccountId: 'acc-1' });
  const item = controller.list({ view: 'todo' }).body.items.find((i) => i.reservation.id === a && i.proposal);
  assert.equal(item.proposal.alsoCovers.length, 1);
  const other = item.proposal.alsoCovers[0];
  assert.ok(other.clientName);
  assert.equal(other.clientHeading, other.clientName);
});
