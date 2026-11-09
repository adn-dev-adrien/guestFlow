// specs/resource-booking-pricing-and-invoicing.md rules 28-33 — the one-screen arrival of a guest with no stay.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, book, card } = require('./standaloneBookingFixture');
const { createController } = require('../controller');
const { createInvoicing } = require('../invoicing');
const { FAR_YEAR: Y } = require('../../../tests/farYearFixture');

function app(issuerOver = {}) {
  const { model, resourceId, db } = seed();
  const issuer = { id: 'fake', isReady: () => true, async issue(r) { return { invoiceId: 'inv', number: 'F-1', totalCents: r.expectedTotalCents, clientId: 'c', markedPaid: false }; }, async findCardBatch() { return null; }, async attach() { return { attachmentId: 'a' }; }, async invoiceStatus() { return 'unpaid'; }, ...issuerOver };
  const invoicing = createInvoicing({ bookings: () => model, issuers: () => issuer, logger: { error() {}, warn() {} } });
  const controller = createController({ bookings: () => model, invoicing: () => invoicing });
  const call = async (id, body) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await controller.arrival({ params: { id: String(id) }, body }, res);
    return res;
  };
  return { model, resourceId, db, call };
}

test('rule 28 — a booking tied to a stay has no arrival of its own', () => {
  const { model, resourceId, db } = seed();
  const id = book(model, resourceId);
  db.prepare('UPDATE resource_bookings SET reservationId = 7 WHERE id = ?').run(id);
  assert.equal(model.recordArrival(id, {}).code, 'BOOKING_HAS_STAY');
});

test('rule 29 — the arrival adjusts the offered time, never the slot (Q10)', async () => {
  const { model, resourceId, call } = app();
  const id = book(model, resourceId);
  const res = await call(id, { offeredMinutes: 15, payment: null, startTime: '17:00' });
  assert.equal(res.code, 200);
  assert.equal(res.body.booking.offeredMinutes, 15);
  assert.equal(res.body.booking.startTime, '18:00');
  assert.equal(res.body.booking.totalPrice, 107.5);
});

test('rule 30 — arrival and payment commit together; the invoice comes after and its refusal keeps them (rule 25)', async () => {
  const err = Object.assign(new Error('adresse'), { code: 'ISSUER_NEEDS_ADDRESS' });
  const { model, resourceId, call } = app({ async issue() { throw err; } });
  const id = book(model, resourceId);
  const res = await call(id, { offeredMinutes: 0, payment: { tenders: card(12000), paidAt: `${Y}-11-09` }, invoice: true });
  assert.equal(res.code, 200);
  assert.equal(res.body.booking.arrived, true);
  assert.equal(res.body.booking.paid, true);
  assert.deepEqual(res.body.invoice, { ok: false, code: 'QONTO_NEEDS_ADDRESS', error: 'adresse' });
});

test('rule 30 — a refused payment rolls the whole arrival back', async () => {
  const { model, resourceId, call } = app();
  const id = book(model, resourceId);
  const res = await call(id, { offeredMinutes: 30, payment: { tenders: card(100) } });
  assert.equal(res.code, 400);
  const row = model.findById(id);
  assert.equal(row.arrived, false);
  assert.equal(row.offeredMinutes, 0);
  assert.equal(row.totalPrice, 120);
});

test('rule 31 — « Pas maintenant »: the arrival only, the booking stays to collect', async () => {
  const { model, resourceId, call } = app();
  const id = book(model, resourceId);
  const res = await call(id, { payment: null });
  assert.equal(res.body.booking.arrived, true);
  assert.equal(res.body.booking.paid, false);
  assert.equal(res.body.invoice, null);
});

test('rule 32 — re-opening an invoiced arrival changes nothing but its address', async () => {
  const { model, resourceId, call } = app();
  const id = book(model, resourceId);
  await call(id, { payment: { tenders: card(12000) }, invoice: true });
  const again = await call(id, { offeredMinutes: 60, payment: { tenders: card(6000) }, billing: { street: '1 rue', postcode: '07000', city: 'Privas' } });
  assert.equal(again.code, 200);
  assert.equal(again.body.booking.offeredMinutes, 0);
  assert.equal(again.body.booking.totalPrice, 120);
  assert.equal(again.body.booking.billing.city, 'Privas');
});

test('rule 33 — the payload carries the server flags the full-screen arrival renders', async () => {
  const { model, resourceId, call } = app();
  const id = book(model, resourceId);
  const res = await call(id, { payment: null });
  for (const key of ['external', 'arrived', 'frozen', 'payment', 'invoice', 'billing']) assert.ok(key in res.body.booking, key);
});
