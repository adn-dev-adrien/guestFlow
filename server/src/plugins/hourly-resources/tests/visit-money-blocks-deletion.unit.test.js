// specs/resource-booking-pricing-and-invoicing.md rule 34, outside-booking-sas.md rule 34 (loop t1 D-3) — a visit whose money is on its sale document
// holds its booking: the resource, the lodging and the client it names refuse a forced delete, as a booking paid on itself does.
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');
const { bookingMoneyBlocker } = require('../../../utils/deletionGuard');

test('D-3 — a visit paid 30 € on its document blocks deleting its resource; an unpaid one does not', async () => {
  const paid = f.book();
  const unpaid = f.book();
  assert.equal(bookingMoneyBlocker(f.db, 'resourceId', f.row(unpaid).resourceId), null);
  await f.call('commit', { id: paid, body: { payment: { tenders: f.card(5000) } } });
  assert.equal(Number(f.row(paid).paid), 0, 'the booking row itself is not paid');
  assert.ok(bookingMoneyBlocker(f.db, 'resourceId', f.row(paid).resourceId));
  await f.call('commit', { id: unpaid, body: { extras: [f.extra(f.beer, 1)] } });
  assert.equal(bookingMoneyBlocker(f.db, 'resourceId', f.row(unpaid).resourceId), null, 'a document with nothing received holds nothing');
});
