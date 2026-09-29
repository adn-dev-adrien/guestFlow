// specs/control-plane-plans-and-access.md rule 31 over HTTP — the console answers nothing but the
// login until the second factor is done — and the wiring of the console routes (rules 7, 8, 20).

const test = require('node:test');
const assert = require('node:assert/strict');
const session = require('express-session');
const { passwordHash } = require('../utils/gf');
const { createApp } = require('../app');
const { makeContext, makeInstance, NEW_CUSTOMER } = require('./helpers');

async function start() {
  const h = makeContext();
  h.ctx.models.operators.create({ email: 'adrien@adn-dev.fr', name: 'Adrien', passwordHash: passwordHash.hashPassword('correct horse battery') });
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
    const type = res.headers.get('content-type') || '';
    return { status: res.status, type, body: type.includes('json') ? await res.json() : await res.text() };
  }
  async function signIn() {
    await call('POST', '/api/auth/login', { email: 'adrien@adn-dev.fr', password: 'correct horse battery' });
    const code = /Votre code : (\d{6})/.exec(h.mailer.sent[h.mailer.sent.length - 1].text)[1];
    return call('POST', '/api/auth/verify', { code });
  }
  return { ...h, call, signIn, close: () => new Promise((r) => server.close(r)) };
}

test('rule 31 — nothing but the login answers before the second factor', async () => {
  const s = await start();
  try {
    assert.equal((await s.call('GET', '/api/customers')).status, 401);
    const step1 = await s.call('POST', '/api/auth/login', { email: 'adrien@adn-dev.fr', password: 'correct horse battery' });
    assert.equal(step1.body.step, 'second-factor');
    assert.equal((await s.call('GET', '/api/customers')).status, 401, 'a password alone opens nothing');
    assert.equal((await s.call('GET', '/api/auth/me')).status, 401);
    const code = /Votre code : (\d{6})/.exec(s.mailer.sent[0].text)[1];
    const ok = await s.call('POST', '/api/auth/verify', { code });
    assert.equal(ok.status, 200);
    assert.equal((await s.call('GET', '/api/auth/me')).body.mfaLabel, 'Code par email');
    assert.equal((await s.call('GET', '/api/customers')).status, 200);
    await s.call('POST', '/api/auth/logout');
    assert.equal((await s.call('GET', '/api/customers')).status, 401);
  } finally {
    await s.close();
  }
});

test('rule 31 — the session expires after 30 idle minutes', async () => {
  const s = await start();
  try {
    await s.signIn();
    s.now.set('2026-09-29T10:31:00Z');
    const res = await s.call('GET', '/api/customers');
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'SESSION_EXPIRED');
  } finally {
    await s.close();
  }
});

test('rules 7, 8 and 20 — create, list, act and download the export over HTTP', async () => {
  const s = await start();
  try {
    await s.signIn();
    makeInstance(s.root, 'aulnes');
    const bad = await s.call('POST', '/api/customers', { ...NEW_CUSTOMER, slug: 'admin' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.errors.slug, 'Adresse réservée.');
    const created = await s.call('POST', '/api/customers', NEW_CUSTOMER);
    assert.equal(created.status, 201);
    assert.equal(created.body.history[0].operator, 'adrien@adn-dev.fr');
    const fleet = await s.call('GET', '/api/customers');
    assert.equal(fleet.body.rows[0].slug, 'aulnes');
    const lic = await s.call('GET', `/api/customers/${created.body.id}/licence`);
    assert.equal(lic.status, 200);
    assert.equal(lic.body.split('.').length, 3);
    const refused = await s.call('POST', `/api/customers/${created.body.id}/extend`, { endsAt: '2027-12-01' });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.message, 'Le motif est obligatoire.');
    await s.call('POST', `/api/customers/${created.body.id}/deprovision`, { confirmSlug: 'aulnes' });
    const token = /exports\/([A-Za-z0-9_-]+)/.exec(s.mailer.sent.find((m) => /Export/.test(m.subject)).text)[1];
    await s.call('POST', '/api/auth/logout');
    const dl = await s.call('GET', `/exports/${token}`);
    assert.equal(dl.status, 200, 'the emailed link needs no console session');
    s.now.set('2026-10-30T10:00:00Z');
    assert.equal((await s.call('GET', `/exports/${token}`)).status, 410);
    assert.equal((await s.call('GET', '/exports/nope')).status, 404);
  } finally {
    await s.close();
  }
});
