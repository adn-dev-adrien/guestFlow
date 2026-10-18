// specs/control-plane-plans-and-access.md rule 36 — a write reaches the console only from its own
// pages: a cross-site or same-site-but-other-host Origin is refused before the session is read; the
// Qonto webhook and requests without Origin/Referer are exempt.

const test = require('node:test');
const assert = require('node:assert/strict');
const session = require('express-session');
const { passwordHash } = require('../utils/gf');
const { createApp } = require('../app');
const { makeContext } = require('./helpers');

async function start() {
  const h = makeContext();
  h.ctx.models.operators.create({ email: 'adrien@adn-dev.fr', name: 'Adrien', passwordHash: passwordHash.hashPassword('correct horse battery') });
  const app = createApp(h.ctx, { sessionSecret: 'test', sessionStore: new session.MemoryStore() });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function call(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
  }
  async function signIn() {
    await call('POST', '/api/auth/login', { email: 'adrien@adn-dev.fr', password: 'correct horse battery' });
    const code = /Votre code : (\d{6})/.exec(h.mailer.sent[h.mailer.sent.length - 1].text)[1];
    return call('POST', '/api/auth/verify', { code });
  }
  return { ...h, base, call, signIn, close: () => new Promise((r) => server.close(r)) };
}

test('rule 36 — a signed-in operator\'s write from another host is refused, from the console itself it passes', async () => {
  const s = await start();
  try {
    assert.equal((await s.signIn()).status, 200);
    for (const origin of ['https://evil.example', 'https://acme.guestflow.test', 'null']) {
      const res = await s.call('POST', '/api/auth/logout', undefined, { origin });
      assert.equal(res.status, 403, origin);
      assert.equal(res.body.error, 'CROSS_ORIGIN');
    }
    const viaReferer = await s.call('POST', '/api/auth/logout', undefined, { referer: 'https://acme.guestflow.test/reglages' });
    assert.equal(viaReferer.status, 403, 'Referer counts when Origin is absent');
    assert.equal((await s.call('GET', '/api/auth/me', undefined, { origin: 'https://evil.example' })).status, 200, 'reads pass');
    assert.equal((await s.call('POST', '/api/auth/logout', undefined, { origin: s.base })).status, 200, 'the console\'s own origin');
  } finally {
    await s.close();
  }
});

test('rule 36 — the login itself is refused from another host', async () => {
  const s = await start();
  try {
    const res = await s.call('POST', '/api/auth/login', { email: 'adrien@adn-dev.fr', password: 'correct horse battery' }, { origin: 'https://acme.guestflow.test' });
    assert.equal(res.status, 403);
    assert.equal(s.mailer.sent.length, 0, 'no code mailed');
  } finally {
    await s.close();
  }
});

test('rule 36 — exemptions: Qonto\'s webhook, and a request with neither Origin nor Referer', async () => {
  const s = await start();
  try {
    const hook = await s.call('POST', '/api/payments/qonto/webhook', { event: 'x' }, { origin: 'https://qonto.example' });
    assert.notEqual(hook.status, 403, 'the webhook answers by its own signature check');
    assert.equal((await s.call('POST', '/api/auth/login', { email: 'adrien@adn-dev.fr', password: 'correct horse battery' })).body.step, 'second-factor');
  } finally {
    await s.close();
  }
});
