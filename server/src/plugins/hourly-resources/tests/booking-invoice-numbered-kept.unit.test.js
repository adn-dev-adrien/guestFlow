// specs/resource-booking-pricing-and-invoicing.md rules 38, 41, 43 (R35-EXT-1, R35-M-L2, R35-M-L5) — an invoice Qonto
// numbered is stored even when « marquer payée » fails, and the watch job marks it later; a registered client is sent with
// his record's address; a « Payé » without a method is refused for what it is. The real issuer and Qonto client run over a
// stubbed fetch: no socket.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, book, DAY } = require('./standaloneBookingFixture');
const { createInvoicing } = require('../invoicing');
const { buildQontoClient } = require('../../../utils/qonto/qontoClient');
const { createQontoInvoiceIssuer } = require('../../online-payment/invoiceIssuer');

const answer = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body), headers: { get: () => null } });
const quiet = { error() {}, warn() {} };

function fakeQonto({ markStatus }) {
  const state = { markStatus, invoices: 0, clientBodies: [] };
  const fetchImpl = async (url, opts = {}) => {
    if (url.endsWith('/v2/clients')) { state.clientBodies.push(JSON.parse(opts.body)); return answer(200, { client: { id: 'cl_1' } }); }
    if (url.includes('/mark_as_paid')) return answer(state.markStatus, state.markStatus < 300 ? { client_invoice: { id: 'inv_1', status: 'paid' } } : { errors: [] });
    if (url.endsWith('/v2/client_invoices')) {
      state.invoices += 1;
      return answer(200, { client_invoice: { id: `inv_${state.invoices}`, number: `F-${state.invoices}`, status: 'unpaid', total_amount_cents: 12000 } });
    }
    if (/\/v2\/client_invoices\/inv_\d+$/.test(url)) return answer(200, { client_invoice: { id: 'inv_1', status: 'unpaid' } });
    return answer(200, {});
  };
  const client = buildQontoClient({ sandbox: false, clientId: 'cid', clientSecret: 'sec', fetchImpl, retry: { maxAttempts: 1 } });
  const issuer = createQontoInvoiceIssuer({ store: () => ({ qontoConnected: () => true }), iban: () => 'FR76', withQontoImpl: (_o, fn) => fn(client, 'at') });
  return { issuer, state };
}
const silenced = async (fn) => {
  const { error, warn } = console;
  console.error = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.error = error; console.warn = warn; }
};

test('rule 38 — « marquer payée » refused (422): the numbered invoice is stored and frozen, one click makes one invoice', async () => {
  const { model, resourceId } = seed();
  const { issuer, state } = fakeQonto({ markStatus: 422 });
  const invoicing = createInvoicing({ bookings: () => model, issuers: () => issuer, logger: quiet });
  const id = book(model, resourceId);
  model.recordPayment(id, { tenders: [{ method: 'cheque', amountCents: 12000 }], paidAt: DAY });
  const out = await silenced(() => invoicing.issue(id));
  assert.equal(out.ok, true);
  const row = model.findById(id);
  assert.equal(row.frozen, true);
  assert.equal(row.invoice.number, 'F-1');
  assert.equal(row.invoice.markedPaid, false);
  assert.equal(model.rawById(id).invoiceMarkPending, 1);
  assert.equal((await invoicing.issue(id)).code, 'BOOKING_INVOICED');
  assert.equal(state.invoices, 1);

  state.markStatus = 200;
  await silenced(() => invoicing.watch());
  assert.equal(model.findById(id).invoice.markedPaid, true);
  assert.equal(model.rawById(id).invoiceMarkPending, 0);
});

test('rule 41 — a registered client goes to Qonto with his record\'s address', async () => {
  const { model, resourceId, db } = seed();
  const clientId = Number(db.prepare("INSERT INTO clients (firstName, lastName, streetNumber, street, postalCode, city) VALUES ('Ana', 'Lune', '3', 'rue des Lilas', '07000', 'Privas')").run().lastInsertRowid);
  let asked = null;
  const invoicing = createInvoicing({
    bookings: () => model,
    issuers: () => ({ isReady: () => true, async issue(r) { asked = r; return { invoiceId: 'i', number: 'F-1', clientId: 'c', markedPaid: true }; }, async findCardBatch() { return null; } }),
    logger: quiet,
  });
  const id = book(model, resourceId, { clientId, clientName: null, billing: { street: 'ailleurs', postcode: '75001', city: 'Paris' } });
  model.recordPayment(id, { tenders: [{ method: 'cheque', amountCents: 12000 }], paidAt: DAY });
  assert.equal((await invoicing.issue(id)).ok, true);
  assert.deepEqual(
    [asked.client.firstName, asked.client.lastName, asked.client.street, asked.client.postcode, asked.client.city],
    ['Ana', 'Lune', '3 rue des Lilas', '07000', 'Privas'],
  );
});

test('rule 43 — a « Payé » ticked before 1.4.0 (no method) is refused as such, not as caisse interne', async () => {
  const { model, resourceId, db } = seed();
  const id = book(model, resourceId);
  db.prepare('UPDATE resource_bookings SET paid = 1, paidAt = ? WHERE id = ?').run(DAY, id);
  const invoicing = createInvoicing({ bookings: () => model, issuers: () => ({ isReady: () => true }), logger: quiet });
  const out = await invoicing.issue(id);
  assert.equal(out.code, 'NO_METHOD');
  assert.equal(out.error, 'Moyen de paiement non saisi : retirer le paiement puis l’enregistrer à nouveau.');
  assert.equal(model.findById(id).payment.label, 'Moyen non saisi');
});
