// specs/outside-booking-sas.md rule 34 — a booking paid on its own columns before its document keeps that money there: its mini SAS shows the session « Payée »
// from those columns (counted by SETTLEMENT through one allocation of its whole amount), a new document holds only the extras sold from then on, and the
// journal of the session does not move (the plugin still lists it, once).
// A booking paid before its document keeps its own rules: resource-booking-pricing-and-invoicing rule 52.
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');

function paidOnTheBooking() {
  const id = f.bookEvening();
  const paid = f.bookings.recordPayment(id, { tenders: f.card(12000), paidAt: f.DAY });
  assert.deepEqual(paid, { ok: true }, 'no document yet: the booking dialog pays on the booking as before');
  return id;
}

test('rule 34 — the session paid on the booking reads « Payée »; nothing is due; the visit writes no document for an arrival alone', async () => {
  const id = paidOnTheBooking();
  const view = (await f.call('getVisit', { id })).body;
  assert.deepEqual(view.lines.map((line) => [line.kind, line.status, line.totalCents, line.legacy]), [['session', 'paid', 12000, true]]);
  assert.deepEqual([view.totals.totalCents, view.totals.paidCents, view.totals.remainingCents], [12000, 12000, 0]);
  const done = await f.call('commit', { id, body: {} });
  assert.equal(done.code, 200);
  assert.deepEqual([f.row(id).saleRef, Boolean(f.row(id).arrivedAt)], [null, true]);
  assert.equal((await f.call('pay', { id, body: { tenders: f.card(100) } })).body.code, 'NOTHING_DUE');
});

test('rule 34 — two beers at the counter: « Déjà payé 120,00 € », « Reste à payer 13,00 € »; the document holds the beers only', async () => {
  const id = paidOnTheBooking();
  const visit = (await f.call('commit', { id, body: { extras: [f.extra(f.beer, 2)] } })).body.visit;
  assert.deepEqual([visit.totals.totalCents, visit.totals.paidCents, visit.totals.remainingCents], [13300, 12000, 1300]);
  const saleId = Number(f.row(id).saleRef.split(':')[1]);
  assert.deepEqual(f.db.prepare('SELECT label, totalCents FROM standalone_sale_lines WHERE saleId = ?').all(saleId), [{ label: 'Bière locale', totalCents: 1300 }]);
  assert.equal(f.db.prepare('SELECT totalCents FROM standalone_sales WHERE id = ?').get(saleId).totalCents, 1300, 'the document stores its own lines only');
  assert.equal(f.bookings.findById(id).cardState.label, 'Reste 13,00 €');
  const paid = (await f.call('pay', { id, body: { tenders: f.cash(1300) } })).body.visit;
  assert.equal(paid.totals.remainingCents, 0);
});

test('rule 34 — the journal of the session does not move: the plugin lists it once, on its payment day, with its frozen rate', async () => {
  const id = paidOnTheBooking();
  await f.call('commit', { id, body: { extras: [f.extra(f.lemonade, 1)], payment: { tenders: f.card(400) } } });
  const listed = f.bookings.standaloneSales({ from: f.DAY, to: f.DAY }).filter((sale) => sale.key === `resource-booking:${id}`);
  assert.deepEqual(listed.map((sale) => [sale.totalCents, sale.vatRate, sale.cardCents]), [[12000, 20, 12000]]);
  const booking = f.bookings.findById(id);
  assert.deepEqual([booking.paid, booking.payment.tenders.length], [true, 1], 'the booking\'s own payment is still its own');
});
