// specs/sas/outside-booking-sas.md rule 54 (reading 2026-11-16, loop t3 UI3-5) — with a payment typed, the screens print the server's refusal `reason`
// under « Facture » and the « Caisse interne » caption from its `INTERNAL_CASH` code, never from the tenders: the draft answer marks its refusals
// `silent` exactly like the stored visit's `invoiceable` (no Qonto, nothing the operator can act on → no reason shown).
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');

const ready = {
  id: 'fake', isReady: () => true, async issue() { return { invoiceId: 'inv', number: 'F-1', clientId: 'c', markedPaid: true }; },
  async findCardBatch() { return null; }, async attach() { return { attachmentId: 'a' }; }, async invoiceStatus() { return 'unpaid'; },
};
f.setIssuer(ready);

const quote = async (id, payment) => (await f.call('quote', { id, body: { extras: [f.extra(f.beer, 2)], payment } })).body.invoiceable;

test('UI3-5 — a refusal the operator can act on carries its reason, not silent', async () => {
  const id = f.book();
  const internal = await quote(id, { tenders: f.cash(6300, true) });
  assert.equal(internal.code, 'INTERNAL_CASH');
  assert.equal(internal.silent, false);
  const invalid = await quote(id, { tenders: f.card(9000) });
  assert.equal(invalid.code, 'TENDERS_INVALID');
  assert.equal(invalid.silent, false);
  assert.ok(invalid.reason);
  const due = await quote(id, { tenders: f.card(3000), shortfall: { kind: 'due' } });
  assert.equal(due.code, 'REMAINING_DUE');
  assert.equal(due.silent, false);
});

test('UI3-5 — no Qonto on the install: the draft refusal is silent', async () => {
  const id = f.book();
  f.setIssuer({ ...ready, isReady: () => false });
  try {
    const out = await quote(id, { tenders: f.card(6300) });
    assert.equal(out.code, 'ISSUER_UNAVAILABLE');
    assert.equal(out.silent, true);
  } finally {
    f.setIssuer(ready);
  }
});

test('UI3-5 — an accepted draft stays { ok: true } with no silent flag', async () => {
  const id = f.book();
  assert.deepEqual(await quote(id, { tenders: f.card(6300) }), { ok: true, code: null, reason: null });
});
