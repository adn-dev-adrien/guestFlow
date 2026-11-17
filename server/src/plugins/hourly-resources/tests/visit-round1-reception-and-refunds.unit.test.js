// specs/outside-booking-sas.md rules 7, 21, 25, 39, 43-47 (loop t1 AV-1, AV-3, AV-4, AV-5, AV-7, AV-11) — a confirmed lowering of a paid line opens its register row and
// holds the invoice; the invoice and the billing address are the administrator's; a refused commit writes no billing; the reception never reads the link's address;
// the payload says whether « Créer la facture » can be offered.
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');

const issued = [];
f.setIssuer({
  id: 'fake', isReady: () => true, async issue(request) { issued.push(request); return { invoiceId: `inv-${issued.length}`, number: `F-${issued.length}`, clientId: 'c', markedPaid: true }; },
  async findCardBatch() { return null; }, async attach() { return { attachmentId: 'a' }; }, async invoiceStatus() { return 'unpaid'; },
});

test('AV-1 — a paid beer offered with the confirmation opens a `lineLowered` row; the invoice is not offerable and is refused until it is closed', async () => {
  const id = f.book();
  const visit = (await f.call('commit', { id, body: { extras: [f.extra(f.beer, 2)], payment: { tenders: f.card(6300) } } })).body.visit;
  assert.deepEqual(visit.invoiceable, { ok: true, code: null, reason: null }, 'a paid visit can be invoiced');
  const beer = visit.lines.find((line) => line.label === 'Bière locale');
  const lowered = (await f.call('patchLine', { id, lineId: beer.id, body: { offered: true, confirmRefund: true } })).body.visit;
  assert.deepEqual(lowered.refundObligations.map((row) => [row.origin, row.amountCents]), [['lineLowered', 1300]]);
  assert.equal(lowered.invoiceable.code, 'REFUND_OWED');
  assert.equal(f.sales.counterSalesOwing().length, 0, 'a visit\'s document stays off the counter list');
  const refused = await f.call('commit', { id, body: { invoice: true, version: lowered.document.version } });
  assert.equal(refused.body.invoice.code, 'REFUND_OWED');
  assert.equal(issued.length, 0);
});

test('AV-3 — the reception cannot ask the invoice nor type its billing address (403)', async () => {
  const id = f.book();
  for (const body of [{ invoice: true }, { billing: { street: '1 rue', postcode: '07000', city: 'Privas' } }]) {
    const out = await f.call('commit', { id, body, user: f.RECEPTION });
    assert.deepEqual([out.code, out.body.code], [403, 'ADMIN_ONLY'], JSON.stringify(body));
  }
  assert.equal(f.row(id).billingStreet || null, null);
});

test('AV-4 — a commit refused on a stale version writes no billing address', async () => {
  const id = f.book();
  const first = (await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)] } })).body.visit;
  const stale = await f.call('commit', { id, body: { version: first.document.version - 1, billing: { street: '9 rue', postcode: '07000', city: 'Privas' } } });
  assert.equal(stale.code, 409);
  assert.equal(f.row(id).billingStreet || null, null);
});

test('AV-5, AV-7 — the reception reads whether an address is known, never the address, and no invoiceability; the administrator may withdraw a link on any day', async () => {
  const id = f.book();
  const reception = (await f.call('getVisit', { id, user: f.RECEPTION })).body;
  assert.equal(reception.paymentLink.email, null);
  assert.equal(typeof reception.paymentLink.hasEmail, 'boolean');
  assert.equal(reception.invoiceable, null);
  assert.equal((await f.call('getVisit', { id })).body.access.withdrawLink, true);
});

test('AV-2 — a client changed on the booking is the document\'s client too', async () => {
  const a = Number(f.db.prepare("INSERT INTO clients (firstName, lastName, email) VALUES ('Ana', 'Un', 'un@example.test')").run().lastInsertRowid);
  const b = Number(f.db.prepare("INSERT INTO clients (firstName, lastName, email) VALUES ('Bea', 'Deux', 'deux@example.test')").run().lastInsertRowid);
  const id = f.book({ clientId: a });
  const visit = (await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)] } })).body.visit;
  assert.equal(f.sales.findSale(visit.document.id).clientId, a);
  assert.equal(f.bookings.update(id, { clientId: b }).ok, true);
  assert.equal(f.sales.findSale(visit.document.id).clientId, b);
});

test('AV-6 — a typed address that matches a client answers the reception « match » without the name', async () => {
  f.db.prepare("INSERT INTO clients (firstName, lastName, email) VALUES ('Cleo', 'Trois', 'trois@example.test')").run();
  const id = f.book();
  const reception = (await f.call('quote', { id, body: { customer: { email: 'trois@example.test' } }, user: f.RECEPTION })).body;
  assert.deepEqual(reception.document.client, { kind: 'match' });
  const admin = (await f.call('quote', { id, body: { customer: { email: 'trois@example.test' } } })).body;
  assert.equal(admin.document.client.kind, 'match');
  assert.match(JSON.stringify(admin.document.client), /Trois/);
});

test('AV-10 — every line of the visit carries its own VAT rate', async () => {
  const id = f.book();
  const visit = (await f.call('quote', { id, body: { extras: [f.extra(f.beer, 1)] } })).body;
  assert.ok(visit.lines.length >= 2);
  assert.ok(visit.lines.every((line) => typeof line.vatRate === 'number'), JSON.stringify(visit.lines.map((l) => [l.label, l.vatRate])));
});

test('AV-8 — an invoiced visit serves `newSale.client`, the document\'s client the counter dialog opens on', async () => {
  const id = f.book();
  const out = (await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)], payment: { tenders: f.card(5650) }, invoice: true, billing: { street: '1 rue', postcode: '07000', city: 'Privas' } } })).body;
  assert.equal(out.invoice.ok, true, JSON.stringify(out.invoice));
  assert.deepEqual(out.visit.newSale, { client: out.visit.document.client });
  assert.equal(out.visit.invoiceable.code, 'BOOKING_INVOICED');
});
