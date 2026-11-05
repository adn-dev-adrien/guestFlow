// specs/settings-one-save-and-automatic-webhook.md rules 8 and 10, readings of 2026-11-05 (audit R23, E23-1 and E23-5).
// The record of a subscription belongs to the account that consented: a sandbox record answered « skipped » for the
// production account, and no webhook ever arrived there. A fresh consent forgets it, so the check asks the new account;
// and two checks at once share one call to Qonto. Loopback fake only.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { freshSettings } = require('./qontoSettingsFixture');
const { applyQontoCredentials } = require('../../../utils/qonto/qontoService');
const { ensureWebhookSubscription, forgetWebhookSubscription } = require('../../../utils/qonto/qontoWebhookRegistrar');
const { createQontoSettingsController } = require('../../../utils/qonto/qontoSettingsController');

const PUBLIC_URL = 'https://gf.example';
const CALLBACK_URL = `${PUBLIC_URL}/api/payments/qonto/webhook`;
const later = () => new Date(Date.now() + 3600_000).toISOString();

async function fakeQonto(t, { subscriptions = [], failList = false } = {}) {
  const state = { subscriptions, failList, calls: [], listGate: null };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      res.setHeader('content-type', 'application/json');
      const path = req.url.split('?')[0];
      state.calls.push(`${req.method} ${path}`);
      if (path === '/oauth2/token') return res.end(JSON.stringify({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 }));
      if (path === '/v2/payment_links/connections') return res.end(JSON.stringify({ connection: { status: 'enabled', bank_account_id: 'ba' } }));
      if (path !== '/v2/webhook_subscriptions') return res.end('{}');
      if (req.method === 'GET') {
        const gate = state.listGate;
        if (gate) await gate;
        if (state.failList) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ errors: [{ code: 'bad', detail: 'refused' }] }));
        }
        return res.end(JSON.stringify({ webhook_subscriptions: state.subscriptions }));
      }
      const sub = { id: `new-${state.subscriptions.length + 1}`, callback_url: JSON.parse(body).callback_url, types: ['v1/payment-links'] };
      state.subscriptions.push(sub);
      return res.end(JSON.stringify({ webhook_subscription: sub }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  state.env = { QONTO_API_BASE: base, QONTO_OAUTH_BASE: base };
  return state;
}

function sandboxInstallation() {
  const { settings } = freshSettings();
  settings.upsert({ publicUrl: PUBLIC_URL });
  settings.storeQontoCredentials({ environment: 'sandbox', clientId: 'cid', clientSecret: 'sec', webhookSecret: 'w'.repeat(64) });
  settings.storeQontoTokens({ accessToken: 'at', refreshToken: 'rt', expiresAt: later() });
  settings.storeQontoConnection({ status: 'enabled', connectionId: 'b' });
  settings.storeQontoWebhookSubscription({ id: 'sandbox-sub', callbackUrl: CALLBACK_URL });
  return settings;
}

async function consent(settings, env) {
  const controller = createQontoSettingsController({ settings, env });
  const req = { query: { code: 'c', state: 's' }, session: { qontoOAuthState: 's' } };
  let location = '';
  await controller.qontoCallback(req, { redirect: (to) => { location = to; } });
  return location;
}

const creates = (qonto) => qonto.calls.filter((c) => c === 'POST /v2/webhook_subscriptions').length;
const lists = (qonto) => qonto.calls.filter((c) => c === 'GET /v2/webhook_subscriptions').length;

test('rule 10: switching to production then consenting subscribes the new account, once', async (t) => {
  const qonto = await fakeQonto(t);
  const settings = sandboxInstallation();
  const saved = applyQontoCredentials({ settings, env: qonto.env, body: { environment: 'production', clientId: 'cid-prod', clientSecret: 'sec-prod' } });
  assert.equal(saved.tokensCleared, true);

  assert.match(await consent(settings, qonto.env), /qonto=connected/);

  assert.equal(creates(qonto), 1);
  assert.equal(qonto.subscriptions.length, 1);
  assert.deepEqual(settings.qontoWebhookSubscription(), { id: 'new-1', callbackUrl: CALLBACK_URL });
  await ensureWebhookSubscription({ settings, env: qonto.env });
  assert.equal(creates(qonto), 1, 'the record is free again once the new account answered');
  assert.equal(lists(qonto), 1);
});

test('rule 8: a consent on the same account adopts what is there, no second subscription', async (t) => {
  const qonto = await fakeQonto(t, { subscriptions: [{ id: 'sandbox-sub', callback_url: CALLBACK_URL, types: ['v1/payment-links'] }] });
  const settings = sandboxInstallation();
  await consent(settings, qonto.env);
  assert.equal(creates(qonto), 0);
  assert.equal(lists(qonto), 1);
  assert.equal(settings.qontoWebhookSubscription().id, 'sandbox-sub');
});

test('rule 10: a list refused at the consent leaves the record empty, and the next check heals it', async (t) => {
  const qonto = await fakeQonto(t, { failList: true });
  const settings = sandboxInstallation();
  await consent(settings, qonto.env);
  assert.deepEqual(settings.qontoWebhookSubscription(), { id: '', callbackUrl: '' });
  qonto.failList = false;
  const outcome = await ensureWebhookSubscription({ settings, env: qonto.env });
  assert.equal(outcome.action, 'created');
  assert.equal(qonto.subscriptions.length, 1);
});

test('rule 10: a refused consent keeps the record', async (t) => {
  const qonto = await fakeQonto(t);
  const settings = sandboxInstallation();
  const controller = createQontoSettingsController({ settings, env: qonto.env });
  await controller.qontoCallback({ query: { error: 'access_denied' }, session: {} }, { redirect() {} });
  assert.equal(settings.qontoWebhookSubscription().id, 'sandbox-sub');
  assert.deepEqual(qonto.calls, []);
});

test('rule 8: two checks at once share one list and one create', async (t) => {
  const qonto = await fakeQonto(t);
  const { settings } = freshSettings();
  settings.upsert({ publicUrl: PUBLIC_URL });
  settings.storeQontoCredentials({ environment: 'sandbox', clientId: 'cid', clientSecret: 'sec', webhookSecret: 'w'.repeat(64) });
  settings.storeQontoTokens({ accessToken: 'at', refreshToken: 'rt', expiresAt: later() });

  const [a, b] = await Promise.all([
    ensureWebhookSubscription({ settings, env: qonto.env }),
    ensureWebhookSubscription({ settings, env: qonto.env }),
  ]);
  assert.deepEqual(a, b);
  assert.equal(creates(qonto), 1);
  assert.equal(lists(qonto), 1);
  assert.equal(qonto.subscriptions.length, 1);
});

test('rule 8: the shared check leaves once answered, and each settings store has its own', async (t) => {
  const qonto = await fakeQonto(t);
  const one = sandboxInstallation();
  const other = sandboxInstallation();
  one.storeQontoWebhookSubscription({ id: '', callbackUrl: '' });
  other.storeQontoWebhookSubscription({ id: '', callbackUrl: '' });
  await Promise.all([ensureWebhookSubscription({ settings: one, env: qonto.env }), ensureWebhookSubscription({ settings: other, env: qonto.env })]);
  assert.equal(lists(qonto), 2, 'two installations, two questions');
  const next = await ensureWebhookSubscription({ settings: one, env: qonto.env });
  assert.equal(next.action, 'skipped');
});

test('rule 10: a check still in flight on the old account cannot write over a fresh consent', async (t) => {
  const qonto = await fakeQonto(t, { subscriptions: [{ id: 'old-account-sub', callback_url: CALLBACK_URL, types: ['v1/payment-links'] }] });
  const settings = sandboxInstallation();
  settings.storeQontoWebhookSubscription({ id: '', callbackUrl: '' });
  let release;
  qonto.listGate = new Promise((resolve) => { release = resolve; });

  const poll = ensureWebhookSubscription({ settings, env: qonto.env });
  while (lists(qonto) === 0) await new Promise((resolve) => setImmediate(resolve));

  const forgotten = forgetWebhookSubscription({ settings });
  qonto.listGate = null;
  release();
  assert.equal((await poll).id, 'old-account-sub');
  await forgotten;
  assert.deepEqual(settings.qontoWebhookSubscription(), { id: '', callbackUrl: '' }, 'forgotten after the old answer landed');
  qonto.subscriptions = [];
  const outcome = await ensureWebhookSubscription({ settings, env: qonto.env });
  assert.equal(outcome.action, 'created');
});
