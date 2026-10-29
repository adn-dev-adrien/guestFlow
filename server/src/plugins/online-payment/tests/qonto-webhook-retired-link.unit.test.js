// specs/plugins-phase-3a-online-payment.md rule 33 — a payment on a link GuestFlow already retired (marker
// owed) reaches the single-link retry at once, so a double payment is flagged by the webhook itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { createWebhookController } = require('../webhookController');
const { freshSettings } = require('./qontoSettingsFixture');

const SECRET = 'whsec_retired_1';
function signed(body) {
  const raw = Buffer.from(JSON.stringify(body));
  const ts = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', SECRET).update(`${ts}.${raw.toString('utf8')}`).digest('hex');
  return { body, rawBody: raw, get: (n) => (String(n).toLowerCase() === 'x-qonto-signature' ? `t=${ts},v1=${v1}` : undefined) };
}
const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } });

function controller(link) {
  const calls = { process: 0, retry: [] };
  const provider = { id: 'qonto', getPayment: async () => ({ paid: true, paymentId: 'p1', paidAt: '2027-04-01T10:00:00Z' }) };
  const { handleWebhook } = createWebhookController({
    provider, settings: freshSettings().settings,
    paymentLinksModel: { findByProviderLinkId: () => link },
    processPaidLink: async () => { calls.process += 1; },
    retryPendingCancellations: async (args) => { calls.retry.push(args.only); return { results: [] }; },
    effectDeps: () => ({}),
  });
  return { handleWebhook, calls };
}

test('rule 33: a paid link retired with a deactivation marker goes through the single-link retry', async () => {
  process.env.QONTO_WEBHOOK_SECRET = SECRET;
  const { handleWebhook, calls } = controller({ id: 7, status: 'cancelled', remoteCancelPendingAt: '2027-04-01T09:00:00Z', providerLinkId: 'pl_7' });
  const r = res();
  await handleWebhook(signed({ payment_link: { id: 'pl_7' } }), r);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(calls.retry, [7]);
  assert.equal(calls.process, 0);
  delete process.env.QONTO_WEBHOOK_SECRET;
});

test('rule 33: a cancelled link with no marker owed is left alone', async () => {
  process.env.QONTO_WEBHOOK_SECRET = SECRET;
  const { handleWebhook, calls } = controller({ id: 8, status: 'cancelled', remoteCancelPendingAt: null, providerLinkId: 'pl_8' });
  await handleWebhook(signed({ payment_link: { id: 'pl_8' } }), res());
  assert.deepEqual(calls.retry, []);
  assert.equal(calls.process, 0);
  delete process.env.QONTO_WEBHOOK_SECRET;
});
