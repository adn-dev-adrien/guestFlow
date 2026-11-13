// specs/outside-booking-sas.md rule 31 — one invoice per document, once fully paid on the books: every money line (the session's parts at its rate, its
// deductions as one discount, each extra at its own rate), Qonto's total equal to the document's; « Reste à payer : facture après le solde. » before that, no
// invoice for a caisse interne payment, a refusal never undoing the payment.
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');

const sent = [];
// A Qonto that checks what Qonto checks: the items less the discount make the expected total.
const issuer = {
  id: 'fake',
  isReady: () => true,
  async issue(request) {
    sent.push(request);
    const items = request.items.reduce((sum, item) => sum + item.amountCents, 0) - (request.discount ? request.discount.amountCents : 0);
    if (items !== request.expectedTotalCents) throw Object.assign(new Error('écart'), { code: 'ISSUER_AMOUNT_MISMATCH' });
    return { invoiceId: `inv-${sent.length}`, number: `F-${sent.length}`, clientId: 'c', markedPaid: true };
  },
  async findCardBatch() { return null; },
  async attach() { return { attachmentId: 'a' }; },
  async invoiceStatus() { return 'paid'; },
};
f.setIssuer(issuer);

test('rule 31 — a reste left: 409 REMAINING_DUE, nothing sent to Qonto', async () => {
  const id = f.book();
  await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)], payment: { tenders: f.card(5000), shortfall: { kind: 'due' } } } });
  const refused = await f.invoicing.issue(id);
  assert.deepEqual([refused.status, refused.code, refused.error], [409, 'REMAINING_DUE', 'Reste à payer : facture après le solde.']);
  assert.equal(sent.length, 0);
});

test('rule 31 — fully paid: every money line, the session\'s parts and the offered time as one discount, each at its rate; the total is the document\'s', async () => {
  const id = f.bookEvening();
  const quoted = (await f.call('quote', { id, body: { offeredMinutes: 15, extras: [f.extra(f.beer, 2), f.extra(f.lemonade, 1, { offered: true })] } })).body;
  const res = await f.call('commit', {
    id,
    body: {
      offeredMinutes: 15, extras: [f.extra(f.beer, 2), f.extra(f.lemonade, 1, { offered: true })], acceptedTotalCents: quoted.totals.totalCents, payment: { tenders: f.card(quoted.totals.totalCents) }, invoice: true,
    },
  });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.invoice, { ok: true, number: 'F-1' });
  const [request] = sent;
  assert.deepEqual(request.items.map((item) => [item.title, item.amountCents, item.vatRate]), [
    ['Bain fictif · Jour · 18:00–19:00', 5000, 20], ['Bain fictif · Soir · 19:00–20:00', 7000, 20], ['Bière locale', 1300, 20],
  ]);
  assert.deepEqual(request.discount, { title: 'Temps offert', amountCents: 1250, vatRate: 20 });
  assert.equal(request.expectedTotalCents, 12050);
  const booking = f.bookings.findById(id);
  assert.deepEqual([booking.invoice.number, booking.frozen, booking.invoice.attachment.state], ['F-1', true, 'pending']);
});

test('rule 31 — a caisse interne payment is no invoice; total 0 is no invoice', async () => {
  const id = f.book();
  await f.call('commit', { id, body: { payment: { tenders: f.cash(5000, true) } } });
  assert.equal((await f.invoicing.issue(id)).code, 'INTERNAL_CASH');
  const free = f.book();
  await f.call('commit', { id: free, body: { sessionOffered: true } });
  assert.equal((await f.invoicing.issue(free)).code, 'NOTHING_TO_INVOICE');
});

test('rule 31 — the invoice\'s refusal never undoes the arrival nor the payment', async () => {
  const id = f.book();
  f.setIssuer({ ...issuer, async issue() { throw Object.assign(new Error('adresse'), { code: 'ISSUER_NEEDS_ADDRESS' }); } });
  const res = await f.call('commit', { id, body: { payment: { tenders: f.card(5000) }, invoice: true } });
  f.setIssuer(issuer);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.invoice, { ok: false, code: 'QONTO_NEEDS_ADDRESS', error: 'adresse' });
  assert.deepEqual([res.body.visit.booking.arrived, res.body.visit.totals.remainingCents], [true, 0]);
});
