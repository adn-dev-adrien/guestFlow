// specs/resource-booking-pricing-and-invoicing.md rule 45 (R35b N1) on the visit's commit, which replaced the one-screen arrival (specs/outside-booking-sas.md rule 31): a Qonto
// invoice is made only on an explicit choice of the operator — the commit issues one when its body says `invoice: true`, nothing else does (payment, edit, the hourly job) —
// and an `invoice` that is not a boolean is refused before anything is written. A refused invoice keeps the arrival and the payment (rule 25); the address typed after a
// refusal is stored with the commit (rule 25), and an invoiced visit takes nothing more but its address.
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');

const issued = [];
const okIssuer = {
  id: 'fake',
  isReady: () => true,
  async issue(request) { issued.push(request); return { invoiceId: `inv-${issued.length}`, number: `F-${issued.length}`, clientId: 'c', markedPaid: true }; },
  async findCardBatch() { return null; },
  async attach() { return { attachmentId: 'a' }; },
  async invoiceStatus() { return 'unpaid'; },
};
f.setIssuer(okIssuer);

for (const [label, tenders] of [['cheque', [{ method: 'cheque', amountCents: 5000, internal: false }]], ['card', f.card(5000)]]) {
  test(`rule 45 — paid by ${label} at booking time, Qonto ready: a commit sent without « invoice » makes no invoice`, async () => {
    issued.length = 0;
    const id = f.book();
    f.bookings.recordPayment(id, { tenders, paidAt: f.DAY });
    const res = await f.call('commit', { id, body: { invoice: false } });
    assert.equal(res.code, 200);
    assert.equal(res.body.invoice, null);
    const omitted = await f.call('commit', { id, body: {} });
    assert.equal(omitted.code, 200);
    assert.equal(omitted.body.invoice, null);
    assert.equal(issued.length, 0);
    assert.equal(f.bookings.findById(id).invoice, null);
  });
}

test('rule 45 — an « invoice » that is not a boolean is refused before the arrival is written', async () => {
  issued.length = 0;
  const id = f.book();
  for (const invoice of ['true', 1, 'yes', {}, [true], null]) {
    const res = await f.call('commit', { id, body: { invoice } });
    assert.equal(res.code, 400, JSON.stringify(invoice));
    assert.equal(res.body.error, 'Facture : oui ou non.');
  }
  assert.equal(f.bookings.findById(id).arrived, false);
  assert.equal(issued.length, 0);
});

test('rule 45 — « Créer la facture » (invoice: true) is the explicit choice: commit, then invoice', async () => {
  issued.length = 0;
  const id = f.book();
  const res = await f.call('commit', { id, body: { payment: { tenders: f.card(5000) }, invoice: true } });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.invoice, { ok: true, number: 'F-1' });
  assert.equal(issued.length, 1);
});

test('rule 45 — recording a payment, editing the booking and the hourly job never make an invoice', async () => {
  issued.length = 0;
  const id = f.book();
  assert.equal(f.bookings.recordPayment(id, { tenders: f.card(5000), paidAt: f.DAY, invoice: true }).error, undefined);
  assert.equal(f.bookings.update(id, { notes: 'Serviette' }).error, undefined);
  await f.invoicing.watch();
  assert.equal(issued.length, 0);
  assert.equal(f.bookings.findById(id).invoice, null);
});

test('rule 25 — a refused invoice keeps the arrival and the payment; the address typed after it goes with the retry, and an invoiced visit takes nothing but its address', async () => {
  const id = f.book();
  f.setIssuer({ ...okIssuer, async issue() { throw Object.assign(new Error('adresse'), { code: 'ISSUER_NEEDS_ADDRESS' }); } });
  const refused = await f.call('commit', { id, body: { payment: { tenders: f.card(5000) }, invoice: true } });
  assert.equal(refused.code, 200);
  assert.deepEqual(refused.body.invoice, { ok: false, code: 'QONTO_NEEDS_ADDRESS', error: 'adresse' });
  assert.equal(refused.body.visit.booking.arrived, true);
  assert.equal(refused.body.visit.totals.remainingCents, 0);
  f.setIssuer(okIssuer);
  const retry = await f.call('commit', { id, body: { invoice: true, billing: { street: '1 rue', postcode: '07000', city: 'Privas' } } });
  assert.equal(retry.code, 200);
  assert.equal(retry.body.invoice.ok, true);
  assert.equal(f.bookings.findById(id).billing.city, 'Privas');
  const again = await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)] } });
  assert.deepEqual([again.code, again.body.code], [409, 'BOOKING_INVOICED']);
});
