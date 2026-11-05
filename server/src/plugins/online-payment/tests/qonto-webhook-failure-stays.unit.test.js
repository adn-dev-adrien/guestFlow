// specs/settings-one-save-and-automatic-webhook.md rule 15 and specs/qonto-settings-in-app.md rule 21 (audit R24 E24-2, E24-3). A failed webhook check stays on the page until
// a check succeeds: the poll that follows it in the same pass, or a reconciliation read, says nothing about the
// subscription. Every origin a failure can carry has its French label in the status payload. Loopback fake only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { freshSettings } = require('./qontoSettingsFixture');
const { withQonto, qontoStatusPayload, recordQontoFailure, ORIGINS } = require('../../../utils/qonto/qontoService');
const { ensureWebhookSubscription } = require('../../../utils/qonto/qontoWebhookRegistrar');
const { createQontoSettingsController } = require('../../../utils/qonto/qontoSettingsController');

const PUBLIC_URL = 'https://gf.example';
const CALLBACK_URL = `${PUBLIC_URL}/api/payments/qonto/webhook`;
const later = () => new Date(Date.now() + 3600_000).toISOString();
const tick = () => new Promise((r) => setTimeout(r, 5));

async function fakeQonto(t) {
  const state = { refuseWebhook: true, subscriptions: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      const route = req.url.split('?')[0];
      if (route === '/v2/webhook_subscriptions') {
        if (state.refuseWebhook) {
          res.statusCode = 403;
          return res.end(JSON.stringify({ errors: [{ code: 'insufficient_scope', detail: 'scope webhook missing' }] }));
        }
        if (req.method === 'GET') return res.end(JSON.stringify({ webhook_subscriptions: state.subscriptions }));
        const sub = { id: 'sub-1', callback_url: JSON.parse(body).callback_url, types: ['v1/payment-links'] };
        state.subscriptions.push(sub);
        return res.end(JSON.stringify({ webhook_subscription: sub }));
      }
      if (route.startsWith('/v2/payment_links/connections') && state.failConnection) {
        res.statusCode = 503;
        return res.end(JSON.stringify({ errors: [{ code: 'unavailable', detail: 'down' }] }));
      }
      if (route.startsWith('/v2/payment_links/connections')) return res.end(JSON.stringify({ connection: { status: 'enabled', bank_account_id: 'ba' } }));
      return res.end(JSON.stringify({ payments: [] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  state.env = { QONTO_API_BASE: base, QONTO_OAUTH_BASE: base };
  return state;
}

function connected() {
  const { settings } = freshSettings();
  settings.upsert({ publicUrl: PUBLIC_URL });
  settings.storeQontoCredentials({ environment: 'production', clientId: 'cid', clientSecret: 'sec', webhookSecret: 'w'.repeat(64) });
  settings.storeQontoTokens({ accessToken: 'at', refreshToken: 'rt', expiresAt: later() });
  settings.storeQontoConnection({ status: 'enabled', connectionId: 'b' });
  return settings;
}

const pagePoll = (settings, env, origin = 'poll') => withQonto({ settings, env, origin }, (client, accessToken) =>
  client.getPaymentLinkPayments({ accessToken, id: 'link-1' }));
const lastError = (settings, env) => qontoStatusPayload({ settings, env }).health.lastError;

test('settings-one-save-and-automatic-webhook rule 15 — a failed webhook check survives the poll and the reconciliation read of the same pass', async (t) => {
  const q = await fakeQonto(t);
  const settings = connected();
  assert.equal((await ensureWebhookSubscription({ settings, env: q.env })).action, 'failed');
  assert.equal(lastError(settings, q.env).origin, 'webhook-register');
  await tick();
  await pagePoll(settings, q.env);
  await pagePoll(settings, q.env, 'reconciliation');
  const after = lastError(settings, q.env);
  assert.equal(after && after.origin, 'webhook-register', 'still shown after two successful calls');
  assert.equal(after.code, 'insufficient_scope');
  assert.equal(qontoStatusPayload({ settings, env: q.env }).health.state === 'ok', false, 'the badge does not claim a working connection');
});

test('settings-one-save-and-automatic-webhook rule 15 — the next check that succeeds clears it and stamps the success', async (t) => {
  const q = await fakeQonto(t);
  const settings = connected();
  await ensureWebhookSubscription({ settings, env: q.env });
  await tick();
  q.refuseWebhook = false;
  assert.equal((await ensureWebhookSubscription({ settings, env: q.env })).action, 'created');
  const health = qontoStatusPayload({ settings, env: q.env }).health;
  assert.equal(health.lastError, null);
  assert.ok(health.lastSuccessAt);
});

test('settings-one-save-and-automatic-webhook rule 15 — a missing public address recorded by the check is cleared once the record matches again (no call)', async (t) => {
  const q = await fakeQonto(t);
  const settings = connected();
  settings.storeQontoWebhookSubscription({ id: 'sub-1', callbackUrl: CALLBACK_URL });
  settings.upsert({ publicUrl: '' });
  assert.equal((await ensureWebhookSubscription({ settings, env: q.env })).action, 'unconfigured');
  assert.equal(lastError(settings, q.env).origin, 'webhook-register');
  await tick();
  const before = qontoStatusPayload({ settings, env: q.env }).health.lastSuccessAt;
  settings.upsert({ publicUrl: PUBLIC_URL });
  assert.equal((await ensureWebhookSubscription({ settings, env: q.env })).action, 'skipped');
  assert.equal(lastError(settings, q.env), null);
  assert.equal(qontoStatusPayload({ settings, env: q.env }).health.lastSuccessAt, before, 'no call made: no success stamped');
});

test('qonto-settings-in-app rule 13 unchanged — any other failure is still cleared by a success, and a webhook success leaves it alone', async (t) => {
  const q = await fakeQonto(t);
  const settings = connected();
  recordQontoFailure({ settings, error: Object.assign(new Error('refusé'), { code: 'invalid_client' }), origin: 'test' });
  q.refuseWebhook = false;
  await tick();
  assert.equal((await ensureWebhookSubscription({ settings, env: q.env })).action, 'created');
  assert.equal(lastError(settings, q.env).origin, 'test', 'the check never erases another diagnosis');
  await tick();
  await pagePoll(settings, q.env);
  assert.equal(lastError(settings, q.env), null);
});

test('qonto-settings-in-app rule 21 — the status payload carries the French label of the origin', async (t) => {
  const q = await fakeQonto(t);
  const settings = connected();
  for (const [origin, label] of [['reconciliation', 'rapprochement bancaire'], ['webhook-register', 'abonnement au webhook'], ['lapsed-link', 'vérification d’un lien échu']]) {
    recordQontoFailure({ settings, error: new Error('x'), origin });
    assert.equal(lastError(settings, q.env).originLabel, label);
  }
  recordQontoFailure({ settings, error: new Error('x'), origin: 'inconnu' });
  assert.equal(lastError(settings, q.env).originLabel, '', 'an unknown origin gets no raw code');
});

test('qonto-settings-in-app rule 21 — every origin handed to a Qonto call in the source has a label', () => {
  const roots = [path.join(__dirname, '../../..'), path.join(__dirname, '../../../../../control-plane/server/src')];
  const found = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'tests' || e.name === '__tests__') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
          const call = line.match(/\b(?:getPayment|createLink|withQonto|recordQontoFailure)\(.*origin: '([a-z-]+)'/);
          if (call) found.add(call[1]);
          const provider = line.match(/\bcall\('([a-z-]+)'/);
          if (provider) found.add(provider[1]);
        }
      }
    }
  };
  roots.forEach(walk);
  assert.ok(found.size >= 10, `scan found ${found.size} origins`);
  const missing = [...found].filter((o) => !ORIGINS[o]);
  assert.deepEqual(missing, []);
});

// Rule 15 reading of 2026-11-05 (audit R24 R1) — while the webhook check's failure stands, the badge names its real repair,
// and « Test » runs the check again, so the advice it gives can clear it.
async function pressTest(settings, env) {
  const res = { json(body) { this.body = body; return this; } };
  await createQontoSettingsController({ settings, env }).testQontoConnection({ body: {} }, res);
  return res.body;
}

test('settings-one-save-and-automatic-webhook rule 15 — a scope refused by the webhook check: « Test » passes, the badge says « Connexion »', async (t) => {
  const q = await fakeQonto(t);
  const settings = connected();
  await ensureWebhookSubscription({ settings, env: q.env });
  await tick();
  const answer = await pressTest(settings, q.env);
  assert.equal(answer.ok, true);
  assert.equal(answer.status.health.state, 'reauth_required');
  assert.equal(answer.status.health.action, '« Connexion », puis accepter l\'accès chez Qonto.');
  assert.equal(answer.status.health.lastError.origin, 'webhook-register');
});

test('settings-one-save-and-automatic-webhook rule 15 — a missing public address: the badge names it, and « Test » clears it once set', async (t) => {
  const q = await fakeQonto(t);
  q.refuseWebhook = false;
  const settings = connected();
  settings.upsert({ publicUrl: '' });
  assert.equal((await ensureWebhookSubscription({ settings, env: q.env })).action, 'unconfigured');
  const shown = qontoStatusPayload({ settings, env: q.env }).health;
  assert.equal(shown.state, 'public_url_missing');
  assert.equal(shown.action, 'Adresse publique à renseigner (Réglages → Envoi d’emails), puis relancer le test.');
  await tick();
  settings.upsert({ publicUrl: PUBLIC_URL });
  const answer = await pressTest(settings, q.env);
  assert.equal(answer.status.health.lastError, null);
  assert.equal(answer.status.health.state, 'ok');
  assert.equal(q.subscriptions.length, 1, 'the check ran and subscribed');
});

test('settings-one-save-and-automatic-webhook rule 15 — with no webhook failure standing, « Test » does not run the check', async (t) => {
  const q = await fakeQonto(t);
  q.refuseWebhook = false;
  const settings = connected();
  const answer = await pressTest(settings, q.env);
  assert.equal(answer.ok, true);
  assert.equal(q.subscriptions.length, 0);
});

test('settings-one-save-and-automatic-webhook rule 15 — a failed « Test » runs no webhook check and shows its own failure', async (t) => {
  const q = await fakeQonto(t);
  const settings = connected();
  await ensureWebhookSubscription({ settings, env: q.env });
  await tick();
  q.refuseWebhook = false;
  q.failConnection = true;
  const answer = await pressTest(settings, q.env);
  assert.equal(answer.ok, false);
  assert.equal(q.subscriptions.length, 0, 'no check after a failed test');
  // The failed call records its own origin, so the result.ok guard and the origin guard both hold the check back.
  assert.notEqual(answer.status.health.lastError.origin, 'webhook-register');
});
