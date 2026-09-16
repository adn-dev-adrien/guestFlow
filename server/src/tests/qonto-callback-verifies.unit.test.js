/**
 * What happens the moment a Qonto authorisation succeeds.
 * See specs/settings-one-save-and-automatic-webhook.md §3 rule 14.
 *
 * The defect this covers was found on 2026-09-15, during the production switch: the operator saved
 * the production credentials, authorised at Qonto, came back — and read « échec de connexion ». The
 * connection was fine. Storing a token records nothing about whether the connection works, so the
 * page still showed the failure that *preceded* the repair; pressing « Tester la connexion » turned
 * it green without changing a single setting.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshSettings, withStubbedFetch, jsonResponse, connectedSettings } = require('./qontoSettingsFixture');
const { __test: { completeQontoAuthorization } } = require('../controllers/paymentsController');

const PUBLIC_URL = 'https://guestflow.adn-dev.fr';
const CALLBACK = 'https://guestflow.adn-dev.fr/api/payments/qonto/webhook';

/** An installation that has just exchanged its code for tokens, after a broken spell. */
function justAuthorised({ withPastFailure = true } = {}) {
  const { settings } = freshSettings();
  connectedSettings(settings);
  settings.upsert({ publicUrl: PUBLIC_URL });
  if (withPastFailure) {
    settings.recordQontoHealth({
      lastCheckAt: '2026-09-15T18:00:00.000Z',
      lastErrorAt: '2026-09-15T18:00:00.000Z',
      lastErrorCode: 'invalid_client',
      lastErrorMessage: 'Client authentication failed',
      lastErrorOrigin: 'public-payment',
    });
  }
  return settings;
}

/**
 * Qonto answering both calls the completion makes: the connection status, then the webhook
 * subscriptions. `connectionFails` makes the first one refuse.
 */
function qontoStub({ connectionFails = false, subscriptions = [{ id: 'sub-ours', callback_url: CALLBACK, types: ['v1/payment-links'] }] } = {}) {
  const calls = { connection: 0, list: 0, create: 0 };
  const impl = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/v2/payment_links/connections')) {
      calls.connection += 1;
      if (connectionFails) return jsonResponse({ error: 'invalid_grant', error_description: 'expired' }, { ok: false, status: 401 });
      return jsonResponse({ connection: { status: 'enabled', bank_account_id: 'ba-1' } });
    }
    if (target.includes('/v2/webhook_subscriptions')) {
      if (String(options.method || 'GET').toUpperCase() === 'GET') {
        calls.list += 1;
        return jsonResponse({ webhook_subscriptions: subscriptions });
      }
      calls.create += 1;
      return jsonResponse({ webhook_subscription: { id: 'sub-new', callback_url: CALLBACK } });
    }
    throw new Error(`unexpected call: ${target}`);
  };
  return { impl, calls };
}

// Rule 14 — the page must open on what is true now, not on the scar of the outage it just repaired.
test('rule 14: a successful authorisation verifies the connection and clears the old failure', async () => {
  const settings = justAuthorised();
  const { impl, calls } = qontoStub();

  const result = await withStubbedFetch(impl, () => completeQontoAuthorization({ settings, env: {} }));

  assert.equal(calls.connection, 1, 'the connection is actually called, not assumed');
  assert.equal(result.verified.state, 'ok');
  const health = settings.qontoHealth();
  assert.equal(health.lastError, null, 'the failure that preceded the repair is gone');
  assert.ok(health.lastSuccessAt);
});

// Rule 14 — the verification is not a gate: a refusal leaves the authorisation standing.
test('rule 14: a failing verification keeps the tokens and reports the diagnosis', async () => {
  const settings = justAuthorised({ withPastFailure: false });
  const { impl } = qontoStub({ connectionFails: true });

  const result = await withStubbedFetch(impl, () => completeQontoAuthorization({ settings, env: {} }));

  assert.notEqual(result.verified.state, 'ok');
  assert.ok(result.verified.title, 'the operator is told what is wrong, not just that something is');
  assert.ok(settings.qontoConnectionInfo().connected, 'the authorisation stands');
  assert.equal(settings.qontoHealth().lastError.code, 'invalid_grant');
});

// Rule 14 + rule 11 — the fresh authorisation is also when the webhook gets checked.
test('rules 11, 14: the webhook subscription is checked right after the verification', async () => {
  const settings = justAuthorised();
  const { impl, calls } = qontoStub();

  const result = await withStubbedFetch(impl, () => completeQontoAuthorization({ settings, env: {} }));

  assert.equal(calls.list, 1);
  assert.equal(calls.create, 0, 'the subscription already at our address is adopted');
  assert.equal(result.webhook.action, 'adopted');
  assert.equal(settings.qontoWebhookSubscription().id, 'sub-ours');
});

// Rule 14 — neither step may break the return to the settings page.
test('rule 14: a webhook failure does not undo the verification', async () => {
  const settings = justAuthorised();
  const impl = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/v2/payment_links/connections')) return jsonResponse({ connection: { status: 'enabled' } });
    return jsonResponse({ errors: [{ code: 'forbidden', detail: 'no webhook scope' }] }, { ok: false, status: 403 });
  };

  const result = await withStubbedFetch(impl, () => completeQontoAuthorization({ settings, env: {} }));

  assert.equal(result.verified.state, 'ok');
  assert.equal(result.webhook.action, 'failed');
});
