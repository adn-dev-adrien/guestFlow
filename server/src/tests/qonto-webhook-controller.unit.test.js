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

// Qonto scheme: header `t={ts},v1={hmac}`, signed payload `{ts}.{rawBody}`, HMAC-SHA256 hex.
function sign(rawBody, { secret = SECRET, ts = Math.floor(Date.now() / 1000) } = {}) {
  const v1 = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody.toString('utf8')}`).digest('hex');
  return `t=${ts},v1=${v1}`;
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

test('verifySignature: accepts a correct t=,v1= signature, rejects a wrong secret/empty', () => {
  const raw = Buffer.from('{"a":1}');
  assert.equal(verifySignature(raw, sign(raw), SECRET), true);
  assert.equal(verifySignature(raw, sign(raw, { secret: 'other' }), SECRET), false);
  assert.equal(verifySignature(raw, '', SECRET), false);
  assert.equal(verifySignature(raw, sign(raw), ''), false);
  assert.equal(verifySignature(raw, 'garbage-no-t-or-v1', SECRET), false);
});

test('verifySignature: rejects a stale timestamp (replay > 5 min)', () => {
  const raw = Buffer.from('{"b":2}');
  const now = 1_800_000_000;
  const fresh = sign(raw, { ts: now });
  assert.equal(verifySignature(raw, fresh, SECRET, now), true);
  assert.equal(verifySignature(raw, fresh, SECRET, now + 6 * 60), false, '6 min later → rejected');
  // The signature is bound to the body: tampering the body invalidates it.
  assert.equal(verifySignature(Buffer.from('{"b":3}'), fresh, SECRET, now), false);
});

test('extractPaymentLinkId: reads data.payment_link_id (Qonto shape) + fallbacks', () => {
  assert.equal(extractPaymentLinkId({ data: { payment_link_id: 'pl_q' } }), 'pl_q');
  assert.equal(extractPaymentLinkId({ payment_link: { id: 'pl_1' } }), 'pl_1');
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
