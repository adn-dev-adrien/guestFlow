// specs/resource-booking-pricing-and-invoicing.md rule 50 (audit R37-EXT-1) — a Qonto client is reused only for the
// identity it was created with (name and billing address): a registered client whose record changed between two
// invoices, or a booking whose billing address was corrected before it is invoiced again, gets a Qonto client carrying
// what the invoice states; an unchanged identity keeps its Qonto client. The real issuer and Qonto client run over a
// stubbed fetch: no socket. The issuer is online-payment's: the file runs only where that plugin ships.
const { requirePlugins } = require('../../sdk/testing');

if (requirePlugins(['online-payment'])) {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const { seed, book, card } = require('./standaloneBookingFixture');
  const { createInvoicing } = require('../invoicing');
  const { buildQontoClient } = require('../../../utils/qonto/qontoClient');
  const { createQontoInvoiceIssuer } = require('../../online-payment/invoiceIssuer');

  const answer = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body), headers: { get: () => null } });
  const quiet = { error() {}, warn() {} };

  function fakeQonto() {
    const state = { clients: [], invoiceClients: [] };
    const fetchImpl = async (url, opts = {}) => {
      if (!/^https:\/\/[^/]*qonto/.test(url)) throw new Error(`unexpected host ${url}`);
      const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
      if (url.endsWith('/v2/clients')) {
        const created = { id: `cl_${state.clients.length + 1}`, body };
        state.clients.push(created);
        return answer(200, { client: { id: created.id } });
      }
      if (url.endsWith('/v2/client_invoices')) {
        state.invoiceClients.push(body.client_id);
        const total = body.items.reduce((s, it) => s + Math.round(Math.round(Number(it.unit_price.value) * 100) * (1 + Number(it.vat_rate))), 0);
        const n = state.invoiceClients.length;
        return answer(200, { client_invoice: { id: `inv_${n}`, number: `F-${n}`, status: 'unpaid', total_amount_cents: total } });
      }
      if (url.includes('/mark_as_paid')) return answer(200, { client_invoice: { status: 'paid' } });
      return answer(404, {});
    };
    const client = buildQontoClient({ sandbox: false, clientId: 'cid', clientSecret: 'sec', fetchImpl, retry: { maxAttempts: 1 } });
    const issuer = createQontoInvoiceIssuer({ store: () => ({ qontoConnected: () => true }), iban: () => 'FR76', withQontoImpl: (_o, fn) => fn(client, 'at') });
    return { issuer, state };
  }

  const addressOf = (created) => JSON.stringify(created.body).includes('rue des Lilas');

  test('rule 50: a registered client whose address was filled after his first invoice gets a Qonto client with it', async () => {
    const { db, model, resourceId } = seed();
    const { issuer, state } = fakeQonto();
    const invoicing = createInvoicing({ bookings: () => model, issuers: () => issuer, logger: quiet });
    const clientId = Number(db.prepare("INSERT INTO clients (firstName, lastName) VALUES ('Claire', 'Martin')").run().lastInsertRowid);
    const first = book(model, resourceId, { clientId });
    model.recordPayment(first, { tenders: card(12000) });
    assert.equal((await invoicing.issue(first)).ok, true);

    db.prepare("UPDATE clients SET streetNumber = '3', street = 'rue des Lilas', postalCode = '20000', city = 'Ajaccio' WHERE id = ?").run(clientId);
    const second = book(model, resourceId, { clientId, startTime: '10:00', endTime: '11:00' });
    model.recordPayment(second, { tenders: card(5000) });
    assert.equal((await invoicing.issue(second)).ok, true);

    assert.equal(state.clients.length, 2, 'a second Qonto client for the new identity');
    assert.equal(addressOf(state.clients[1]), true, 'it carries the address the record now holds');
    assert.deepEqual(state.invoiceClients, ['cl_1', 'cl_2']);

    const third = book(model, resourceId, { clientId, startTime: '12:00', endTime: '13:00' });
    model.recordPayment(third, { tenders: card(5000) });
    assert.equal((await invoicing.issue(third)).ok, true);
    assert.equal(state.clients.length, 2, 'an unchanged identity keeps its Qonto client');
    assert.deepEqual(state.invoiceClients, ['cl_1', 'cl_2', 'cl_2']);
  });

  test('rule 50: a name corrected on the record is a new identity too', async () => {
    const { db, model, resourceId } = seed();
    const { issuer, state } = fakeQonto();
    const invoicing = createInvoicing({ bookings: () => model, issuers: () => issuer, logger: quiet });
    const clientId = Number(db.prepare("INSERT INTO clients (firstName, lastName) VALUES ('Claire', 'Matrin')").run().lastInsertRowid);
    const first = book(model, resourceId, { clientId });
    model.recordPayment(first, { tenders: card(12000) });
    await invoicing.issue(first);
    db.prepare("UPDATE clients SET lastName = 'Martin' WHERE id = ?").run(clientId);
    const second = book(model, resourceId, { clientId, startTime: '10:00', endTime: '11:00' });
    model.recordPayment(second, { tenders: card(5000) });
    await invoicing.issue(second);
    assert.equal(state.clients.length, 2);
    assert.match(JSON.stringify(state.clients[1].body), /Martin/);
  });

  test('rule 50: an outside guest re-invoiced after Qonto cancelled the first invoice keeps the corrected address', async () => {
    const { model, resourceId } = seed();
    const { issuer, state } = fakeQonto();
    const invoicing = createInvoicing({ bookings: () => model, issuers: () => issuer, logger: quiet });
    const id = book(model, resourceId);
    model.recordPayment(id, { tenders: card(12000) });
    await invoicing.issue(id);
    model.markInvoiceCancelled(id);
    assert.equal(model.recordArrivalBilling(id, { street: '3 rue des Lilas', postcode: '20000', city: 'Ajaccio' }).ok, true);
    assert.equal((await invoicing.issue(id)).ok, true, 'issued again');
    assert.equal(state.clients.length, 2);
    assert.equal(addressOf(state.clients[1]), true);
    assert.deepEqual(state.invoiceClients, ['cl_1', 'cl_2']);
  });
}
