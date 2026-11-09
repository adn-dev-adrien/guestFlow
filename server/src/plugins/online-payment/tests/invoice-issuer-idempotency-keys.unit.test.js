// specs/resource-booking-pricing-and-invoicing.md rule 39 (R35-EXT-2, R35-M-L3) — every key Qonto receives is a UUID;
// the client key changes with the name and the billing address, the invoice key with the Qonto client, so the address
// typed after « Qonto demande l'adresse » reaches Qonto instead of replaying the first, address-less client.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildQontoClient } = require('../../../utils/qonto/qontoClient');
const { createQontoInvoiceIssuer } = require('../invoiceIssuer');
const { FAR_YEAR: Y } = require('../../../tests/farYearFixture');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const answer = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body), headers: { get: () => null } });

// A Qonto that replays what a key already answered, like an idempotent API: a client created without an address and
// asked again under the same key is the same client, and its invoice is refused again.
function replayingQonto() {
  const byKey = new Map();
  const calls = [];
  let clients = 0;
  const fetchImpl = async (url, opts = {}) => {
    const key = opts.headers && opts.headers['X-Qonto-Idempotency-Key'];
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ url, key, body });
    if (key && byKey.has(key)) return byKey.get(key);
    let res;
    if (url.endsWith('/v2/clients')) {
      clients += 1;
      res = answer(200, { client: { id: `cl_${clients}`, address: Boolean(body.billing_address) } });
      res.withAddress = Boolean(body.billing_address);
    } else if (url.endsWith('/v2/client_invoices')) {
      const hasAddress = calls.some((c) => c.url.endsWith('/v2/clients') && c.body && c.body.billing_address && body.client_id === `cl_${clients}`);
      res = hasAddress
        ? answer(200, { client_invoice: { id: 'inv', number: `F-${Y}-0007`, total_amount_cents: 6000 } })
        : answer(422, { errors: [{ source: 'client.billing_address.zip_code' }] });
    } else if (url.includes('mark_as_paid')) {
      res = answer(200, { client_invoice: { id: 'inv', status: 'paid' } });
    } else res = answer(200, {});
    if (key) byKey.set(key, res);
    return res;
  };
  const client = buildQontoClient({ sandbox: false, clientId: 'cid', clientSecret: 'sec', fetchImpl, retry: { maxAttempts: 1 } });
  const issuer = createQontoInvoiceIssuer({ store: () => ({ qontoConnected: () => true }), iban: () => 'FR76', withQontoImpl: (_o, fn) => fn(client, 'at') });
  return { issuer, calls };
}

const request = (address) => ({
  idempotencyKey: 'resource-booking:4:invoice:0',
  client: { firstName: 'Ana', lastName: 'Lune', clientId: null, street: '', postcode: '', city: '', ...address },
  issueDate: `${Y}-02-13`, performanceDate: `${Y}-02-13`,
  items: [{ title: 'Bain · Jour', amountCents: 6000, vatRate: 20 }],
  discount: null, expectedTotalCents: 6000, paid: true,
});
const quietly = async (fn) => {
  const { error, warn } = console;
  console.error = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.error = error; console.warn = warn; }
};

test('rule 39 — the client, invoice and attachment keys are UUIDs', async () => {
  const { issuer, calls } = replayingQonto();
  await quietly(() => issuer.issue(request({ street: '3 rue des Lilas', postcode: '07000', city: 'Privas' }))).catch(() => {});
  const keys = calls.map((c) => c.key).filter(Boolean);
  assert.ok(keys.length >= 2);
  keys.forEach((k) => assert.match(k, UUID));
});

test('rule 39 — the address typed after Qonto asked for it reaches Qonto: a new client, a new invoice key', async () => {
  const { issuer, calls } = replayingQonto();
  await assert.rejects(quietly(() => issuer.issue(request({}))), { code: 'ISSUER_NEEDS_ADDRESS' });
  const out = await quietly(() => issuer.issue(request({ street: '3 rue des Lilas', postcode: '07000', city: 'Privas' })));
  assert.equal(out.number, `F-${Y}-0007`);
  const clientKeys = calls.filter((c) => c.url.endsWith('/v2/clients')).map((c) => c.key);
  assert.notEqual(clientKeys[0], clientKeys[1]);
  const invoiceKeys = calls.filter((c) => c.url.endsWith('/v2/client_invoices')).map((c) => c.key);
  assert.notEqual(invoiceKeys[0], invoiceKeys[1]);
});

test('rule 39 — the same request retried carries the same keys (no second invoice)', async () => {
  const { issuer, calls } = replayingQonto();
  const full = request({ street: '3 rue des Lilas', postcode: '07000', city: 'Privas' });
  const a = await quietly(() => issuer.issue(full));
  const b = await quietly(() => issuer.issue(full));
  assert.equal(a.number, b.number);
  const invoiceKeys = calls.filter((c) => c.url.endsWith('/v2/client_invoices')).map((c) => c.key);
  assert.equal(new Set(invoiceKeys).size, 1);
});
