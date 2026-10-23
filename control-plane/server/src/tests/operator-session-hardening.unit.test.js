// specs/control-plane-plans-and-access.md rules 31 and 39 — what a stolen operator cookie cannot do
// (security review 2026-10-23): guess the password through the method change, reuse the code that
// confirmed the app, or keep a half-done login open; and the console's boot refusing to run as
// production with a public session secret or without Caddy's proxy secret.

const test = require('node:test');
const assert = require('node:assert/strict');
const session = require('express-session');
const { passwordHash, totp } = require('../utils/gf');
const { createApp } = require('../app');
const { PENDING_MS } = require('../routes/auth');
const { readBootConfig, DEV_SESSION_SECRET } = require('../utils/bootConfig');
const { makeContext } = require('./helpers');

const EMAIL = 'adrien@adn-dev.fr';
const PASSWORD = 'correct horse battery';

function setup() {
  const h = makeContext();
  const id = h.ctx.models.operators.create({ email: EMAIL, name: 'Adrien', passwordHash: passwordHash.hashPassword(PASSWORD) });
  return { ...h, id, auth: h.ctx.controllers.auth, operators: h.ctx.models.operators };
}

async function start() {
  const h = setup();
  const app = createApp(h.ctx, { sessionSecret: 'test', sessionStore: new session.MemoryStore() });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function call(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  const lastCode = () => /Votre code : (\d{6})/.exec(h.mailer.sent[h.mailer.sent.length - 1].text)[1];
  async function signIn() {
    await call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
    return call('POST', '/api/auth/verify', { code: lastCode() });
  }
  return { ...h, call, signIn, lastCode, close: () => new Promise((r) => server.close(r)) };
}

test('rule 31 — inside a session, five wrong passwords on « change the method » lock the account', async () => {
  const { auth, id, operators, now } = setup();
  for (let i = 0; i < 4; i += 1) {
    await assert.rejects(auth.startMethod(id, { method: 'totp', password: `guess ${i}` }), (e) => e.status === 400 && e.body.error === 'BAD_PASSWORD');
  }
  assert.equal(operators.byId(id).failedCount, 4);
  await assert.rejects(auth.startMethod(id, { method: 'totp', password: 'guess 4' }), (e) => e.status === 429 && e.body.error === 'LOCKED');
  await assert.rejects(auth.startMethod(id, { method: 'totp', password: PASSWORD }), (e) => e.status === 429, 'the right password no longer helps');
  assert.throws(() => auth.confirmMethod(id, { code: '000000' }), (e) => e.status === 429);
  await assert.rejects(auth.login({ email: EMAIL, password: PASSWORD }), (e) => e.status === 429, 'the login is locked too');
  now.set(new Date(now().getTime() + 15 * 60000 + 1000));
  assert.equal((await auth.startMethod(id, { method: 'totp', password: PASSWORD })).method, 'totp');
});

test('rule 31 — the TOTP code that confirmed the app cannot open a session', async () => {
  const { auth, id, now } = setup();
  const started = await auth.startMethod(id, { method: 'totp', password: PASSWORD });
  const key = totp.base32Decode(started.secret.replace(/\s/g, ''));
  const code = totp.totp(key, now());
  auth.confirmMethod(id, { code });
  await auth.login({ email: EMAIL, password: PASSWORD });
  assert.throws(() => auth.verify(id, { code }), (e) => e.body.error === 'BAD_CODE');
  now.set(new Date(now().getTime() + 30000));
  assert.ok(auth.verify(id, { code: totp.totp(key, now()) }).operator, 'the next step opens it');
});

test('rule 31 — « /mfa/start » counts wrong passwords and a lock ends the session that hit it', async () => {
  const s = await start();
  try {
    assert.equal((await s.signIn()).status, 200);
    const answers = [];
    for (let i = 0; i < 5; i += 1) answers.push((await s.call('POST', '/api/auth/mfa/start', { method: 'totp', password: `guess ${i}` })).status);
    assert.deepEqual(answers, [400, 400, 400, 400, 429]);
    assert.equal((await s.call('GET', '/api/auth/me')).status, 401, 'the cookie is dead');
  } finally {
    await s.close();
  }
});

test('rule 31 — « /mfa/start » and « /mfa/confirm » share the per-IP limit of the login', async () => {
  const s = await start();
  try {
    assert.equal((await s.signIn()).status, 200);
    // Login, verify and start take 3 of the 30; a wrong code while changing the method locks nothing.
    await s.call('POST', '/api/auth/mfa/start', { method: 'email', password: PASSWORD });
    // The 5th wrong code cancels the change (429 TOO_MANY_CODES); the limiter answers RATE_LIMITED.
    let error = null;
    let n = 0;
    while (error !== 'RATE_LIMITED' && n < 40) {
      error = (await s.call('POST', '/api/auth/mfa/confirm', { code: '000000' })).body.error;
      n += 1;
    }
    assert.equal(n, 28, 'the 31st request of the window is refused');
    const refused = await s.call('POST', '/api/auth/mfa/start', { method: 'email', password: PASSWORD });
    assert.equal(refused.status, 429);
    assert.equal(refused.body.error, 'RATE_LIMITED');
  } finally {
    await s.close();
  }
});

test('rule 31 — a password typed opens the second step for 10 minutes only', async () => {
  const s = await start();
  try {
    await s.call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
    s.now.set(new Date(s.now().getTime() + PENDING_MS + 1000));
    const late = await s.call('POST', '/api/auth/verify', { code: s.lastCode() });
    assert.equal(late.status, 401);
    assert.equal(late.body.error, 'NO_PENDING_LOGIN');
    assert.equal((await s.call('POST', '/api/auth/resend')).body.error, 'NO_PENDING_LOGIN');
    await s.call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
    s.now.set(new Date(s.now().getTime() + PENDING_MS - 1000));
    assert.equal((await s.call('POST', '/api/auth/verify', { code: s.lastCode() })).status, 200);
  } finally {
    await s.close();
  }
});

test('rule 39 — outside development and test, both secrets are required and cookies are Secure', () => {
  for (const NODE_ENV of ['production', undefined, '', 'staging']) {
    assert.throws(() => readBootConfig({ NODE_ENV }), /CP_SESSION_SECRET, CP_PROXY_SECRET required/);
    assert.throws(() => readBootConfig({ NODE_ENV, CP_SESSION_SECRET: 's3cret' }), /^Error: CP_PROXY_SECRET required/);
    assert.throws(() => readBootConfig({ NODE_ENV, CP_PROXY_SECRET: 'p' }), /^Error: CP_SESSION_SECRET required/);
  }
  assert.throws(() => readBootConfig({ NODE_ENV: 'production', CP_SESSION_SECRET: DEV_SESSION_SECRET, CP_PROXY_SECRET: 'p' }), /public development secret/);
  assert.deepEqual(readBootConfig({ NODE_ENV: 'production', CP_SESSION_SECRET: 's3cret', CP_PROXY_SECRET: 'p' }),
    { devMode: false, sessionSecret: 's3cret', secureCookies: true, proxySecret: 'p' });
});

test('rule 39 — development and test run without them, over plain HTTP', () => {
  assert.deepEqual(readBootConfig({ NODE_ENV: 'development' }),
    { devMode: true, sessionSecret: DEV_SESSION_SECRET, secureCookies: false, proxySecret: null });
  assert.deepEqual(readBootConfig({ NODE_ENV: 'test', CP_SESSION_SECRET: 'x', CP_PROXY_SECRET: 'p' }),
    { devMode: true, sessionSecret: 'x', secureCookies: false, proxySecret: 'p' });
  assert.throws(() => readBootConfig({ NODE_ENV: 'Development' }), /required/, 'the mode is spelled exactly');
});
