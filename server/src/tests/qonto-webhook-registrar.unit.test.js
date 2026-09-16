/**
 * The payment-link webhook subscribes itself.
 * See specs/settings-one-save-and-automatic-webhook.md §3 rules 7, 8, 9, 10, 11.
 *
 * The cardinal one is rule 8. Qonto cannot tell us the secret of a subscription it already holds, so
 * a duplicate would deliver events signed with a key we cannot verify — while the first one kept
 * delivering too. Every assertion below that counts POST calls is really asserting that.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshSettings, withStubbedFetch, jsonResponse, connectedSettings } = require('./qontoSettingsFixture');
const { ensureWebhookSubscription } = require('../utils/qontoWebhookRegistrar');

const PUBLIC_URL = 'https://guestflow.adn-dev.fr';
const CALLBACK = 'https://guestflow.adn-dev.fr/api/payments/qonto/webhook';

/** A connected installation that knows the address it answers on. */
function ready() {
  const { settings } = freshSettings();
  connectedSettings(settings);
  settings.upsert({ publicUrl: PUBLIC_URL });
  return settings;
}

/**
 * A fetch double for the two webhook-subscription calls, recording what was asked of Qonto.
 * `existing` is what Qonto already holds.
 */
function qontoStub({ existing = [], createFails = false } = {}) {
  const calls = { list: 0, create: 0, bodies: [] };
  const impl = async (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    if (!String(url).includes('/v2/webhook_subscriptions')) throw new Error(`unexpected call: ${method} ${url}`);
    if (method === 'GET') {
      calls.list += 1;
      return jsonResponse({ webhook_subscriptions: existing });
    }
    calls.create += 1;
    calls.bodies.push(JSON.parse(options.body));
    if (createFails) return jsonResponse({ errors: [{ code: 'invalid', detail: 'nope' }] }, { ok: false, status: 422 });
    return jsonResponse({ webhook_subscription: { id: 'sub-new', callback_url: CALLBACK, types: ['v1/payment-links'] } });
  };
  return { impl, calls };
}

// Rule 10 — the record is there to spare the call, not to be checked against it.
test('rule 10: a recorded subscription at the current address costs no Qonto call', async () => {
  const settings = ready();
  settings.storeQontoWebhookSubscription({ id: 'sub-1', callbackUrl: CALLBACK });
  const { impl, calls } = qontoStub();

  const result = await withStubbedFetch(impl, () => ensureWebhookSubscription({ settings, env: {} }));

  assert.equal(result.action, 'skipped');
  assert.equal(result.id, 'sub-1');
  assert.equal(calls.list, 0);
  assert.equal(calls.create, 0);
});

// Rule 10 — a trailing slash on the stored URL is the same address, not a reason to call Qonto.
test('rule 10: a trailing slash does not make the record stale', async () => {
  const settings = ready();
  settings.storeQontoWebhookSubscription({ id: 'sub-1', callbackUrl: `${CALLBACK}/` });
  const { impl, calls } = qontoStub();

  const result = await withStubbedFetch(impl, () => ensureWebhookSubscription({ settings, env: {} }));

  assert.equal(result.action, 'skipped');
  assert.equal(calls.list, 0);
});

// Rule 8 — THE rule: Qonto already answers at our address, so we touch nothing.
test('rule 8: an existing subscription at our address is adopted, never duplicated', async () => {
  const settings = ready();
  settings.storeQontoCredentials({ webhookSecret: 'the-secret-set-by-hand-in-production' });
  const { impl, calls } = qontoStub({
    existing: [
      { id: 'sub-other', callback_url: 'https://elsewhere.example/hook', types: ['v1/payment-links'] },
      { id: 'sub-ours', callback_url: CALLBACK, types: ['v1/payment-links'] },
    ],
  });

  const result = await withStubbedFetch(impl, () => ensureWebhookSubscription({ settings, env: {} }));

  assert.equal(result.action, 'adopted');
  assert.equal(result.id, 'sub-ours');
  assert.equal(calls.create, 0, 'adopting must never create a second subscription');
  assert.equal(settings.qontoWebhookSubscription().id, 'sub-ours');
  // The secret Qonto signs with is the one it was created with; ours must be left exactly as it is.
  assert.equal(settings.qontoCredentials().webhookSecret, 'the-secret-set-by-hand-in-production');
});

// Rule 7 + rule 10 — adopting once is enough: the second pass is free.
test('rules 7, 10: the pass after an adoption asks Qonto nothing', async () => {
  const settings = ready();
  const { impl, calls } = qontoStub({ existing: [{ id: 'sub-ours', callback_url: CALLBACK, types: ['v1/payment-links'] }] });

  await withStubbedFetch(impl, () => ensureWebhookSubscription({ settings, env: {} }));
  const second = await withStubbedFetch(impl, () => ensureWebhookSubscription({ settings, env: {} }));

  assert.equal(second.action, 'skipped');
  assert.equal(calls.list, 1, 'the address was already confirmed once');
  assert.equal(calls.create, 0);
});

// Rule 9 — nothing anywhere: create one, and only then invent a secret.
test('rule 9: with no subscription and no secret, one of each is created', async () => {
  const settings = ready();
  const { impl, calls } = qontoStub({ existing: [] });

  const result = await withStubbedFetch(impl, () => ensureWebhookSubscription({ settings, env: {} }));

  assert.equal(result.action, 'created');
  assert.equal(result.id, 'sub-new');
  assert.equal(calls.create, 1);

  const secret = settings.qontoCredentials().webhookSecret;
  assert.match(secret, /^[0-9a-f]{64}$/, '32 random bytes in hexadecimal');
  assert.equal(calls.bodies[0].secret, secret, 'Qonto signs with the secret we stored');
  assert.equal(calls.bodies[0].callback_url, CALLBACK);
  assert.deepEqual(calls.bodies[0].types, ['v1/payment-links']);
  assert.equal(settings.qontoWebhookSubscription().callbackUrl, CALLBACK);
});

// Rule 9 — a stored secret is never regenerated: re-creating a subscription must not orphan it.
test('rule 9: a secret already stored is reused, not replaced', async () => {
  const settings = ready();
  settings.storeQontoCredentials({ webhookSecret: 'already-chosen-secret-value-32-chars' });
  const { impl, calls } = qontoStub({ existing: [] });

  await withStubbedFetch(impl, () => ensureWebhookSubscription({ settings, env: {} }));

  assert.equal(settings.qontoCredentials().webhookSecret, 'already-chosen-secret-value-32-chars');
  assert.equal(calls.bodies[0].secret, 'already-chosen-secret-value-32-chars');
});

// Rule 10 — the address moved, so the record proves nothing and Qonto is asked again.
test('rule 10: a record pointing elsewhere is not trusted', async () => {
  const settings = ready();
  settings.storeQontoWebhookSubscription({ id: 'sub-old', callbackUrl: 'https://old.example/api/payments/qonto/webhook' });
  const { impl, calls } = qontoStub({ existing: [] });

  const result = await withStubbedFetch(impl, () => ensureWebhookSubscription({ settings, env: {} }));

  assert.equal(calls.list, 1);
  assert.equal(result.action, 'created');
  assert.equal(settings.qontoWebhookSubscription().callbackUrl, CALLBACK);
});

// Rule 11 — a webhook that cannot be subscribed must say so where the operator looks.
test('rule 11: no public URL is recorded as a failure, with no Qonto call and no throw', async () => {
  const { settings } = freshSettings();
  connectedSettings(settings);
  const { impl, calls } = qontoStub();

  const result = await withStubbedFetch(impl, () => ensureWebhookSubscription({ settings, env: {} }));

  assert.equal(result.action, 'unconfigured');
  assert.equal(calls.list, 0);
  assert.equal(settings.qontoHealth().lastError.code, 'PUBLIC_URL_MISSING');
  assert.equal(settings.qontoHealth().lastError.origin, 'webhook-register');
});

// Rule 11 — Qonto refuses: recorded, never thrown, and nothing written.
test('rule 11: a Qonto failure is recorded and swallowed, leaving no record behind', async () => {
  const settings = ready();
  const { impl } = qontoStub({ existing: [], createFails: true });

  const result = await withStubbedFetch(impl, () => ensureWebhookSubscription({ settings, env: {} }));

  assert.equal(result.action, 'failed');
  assert.ok(result.error);
  assert.equal(settings.qontoWebhookSubscription().id, '', 'a failed creation must not be recorded as done');
  assert.equal(settings.qontoHealth().lastError.origin, 'webhook-register');
});

// Rule 11 — an installation that has never connected must not be dragged through a Qonto call.
test('rule 11: an unconfigured Qonto connection fails quietly', async () => {
  const { settings } = freshSettings();
  settings.upsert({ publicUrl: PUBLIC_URL });
  const { impl, calls } = qontoStub();

  const result = await withStubbedFetch(impl, () => ensureWebhookSubscription({ settings, env: {} }));

  assert.equal(result.action, 'failed');
  assert.equal(calls.list, 0);
  assert.equal(settings.qontoHealth().lastError.code, 'QONTO_NOT_CONFIGURED');
});
