// specs/outside-booking-sas.md rule 54 (stabilisation loop t2, B2-7; invoicing rules 13, 44, 45) — « Créer la facture dans Qonto » at « Payé maintenant » is the
// server's answer for the payment typed: the arrival's quote and the booking dialog's preview judge the commit of the draft with the refusals `issue` would
// answer, and write nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');
const { createController } = require('../controller');

const ready = {
  id: 'fake', isReady: () => true, async issue() { return { invoiceId: 'inv', number: 'F-1', clientId: 'c', markedPaid: true }; },
  async findCardBatch() { return null; }, async attach() { return { attachmentId: 'a' }; }, async invoiceStatus() { return 'unpaid'; },
};
f.setIssuer(ready);

const quote = async (id, payment, user) => (await f.call('quote', { id, body: { extras: [f.extra(f.beer, 2)], ...(payment ? { payment } : {}) }, user })).body;

test('B2-7 — the arrival\'s quote with the payment typed: ok when it settles the visit on the books, nothing written', async () => {
  const id = f.book();
  const out = await quote(id, { tenders: f.card(6300) });
  assert.equal(out.totals.remainingCents, 6300);
  assert.deepEqual(out.invoiceable, { ok: true, code: null, reason: null });
  assert.equal(f.row(id).saleRef || null, null, 'no document born from a quote');
});

test('B2-7 — the arrival\'s quote refuses what the commit\'s invoice would refuse', async () => {
  const id = f.book();
  assert.equal((await quote(id, { tenders: f.cash(6300, true) })).invoiceable.code, 'INTERNAL_CASH');
  assert.equal((await quote(id, { tenders: f.card(3000), shortfall: { kind: 'due' } })).invoiceable.code, 'REMAINING_DUE');
  assert.equal((await quote(id, { tenders: f.card(9000) })).invoiceable.code, 'TENDERS_INVALID');
  assert.equal((await quote(id, null)).invoiceable.code, 'NOT_PAID', 'with no payment typed, the stored visit is judged');
  f.setIssuer({ ...ready, isReady: () => false });
  assert.equal((await quote(id, { tenders: f.card(6300) })).invoiceable.code, 'ISSUER_UNAVAILABLE');
  f.setIssuer(ready);
});

test('B2-7 — the reception never reads it', async () => {
  const id = f.book();
  assert.equal((await quote(id, { tenders: f.card(6300) }, f.RECEPTION)).invoiceable, null);
});

test('B2-7 — the booking dialog\'s preview with the payment typed: the booking paid on its own columns', () => {
  const controller = createController({ bookings: () => f.bookings, invoicing: () => f.invoicing });
  const preview = (payment) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    controller.preview({ body: { resourceId: f.resourceId, date: f.DAY, startTime: '10:00', endTime: '11:00', ...(payment ? { payment } : {}) }, user: f.ADMIN }, res);
    return res.body;
  };
  assert.equal(preview(null).invoiceable, undefined, 'no payment typed, no answer');
  assert.deepEqual(preview({ tenders: f.card(5000) }).invoiceable, { ok: true, code: null, reason: null });
  assert.equal(preview({ tenders: f.cash(5000, true) }).invoiceable.code, 'INTERNAL_CASH');
  assert.equal(preview({ tenders: f.card(4000) }).invoiceable.code, 'TENDERS_INVALID');
});
