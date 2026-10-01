// qontoClient — the invoicing calls the control plane uses to bill its customers
// (specs/control-plane-plans-and-access.md rules 17, 32, 34). All HTTP is stubbed: the tests pin the
// payloads we send and the parsing of what Qonto answers.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildQontoClient } = require('../qonto/qontoClient');

function stubFetch(response = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, text: async () => JSON.stringify(response) };
  };
  return { fetchImpl, calls };
}

const client = (fetchImpl) => buildQontoClient({ sandbox: false, clientId: 'cid', clientSecret: 'sec', fetchImpl, retry: { maxAttempts: 1 } });

test('rule 17: a Qonto client carries the address, currency and locale Qonto needs to invoice it', async () => {
  const { fetchImpl, calls } = stubFetch({ client: { id: 'cl_1' } });
  const out = await client(fetchImpl).createClient({
    accessToken: 'at', name: 'Domaine Ombre', email: 'claire@ombre.fr',
    street: '12 chemin des Crêtes', postcode: '07140', city: 'Les Vans', vatNumber: 'FR12345678901',
  });
  assert.equal(out.id, 'cl_1');
  assert.equal(calls[0].url, 'https://thirdparty.qonto.com/v2/clients');
  assert.deepEqual(calls[0].body, {
    kind: 'company', name: 'Domaine Ombre', email: 'claire@ombre.fr', currency: 'EUR', locale: 'fr',
    billing_address: { street_address: '12 chemin des Crêtes', zip_code: '07140', city: 'Les Vans', country_code: 'FR' },
    vat_number: 'FR12345678901',
  });
});

test('rule 17: the invoice is unpaid, dated, on the period, with HT lines and VAT as a decimal', async () => {
  const { fetchImpl, calls } = stubFetch({ client_invoice: { id: 'inv_1', number: 'F-2026-0051', status: 'unpaid', invoice_url: 'https://pay.qonto.com/i/1', total_amount_cents: 8160 } });
  const out = await client(fetchImpl).createClientInvoice({
    accessToken: 'at', clientId: 'cl_1', issueDate: '2026-09-30', dueDate: '2026-10-07',
    performanceStart: '2026-10-07', performanceEnd: '2026-11-07', iban: 'FR7612345',
    items: [{ title: 'GuestFlow Pro — 1 mois', amountCents: 5900, vatRate: 20 }, { title: 'Option Neat', amountCents: 900, vatRate: 20 }],
    expectedTotalCents: 8160,
  });
  assert.deepEqual(out, { id: 'inv_1', number: 'F-2026-0051', status: 'unpaid', invoiceUrl: 'https://pay.qonto.com/i/1', paidAt: null, totalCents: 8160, raw: out.raw });
  const body = calls[0].body;
  assert.equal(calls[0].url, 'https://thirdparty.qonto.com/v2/client_invoices');
  assert.equal(body.status, 'unpaid');
  assert.equal(body.client_id, 'cl_1');
  assert.equal(body.due_date, '2026-10-07');
  assert.equal(body.performance_start_date, '2026-10-07');
  assert.deepEqual(body.payment_methods, { iban: 'FR7612345' });
  assert.deepEqual(body.items[0], { title: 'GuestFlow Pro — 1 mois', quantity: '1', unit_price: { value: '59.00', currency: 'EUR' }, vat_rate: '0.2' });
  assert.ok(calls[0].opts.headers['X-Qonto-Idempotency-Key']);
});

test('rule 17: an invoice whose total differs from the one we mean to charge is refused', async () => {
  const { fetchImpl } = stubFetch({ client_invoice: { id: 'inv_1', total_amount: { value: '81.61', currency: 'EUR' } } });
  await assert.rejects(
    client(fetchImpl).createClientInvoice({ accessToken: 'at', clientId: 'c', issueDate: 'd', dueDate: 'd', iban: 'x', items: [{ title: 't', amountCents: 6800, vatRate: 20 }], expectedTotalCents: 8160 }),
    (err) => err.body.code === 'AMOUNT_MISMATCH' && err.body.charged === 8161 && err.body.invoiceId === 'inv_1',
  );
});

test('rule 17: the payment link is attached to the invoice by id, number, debtor and amount', async () => {
  const { fetchImpl, calls } = stubFetch({ payment_link: { id: 'pl_1', url: 'https://pay.qonto.com/pl/1', status: 'open' } });
  const out = await client(fetchImpl).createInvoicePaymentLink({ accessToken: 'at', invoiceId: 'inv_1', invoiceNumber: 'F-2026-0051', debitorName: 'Domaine Ombre', amountCents: 8160 });
  assert.equal(out.url, 'https://pay.qonto.com/pl/1');
  assert.deepEqual(calls[0].body, { payment_link: {
    invoice_id: 'inv_1', invoice_number: 'F-2026-0051', debitor_name: 'Domaine Ombre',
    amount: { value: '81.60', currency: 'EUR' }, potential_payment_methods: ['credit_card', 'apple_pay'],
  } });
});

test('rule 34: reading, cancelling an invoice and deactivating its link hit the documented endpoints', async () => {
  const { fetchImpl, calls } = stubFetch({ client_invoice: { id: 'inv_1', status: 'paid', paid_at: '2026-10-01T10:00:00Z', total_amount_cents: 8160 } });
  const c = client(fetchImpl);
  const read = await c.getClientInvoice({ accessToken: 'at', id: 'inv_1' });
  assert.equal(read.status, 'paid');
  assert.equal(read.paidAt, '2026-10-01T10:00:00Z');
  await c.cancelClientInvoice({ accessToken: 'at', id: 'inv_1' });
  await c.deactivatePaymentLink({ accessToken: 'at', id: 'pl_1' });
  assert.deepEqual(calls.map((x) => `${x.opts.method} ${x.url.replace('https://thirdparty.qonto.com', '')}`), [
    'GET /v2/client_invoices/inv_1',
    'POST /v2/client_invoices/inv_1/mark_as_canceled',
    'PATCH /v2/payment_links/pl_1/deactivate',
  ]);
});
