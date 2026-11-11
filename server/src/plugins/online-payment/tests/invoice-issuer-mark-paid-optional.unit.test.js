// specs/resource-booking-pricing-and-invoicing.md rule 38 (R35-EXT-1) — once Qonto has numbered the invoice, nothing may
// lose it: « marquer payée » (undocumented, Q4) failing for any reason leaves the invoice issued, `markPending`, and the
// issuer's `markPaid` tries it again later. All HTTP is stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildQontoClient } = require('../../../utils/qonto/qontoClient');
const { createQontoInvoiceIssuer } = require('../invoiceIssuer');
const { FAR_YEAR: Y } = require('../../../tests/farYearFixture');

const answer = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body), headers: { get: () => null } });

function qontoWithMarkPaid(markStatus) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET' });
    if (url.endsWith('/v2/clients')) return answer(200, { client: { id: 'cl_1' } });
    if (url.includes('/mark_as_paid')) return answer(markStatus, markStatus < 300 ? { client_invoice: { id: 'inv_1', status: 'paid' } } : { errors: [{ code: 'nope' }] });
    if (url.endsWith('/v2/client_invoices')) return answer(200, { client_invoice: { id: 'inv_1', number: `F-${Y}-0001`, status: 'unpaid', total_amount_cents: 12000 } });
    return answer(200, {});
  };
  const client = buildQontoClient({ sandbox: false, clientId: 'cid', clientSecret: 'sec', fetchImpl, retry: { maxAttempts: 1 } });
  const issuer = createQontoInvoiceIssuer({
    store: () => ({ qontoConnected: () => true }), iban: () => 'FR76', withQontoImpl: (_o, fn) => fn(client, 'at'),
  });
  return { issuer, calls };
}

const REQUEST = {
  idempotencyKey: 'resource-booking:9:invoice:0',
  client: { firstName: 'Ana', lastName: 'Lune', street: '', postcode: '', city: '', clientId: null },
  issueDate: `${Y}-02-13`, performanceDate: `${Y}-02-13`,
  items: [{ title: 'Bain · Jour', amountCents: 5000, vatRate: 20 }, { title: 'Bain · Soir', amountCents: 7000, vatRate: 20 }],
  discount: null,
  expectedTotalCents: 12000,
  paid: true,
};
const quietly = async (fn) => {
  const { error, warn } = console;
  console.error = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.error = error; console.warn = warn; }
};

for (const status of [400, 403, 422, 500]) {
  test(`rule 38 — « marquer payée » answering ${status} keeps the numbered invoice, marked pending`, async () => {
    const { issuer, calls } = qontoWithMarkPaid(status);
    const out = await quietly(() => issuer.issue(REQUEST));
    assert.deepEqual(out, { invoiceId: 'inv_1', number: `F-${Y}-0001`, totalCents: 12000, clientId: 'cl_1', markedPaid: false, markPending: true });
    assert.equal(calls.filter((c) => c.url.endsWith('/v2/client_invoices')).length, 1, 'one invoice numbered');
  });
}

test('rule 38 — no « marquer payée » in the API (404) is final: not pending, the invoice stays « à payer »', async () => {
  const { issuer } = qontoWithMarkPaid(404);
  const out = await quietly(() => issuer.issue(REQUEST));
  assert.equal(out.markedPaid, false);
  assert.equal(out.markPending, false);
});

test('rule 38 — the issuer\'s markPaid: done, unsupported, or thrown to be tried again', async () => {
  assert.deepEqual(await qontoWithMarkPaid(200).issuer.markPaid({ invoiceId: 'inv_1', paidAt: `${Y}-02-13` }), { done: true });
  assert.deepEqual(await quietly(() => qontoWithMarkPaid(404).issuer.markPaid({ invoiceId: 'inv_1', paidAt: null })), { done: false });
  await assert.rejects(quietly(() => qontoWithMarkPaid(500).issuer.markPaid({ invoiceId: 'inv_1', paidAt: null })));
});
