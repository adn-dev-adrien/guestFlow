// specs/settings-one-save-and-automatic-webhook.md rule 16 (audit R25-C3, R25 E25-1, 2026-11-06). The advice the Qonto badge and
// messages give names a page that exists (Paramètres → Système, « URL publique »), and the « Test » it sends the operator to
// re-runs the webhook check whenever Qonto answered, the link provider still pending included. Loopback fake only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { freshSettings } = require('./qontoSettingsFixture');
const { qontoStatusPayload, recordQontoFailure } = require('../../../utils/qonto/qontoService');
const { STATES } = require('../../../utils/qonto/qontoHealth');
const { ensureWebhookSubscription } = require('../../../utils/qonto/qontoWebhookRegistrar');
const { createQontoSettingsController } = require('../../../utils/qonto/qontoSettingsController');

const PUBLIC_URL = 'https://gf.example';
const later = () => new Date(Date.now() + 3600_000).toISOString();
const tick = () => new Promise((r) => setTimeout(r, 5));
const SYSTEM_PAGE = 'Paramètres → Système';

async function fakeQonto(t, { connectionStatus = 'pending', failConnection = false } = {}) {
  const state = { subscriptions: [], webhookCalls: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      const route = req.url.split('?')[0];
      if (route === '/v2/webhook_subscriptions') {
        state.webhookCalls += 1;
        if (req.method === 'GET') return res.end(JSON.stringify({ webhook_subscriptions: state.subscriptions }));
        const sub = { id: 'sub-1', callback_url: JSON.parse(body).callback_url, types: ['v1/payment-links'] };
        state.subscriptions.push(sub);
        return res.end(JSON.stringify({ webhook_subscription: sub }));
      }
      if (route.startsWith('/v2/payment_links/connections') && failConnection) {
        res.statusCode = 503;
        return res.end(JSON.stringify({ errors: [{ code: 'unavailable', detail: 'down' }] }));
      }
      if (route.startsWith('/v2/payment_links/connections')) return res.end(JSON.stringify({ connection: { status: connectionStatus, bank_account_id: 'ba' } }));
      return res.end(JSON.stringify({ payments: [] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  state.env = { QONTO_API_BASE: base, QONTO_OAUTH_BASE: base };
  return state;
}

function connectedWithoutAddress(connectionStatus) {
  const { settings } = freshSettings();
  settings.storeQontoCredentials({ environment: 'production', clientId: 'cid', clientSecret: 'sec', webhookSecret: 'w'.repeat(64) });
  settings.storeQontoTokens({ accessToken: 'at', refreshToken: 'rt', expiresAt: later() });
  settings.storeQontoConnection({ status: connectionStatus, connectionId: 'b' });
  return settings;
}

async function pressTest(settings, env) {
  const res = { json(body) { this.body = body; return this; } };
  await createQontoSettingsController({ settings, env }).testQontoConnection({ body: {} }, res);
  return res.body;
}

test('rule 16 — the missing-address advice names the Système page and « Test », never the e-mail page', () => {
  assert.equal(STATES.public_url_missing.action, `URL publique à renseigner (${SYSTEM_PAGE}), puis « Test ».`);
});

test('rule 16 — no Qonto message sends the operator to a menu that does not exist', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const files = [
    'utils/qonto/qontoHealth.js', 'utils/qonto/qontoWebhookRegistrar.js', 'utils/qonto/qontoSettingsController.js',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /Envoi d['’]emails/, `${file} names « Envoi d’emails »`);
    assert.doesNotMatch(source, /\(Paramètres\)/, `${file} names « Paramètres » alone`);
    assert.doesNotMatch(source, /Réglages › Paiements\)/, `${file} names « Réglages › Paiements »`);
  }
});

test('rule 16 — the stored failure of a check without address names the Système page', async (t) => {
  const q = await fakeQonto(t, { connectionStatus: 'enabled' });
  const settings = connectedWithoutAddress('enabled');
  assert.equal((await ensureWebhookSubscription({ settings, env: q.env })).action, 'unconfigured');
  const { lastError } = qontoStatusPayload({ settings, env: q.env }).health;
  assert.equal(lastError.code, 'PUBLIC_URL_MISSING');
  assert.match(lastError.message, new RegExp(`${SYSTEM_PAGE}`));
});

test('rule 16 (E25-1) — provider still pending: « Test » runs the check once the address is set, the badge then names the provider form', async (t) => {
  const q = await fakeQonto(t, { connectionStatus: 'pending' });
  const settings = connectedWithoutAddress('pending');
  assert.equal((await ensureWebhookSubscription({ settings, env: q.env })).action, 'unconfigured');
  assert.equal(qontoStatusPayload({ settings, env: q.env }).health.state, 'public_url_missing');
  await tick();
  settings.upsert({ publicUrl: PUBLIC_URL });
  const answer = await pressTest(settings, q.env);
  assert.equal(answer.ok, false);
  assert.equal(answer.state, 'provider_not_connected');
  assert.equal(q.subscriptions.length, 1, 'the check ran and subscribed');
  assert.equal(answer.status.health.lastError, null);
  assert.equal(answer.status.health.state, 'provider_not_connected');
  assert.equal(answer.status.health.action, 'Formulaire « Connexion du provider de liens » plus bas.');
});

test('rule 16 (E25-1) — Qonto not answering: « Test » still runs no check', async (t) => {
  const q = await fakeQonto(t, { failConnection: true });
  const settings = connectedWithoutAddress('pending');
  await ensureWebhookSubscription({ settings, env: q.env });
  await tick();
  settings.upsert({ publicUrl: PUBLIC_URL });
  const answer = await pressTest(settings, q.env);
  assert.equal(answer.ok, false);
  assert.equal(q.webhookCalls, 0, 'no check after a failed test');
});

// Verification N3 — a « Test » whose call fails WITHOUT recording (a refresh overtaken by a new consent, specs/qonto-settings-in-app.md rule 19) leaves the
// standing webhook-register failure on the page: that failure must not be read as « Qonto answered ».
test('rule 16 (N3) — a « Test » overtaken mid-refresh leaves the webhook failure standing and runs no check', async (t) => {
  const seen = [];
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const server = http.createServer((req, res) => {
    seen.push(req.url.split('?')[0]);
    req.resume();
    req.on('end', async () => {
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/oauth2/token')) await held;
      res.end(JSON.stringify({ access_token: 'at-old', refresh_token: 'rt-old', expires_in: 3600, webhook_subscriptions: [] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = { QONTO_API_BASE: base, QONTO_OAUTH_BASE: base };
  const settings = connectedWithoutAddress('enabled');
  settings.upsert({ publicUrl: PUBLIC_URL });
  settings.storeQontoTokens({ accessToken: 'at-expired', refreshToken: 'rt-old', expiresAt: new Date(Date.now() - 3600_000).toISOString() });
  const standing = Object.assign(new Error('scope webhook missing'), { code: 'insufficient_scope' });
  recordQontoFailure({ settings, error: standing, origin: 'webhook-register' });
  const before = qontoStatusPayload({ settings, env }).health.lastError;

  const pressed = pressTest(settings, env);
  while (!seen.includes('/oauth2/token')) await tick();
  settings.storeQontoTokens({ accessToken: '', refreshToken: 'rt-new-consent', expiresAt: '' });
  release();
  const answer = await pressed;

  assert.equal(answer.ok, false);
  assert.deepEqual(seen, ['/oauth2/token'], 'no webhook check after a call that never answered');
  assert.deepEqual(answer.status.health.lastError, before, 'the webhook failure still stands, unchanged');
});

// Verification N4 — the missing-credentials refusal of « Connexion » names the page that holds the fields, which is the
// same « Paiements en ligne » page in GuestFlow (Paramètres) and in the console (Réglages); « Réglages › Paiements » is no menu
// of GuestFlow.
test('rule 16 (N4) — « Connexion » without credentials names the Paiements en ligne page', () => {
  const { settings } = freshSettings();
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  createQontoSettingsController({ settings, env: {} }).qontoAuthorize({ query: {}, body: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'QONTO_NOT_CONFIGURED', message: 'Identifiants Qonto manquants (page Paiements en ligne).' });
});
