// specs/resource-booking-pricing-and-invoicing.md rule 42 (R35-EXT-4, R35-INJ-L1) — the invoice PDF's signed URL is read
// within the Qonto client's timeout, and only over https. Stubbed fetch, no socket.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildQontoClient } = require('../../../utils/qonto/qontoClient');

const answer = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), headers: { get: () => null } });

function clientServing(url, onDownload) {
  const fetchImpl = (target, opts = {}) => {
    if (target.includes('/v2/client_invoices/')) return Promise.resolve(answer({ client_invoice: { id: 'inv', number: 'F-1', attachment_id: 'att' } }));
    if (target.includes('/v2/attachments/')) return Promise.resolve(answer({ attachment: { url } }));
    return onDownload(target, opts);
  };
  return buildQontoClient({ sandbox: false, clientId: 'cid', clientSecret: 'sec', fetchImpl, timeoutMs: 150, retry: { maxAttempts: 1 } });
}

test('rule 42 — a signed URL that never answers times out with the client\'s budget, and the fetch is aborted', async () => {
  let signal = null;
  const client = clientServing('https://files.example/pdf', (_t, opts) => { signal = opts.signal; return new Promise(() => {}); });
  const started = Date.now();
  await assert.rejects(client.getClientInvoicePdf({ accessToken: 'at', id: 'inv' }), { code: 'ETIMEDOUT' });
  assert.ok(Date.now() - started < 2000);
  assert.ok(signal && signal.aborted, 'the download got the abort signal');
});

test('rule 42 — a signed URL other than https is refused, never fetched', async () => {
  let fetched = false;
  for (const url of ['http://files.example/pdf', 'file:///etc/passwd', 'not a url']) {
    const client = clientServing(url, () => { fetched = true; return Promise.resolve({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1]) }); });
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(client.getClientInvoicePdf({ accessToken: 'at', id: 'inv' }), { code: 'ATTACHMENT_URL_REFUSED' });
  }
  assert.equal(fetched, false);
});

test('rule 42 — an https URL that answers gives the PDF', async () => {
  const client = clientServing('https://files.example/pdf', () => Promise.resolve({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([37, 80]) }));
  const pdf = await client.getClientInvoicePdf({ accessToken: 'at', id: 'inv' });
  assert.equal(pdf.fileName, 'F-1.pdf');
  assert.equal(pdf.bytes.length, 2);
});
