// specs/resource-booking-pricing-and-invoicing.md rules 14, 16-19, 25 — Qonto as the invoice issuer. All HTTP is stubbed:
// the tests pin what is sent to Qonto and how its answers and refusals are read.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildQontoClient, INVOICING_SCOPES, DEFAULT_SCOPES } = require('../../../utils/qonto/qontoClient');
const { createQontoInvoiceIssuer, wireItems, foldedItems } = require('../invoiceIssuer');

function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const isForm = opts.body instanceof FormData;
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: isForm ? opts.body : (opts.body ? JSON.parse(opts.body) : null) });
    const route = routes.find(([match]) => url.includes(match));
    const [, status, answer] = route || ['', 200, {}];
    if (answer instanceof Uint8Array) return { ok: true, status: 200, arrayBuffer: async () => answer };
    return { ok: status < 300, status, text: async () => JSON.stringify(answer), headers: { get: () => null } };
  };
  return { fetchImpl, calls };
}

const clientOf = (fetchImpl) => buildQontoClient({ sandbox: false, clientId: 'cid', clientSecret: 'sec', fetchImpl, retry: { maxAttempts: 1 } });
const issuerOn = (client) => createQontoInvoiceIssuer({
  store: () => ({ qontoConnected: () => true }),
  iban: () => 'FR7600000000000000000000000',
  withQontoImpl: (_opts, fn) => fn(client, 'at'),
});
const quietly = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

const REQUEST = {
  idempotencyKey: 'resource-booking:5:invoice:0',
  client: { firstName: 'Claire', lastName: 'Martin', street: '', postcode: '', city: '', clientId: null },
  issueDate: '2026-11-09', performanceDate: '2026-11-09',
  items: [{ title: 'Bain · Jour', amountCents: 5000, vatRate: 20 }, { title: 'Bain · Soir', amountCents: 7000, vatRate: 20 }],
  discount: { title: 'Temps offert', amountCents: 2500, vatRate: 20 },
  expectedTotalCents: 9500,
  paid: true,
};

test('rule 14 (Q6) — the online-payment consent asks the invoicing scopes on top of the payment ones', () => {
  assert.deepEqual(INVOICING_SCOPES, ['client.write', 'client_invoice.read', 'client_invoice.write', 'attachment.write']);
  assert.ok(!DEFAULT_SCOPES.includes('client_invoice.write'));
});

test('rule 14 — an individual client, an HT invoice whose lines add up to the TTC charged, then marked paid', async () => {
  const { fetchImpl, calls } = stubFetch([
    ['/v2/clients', 200, { client: { id: 'cl_9' } }],
    ['/mark_as_paid', 200, { client_invoice: { id: 'inv_9', status: 'paid' } }],
    ['/v2/client_invoices', 200, { client_invoice: { id: 'inv_9', number: 'F-2026-0142', status: 'unpaid', total_amount_cents: 9500 } }],
  ]);
  const out = await issuerOn(clientOf(fetchImpl)).issue(REQUEST);
  assert.deepEqual(out, { invoiceId: 'inv_9', number: 'F-2026-0142', totalCents: 9500, clientId: 'cl_9', markedPaid: true });
  const [clientCall, invoiceCall, paidCall] = calls;
  assert.equal(clientCall.body.kind, 'individual');
  assert.equal(clientCall.body.last_name, 'Martin');
  assert.equal('billing_address' in clientCall.body, false, 'rule 25 — no partial address is sent');
  assert.equal(clientCall.headers['X-Qonto-Idempotency-Key'], 'resource-booking:5:invoice:0:client');
  assert.deepEqual(invoiceCall.body.items.map((i) => i.unit_price.value), ['41.67', '58.33', '-20.83']);
  assert.equal(invoiceCall.body.payment_methods.iban, 'FR7600000000000000000000000');
  assert.equal(invoiceCall.body.issue_date, '2026-11-09');
  assert.match(paidCall.url, /client_invoices\/inv_9\/mark_as_paid$/);
});

test('rule 14 (Q3) — a refused negative line is folded into the lines, same total, with a new key', async () => {
  let first = true;
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, body, key: opts.headers['X-Qonto-Idempotency-Key'] });
    if (url.endsWith('/v2/client_invoices') && first) { first = false; return { ok: false, status: 422, text: async () => JSON.stringify({ errors: [{ source: 'items[2].unit_price' }] }), headers: { get: () => null } }; }
    if (url.endsWith('/v2/client_invoices')) return { ok: true, status: 200, text: async () => JSON.stringify({ client_invoice: { id: 'inv', number: 'F-2', total_amount_cents: 9500 } }) };
    if (url.includes('mark_as_paid')) return { ok: false, status: 404, text: async () => '{}', headers: { get: () => null } };
    return { ok: true, status: 200, text: async () => JSON.stringify({ client: { id: 'cl' } }) };
  };
  const out = await quietly(() => issuerOn(clientOf(fetchImpl)).issue(REQUEST));
  assert.equal(out.number, 'F-2');
  assert.equal(out.markedPaid, false, 'rule 14 (Q4) — no mark-paid endpoint: the invoice stays « à payer »');
  const second = calls.filter((c) => c.url.endsWith('/v2/client_invoices'))[1];
  assert.equal(second.key, 'resource-booking:5:invoice:0:invoice-folded');
  assert.ok(second.body.items.every((i) => Number(i.unit_price.value) > 0));
});

test('rules 14, 25 — Qonto\'s refusals become the codes the seller shows', async () => {
  const refuse = (status, body) => async (url) => (url.endsWith('/v2/clients')
    ? { ok: false, status, text: async () => JSON.stringify(body), headers: { get: () => null } }
    : { ok: true, status: 200, text: async () => '{}' });
  await assert.rejects(quietly(() => issuerOn(clientOf(refuse(422, { errors: [{ source: 'billing_address.zip_code' }] }))).issue(REQUEST)), { code: 'ISSUER_NEEDS_ADDRESS' });
  await assert.rejects(quietly(() => issuerOn(clientOf(refuse(403, { error: 'insufficient_scope' }))).issue(REQUEST)), { code: 'ISSUER_REAUTH' });
});

test('rule 14 — a total Qonto computes differently cancels the invoice and refuses', async () => {
  const { fetchImpl, calls } = stubFetch([
    ['/v2/clients', 200, { client: { id: 'cl' } }],
    ['/mark_as_canceled', 200, { client_invoice: { id: 'inv_x', status: 'canceled' } }],
    ['/v2/client_invoices', 200, { client_invoice: { id: 'inv_x', number: 'F-3', total_amount_cents: 9499 } }],
  ]);
  await assert.rejects(quietly(() => issuerOn(clientOf(fetchImpl)).issue(REQUEST)), { code: 'ISSUER_AMOUNT_MISMATCH' });
  assert.ok(calls.some((c) => c.url.endsWith('/client_invoices/inv_x/mark_as_canceled')));
});

test('rule 14 — every HT line set rounds back to the TTC total, per line', () => {
  const lines = wireItems([{ title: 'a', amountCents: 1000, vatRate: 20 }, { title: 'b', amountCents: 1000, vatRate: 20 }, { title: 'c', amountCents: 1000, vatRate: 20 }], null, 3000);
  assert.equal(lines.reduce((s, l) => s + Math.round(l.amountCents * 1.2), 0), 3000);
  const folded = foldedItems(REQUEST.items, REQUEST.discount, 9500);
  assert.equal(folded.reduce((s, l) => s + Math.round(l.amountCents * 1.2), 0), 9500);
});

test('rule 17 — the day\'s card batch is found by its reference', async () => {
  const { fetchImpl } = stubFetch([
    ['/v2/bank_accounts', 200, { bank_accounts: [{ id: 'ba', main: true }] }],
    ['/v2/transactions', 200, { transactions: [
      { transaction_id: 'tx-other', reference: 'Paiements-En-Personne-08-11-2026', amount_cents: 1 },
      { transaction_id: 'tx-day', reference: 'Paiements-En-Personne-09-11-2026', amount_cents: 2, settled_at: '2026-11-09T18:00:00Z' },
    ], meta: {} }],
  ]);
  const out = await issuerOn(clientOf(fetchImpl)).findCardBatch('2026-11-09');
  assert.deepEqual(out, { transactionId: 'tx-day', settledAt: '2026-11-09T18:00:00Z' });
});

test('rules 18-19 — the invoice PDF is uploaded to the transaction, multipart, under the caller\'s key', async () => {
  const pdf = new Uint8Array([37, 80, 68, 70]);
  const { fetchImpl, calls } = stubFetch([
    ['/v2/client_invoices/inv_9', 200, { client_invoice: { id: 'inv_9', number: 'F-2026-0142', attachment_id: 'att_src' } }],
    ['/v2/attachments/att_src', 200, { attachment: { url: 'https://files.example/pdf' } }],
    ['files.example', 200, pdf],
    ['/v2/transactions/tx-day/attachments', 200, { attachment: { id: 'att_new' } }],
  ]);
  const out = await issuerOn(clientOf(fetchImpl)).attach({ invoiceId: 'inv_9', transactionId: 'tx-day', idempotencyKey: 'resource-booking:5:attach:tx-day' });
  assert.deepEqual(out, { attachmentId: 'att_new' });
  const upload = calls.find((c) => c.url.endsWith('/v2/transactions/tx-day/attachments'));
  assert.equal(upload.method, 'POST');
  assert.equal(upload.headers['X-Qonto-Idempotency-Key'], 'resource-booking:5:attach:tx-day');
  assert.equal('Content-Type' in upload.headers, false, 'the multipart boundary is the runtime\'s');
  const file = upload.body.get('file');
  assert.equal(file.name, 'F-2026-0142.pdf');
});

test('rule 18 — a PDF Qonto has not rendered yet is a wait, not a failure', async () => {
  const { fetchImpl } = stubFetch([['/v2/client_invoices/inv_9', 200, { client_invoice: { id: 'inv_9' } }]]);
  await assert.rejects(issuerOn(clientOf(fetchImpl)).attach({ invoiceId: 'inv_9', transactionId: 'tx', idempotencyKey: 'k' }), { code: 'ISSUER_PDF_PENDING' });
});
