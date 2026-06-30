// Qonto webhook controller (specs/public-online-payment.md §3bis): signature verification + the
// idempotent paid-link effect. The HTTP handler is exercised via fake req/res; the crypto helpers are
// pure. No network: we don't reach Qonto unless a verified, known, open link is found (we keep the test
// to the verification + routing branches).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { handleWebhook, __test } = require('../controllers/qontoWebhookController');
const { verifySignature, extractPaymentLinkId } = __test;

const SECRET = 'whsec_test_123';

function sign(rawBody, secret = SECRET) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function res() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
}

function req({ body, signature, header = 'x-qonto-signature' }) {
  const raw = Buffer.from(JSON.stringify(body));
  return {
    body,
    rawBody: raw,
    get(name) { return String(name).toLowerCase() === header ? signature : undefined; },
  };
}

test('verifySignature: accepts a correct HMAC (hex), rejects a wrong one', () => {
  const raw = Buffer.from('{"a":1}');
  assert.equal(verifySignature(raw, sign(raw), SECRET), true);
  assert.equal(verifySignature(raw, sign(raw, 'other'), SECRET), false);
  assert.equal(verifySignature(raw, '', SECRET), false);
  assert.equal(verifySignature(raw, sign(raw), ''), false);
});

test('verifySignature: tolerates a sha256= prefix and base64 digest', () => {
  const raw = Buffer.from('{"b":2}');
  assert.equal(verifySignature(raw, `sha256=${sign(raw)}`, SECRET), true);
  const b64 = crypto.createHmac('sha256', SECRET).update(raw).digest('base64');
  assert.equal(verifySignature(raw, b64, SECRET), true);
});

test('extractPaymentLinkId: pulls the id from the shapes Qonto may send', () => {
  assert.equal(extractPaymentLinkId({ payment_link: { id: 'pl_1' } }), 'pl_1');
  assert.equal(extractPaymentLinkId({ data: { object: { id: 'pl_2' } } }), 'pl_2');
  assert.equal(extractPaymentLinkId({ resource_id: 'pl_3' }), 'pl_3');
  assert.equal(extractPaymentLinkId({ nothing: true }), null);
});

test('handleWebhook: 503 when no secret is configured', async () => {
  const prev = process.env.QONTO_WEBHOOK_SECRET;
  delete process.env.QONTO_WEBHOOK_SECRET;
  const r = res();
  await handleWebhook(req({ body: { payment_link: { id: 'pl_1' } }, signature: 'x' }), r);
  assert.equal(r.statusCode, 503);
  if (prev !== undefined) process.env.QONTO_WEBHOOK_SECRET = prev;
});

test('handleWebhook: 401 on a bad signature (nothing processed)', async () => {
  process.env.QONTO_WEBHOOK_SECRET = SECRET;
  const r = res();
  await handleWebhook(req({ body: { payment_link: { id: 'pl_1' } }, signature: 'deadbeef' }), r);
  assert.equal(r.statusCode, 401);
  delete process.env.QONTO_WEBHOOK_SECRET;
});

test('handleWebhook: 200 on a valid signature for an unknown link (no-op)', async () => {
  process.env.QONTO_WEBHOOK_SECRET = SECRET;
  const body = { payment_link: { id: 'pl_unknown_xyz' } };
  const raw = Buffer.from(JSON.stringify(body));
  const r = res();
  // Unknown qonto id → findByQontoPaymentLinkId returns undefined → no network, just 200.
  await handleWebhook({ body, rawBody: raw, get: (n) => (String(n).toLowerCase() === 'x-qonto-signature' ? sign(raw) : undefined) }, r);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, { received: true });
  delete process.env.QONTO_WEBHOOK_SECRET;
});
