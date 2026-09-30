// specs/control-plane-plans-and-access.md rule 32 — GuestFlow's own Qonto module and settings
// handlers, run over the console's settings: secrets encrypted at rest and masked, the OAuth flow
// with the console's scopes and address, and the payment-link webhook behind Qonto's signature.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const session = require('express-session');
const { passwordHash, qontoService } = require('../utils/gf');
const { createApp } = require('../app');
const { makeContext, makeFakeQonto, makeInstance, NEW_CUSTOMER } = require('./helpers');

test('rule 32 — the console’s settings speak GuestFlow’s settings interface, secrets encrypted and masked', () => {
  const h = makeContext();
  try {
    const settings = h.ctx.models.qontoSettings;
    const saved = qontoService.applyQontoCredentials({ settings, env: {}, body: { environment: 'production', clientId: ' cid ', clientSecret: 'top-secret\n' } });
    assert.equal(saved.clientId, 'cid');
    assert.deepEqual(saved.secrets.clientSecret, { configured: true, source: 'db' });
    assert.equal(saved.redirectUri, 'https://console.guestflow.test/api/payments/qonto/callback');
    const raw = h.ctx.db.prepare('SELECT qontoClientSecretEncrypted FROM qonto_settings').get().qontoClientSecretEncrypted;
    assert.ok(raw.startsWith('v1:') && !raw.includes('top-secret'), 'encrypted at rest');
    assert.equal(settings.qontoCredentials().clientSecret, 'top-secret', 'trimmed');

    settings.storeQontoTokens({ accessToken: 'at', refreshToken: 'rt', expiresAt: '2099-01-01T00:00:00Z' });
    assert.equal(settings.qontoConnected(), true);
    const changed = qontoService.applyQontoCredentials({ settings, env: {}, body: { clientId: 'other' } });
    assert.equal(changed.tokensCleared, true, 'another application drops the old authorisation');
    assert.equal(settings.qontoConnected(), false);
  } finally {
    h.cleanup();
  }
});

async function start({ qonto } = {}) {
  const h = makeContext({ at: '2026-10-01T08:00:00Z', qonto });
  h.ctx.models.operators.create({ email: 'adrien@adn-dev.fr', name: 'Adrien', passwordHash: passwordHash.hashPassword('correct horse battery') });
  const app = createApp(h.ctx, { sessionSecret: 'test', sessionStore: new session.MemoryStore() });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function call(method, url, body, headers = {}) {
    const raw = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const res = await fetch(base + url, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: raw });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, location: res.headers.get('location'), body: type.includes('json') ? await res.json() : await res.text() };
  }
  async function signIn() {
    await call('POST', '/api/auth/login', { email: 'adrien@adn-dev.fr', password: 'correct horse battery' });
    const code = /Votre code : (\d{6})/.exec(h.mailer.sent[h.mailer.sent.length - 1].text)[1];
    return call('POST', '/api/auth/verify', { code });
  }
  return { ...h, call, signIn, close: () => new Promise((r) => server.close(r)) };
}

test('rule 32 — the Paiements routes answer an operator only; authorize asks the console’s scopes', async () => {
  const s = await start();
  try {
    assert.equal((await s.call('GET', '/api/payments/settings')).status, 401);
    await s.signIn();
    const page = await s.call('GET', '/api/payments/settings');
    assert.equal(page.status, 200);
    assert.equal(page.body.qonto.configured, false);
    assert.equal((await s.call('PUT', '/api/payments/qonto/credentials', { environment: 'sandbox', clientId: 'cid', clientSecret: 'sec' })).status, 200);

    const auth = await s.call('GET', '/api/payments/qonto/authorize');
    assert.equal(auth.status, 302);
    const url = new URL(auth.location);
    assert.equal(url.origin, 'https://oauth-sandbox.staging.qonto.co');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://console.guestflow.test/api/payments/qonto/callback');
    for (const scope of ['payment_link.write', 'webhook', 'client.write', 'client_invoice.write']) {
      assert.ok(url.searchParams.get('scope').split(' ').includes(scope), scope);
    }
    const back = await s.call('GET', '/api/payments/qonto/callback?code=x&state=forged');
    assert.equal(back.location, '/parametres/paiements?qonto=invalid_state');
  } finally {
    await s.close();
  }
});

function sign(secret, body, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

test('rules 32, 34 — the webhook needs Qonto’s signature, then re-reads Qonto before renewing', async () => {
  const qonto = makeFakeQonto();
  const s = await start({ qonto });
  try {
    makeInstance(s.root, 'aulnes');
    const c = await s.ctx.controllers.customers.create({ ...NEW_CUSTOMER, billing: 'monthly', length: 1, startsAt: '2026-10-01' }, 'op');
    s.now.set('2026-10-25T08:00:00Z');
    await s.ctx.controllers.billing.runDaily(() => {});
    const body = JSON.stringify({ event_type: 'payment_links.updated', data: { payment_link_id: 'pl_3' } });

    assert.equal((await s.call('POST', '/api/payments/qonto/webhook', body)).status, 503, 'no secret: fail closed');
    s.ctx.models.qontoSettings.storeQontoCredentials({ webhookSecret: 'whsec' });
    assert.equal((await s.call('POST', '/api/payments/qonto/webhook', body, { 'x-qonto-signature': sign('other', body) })).status, 401);

    qonto.pay('pl_3');
    const ok = await s.call('POST', '/api/payments/qonto/webhook', body, { 'x-qonto-signature': sign('whsec', body) });
    assert.equal(ok.status, 200);
    assert.equal(s.ctx.controllers.customers.view(c.id).endsAt, '2026-12-01');
  } finally {
    await s.close();
  }
});
