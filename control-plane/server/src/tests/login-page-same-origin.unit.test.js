// specs/control-plane-plans-and-access.md rule 36 on the `app` host: the login page's pages carry
// `Referrer-Policy: same-origin`, so a browser posts its forms with their real `Origin` and they pass
// the same-origin gate; `Origin: null` (what `no-referrer` makes a browser send) and another host are
// refused.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const session = require('express-session');
const { createApp } = require('../app');
const { makeContext, makeInstance, NEW_CUSTOMER } = require('./helpers');
const { listenLocal, closeServer, REQUEST_TIMEOUT_MS } = require('./listenLocal');

const APP = 'app.guestflow.test';

async function start() {
  const h = makeContext({ at: '2026-10-01T08:00:00Z' });
  makeInstance(h.root, 'aulnes', { users: [{ email: 'gerant@aulnes.fr' }] });
  await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
  h.ctx.controllers.login.readDirectory();
  const app = createApp(h.ctx, { sessionSecret: 'test', sessionStore: new session.MemoryStore(), appHost: APP });
  const server = await listenLocal(app);
  const port = server.address().port;
  function call(method, url, { form, origin } = {}) {
    const body = form ? new URLSearchParams(form).toString() : '';
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, timeout: REQUEST_TIMEOUT_MS, method, path: url, headers: {
        host: APP, 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body),
        ...(origin ? { origin } : {}),
      } }, (res) => {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, headers: res.headers, text }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  return { call, close: () => closeServer(server) };
}

test('rule 36 — the login page sends Referrer-Policy: same-origin, on every answer', async () => {
  const s = await start();
  try {
    const page = await s.call('GET', '/');
    assert.equal(page.status, 200);
    assert.equal(page.headers['referrer-policy'], 'same-origin');
    const none = await s.call('POST', '/lookup', { form: { email: 'personne@nulle.part' }, origin: `http://${APP}` });
    assert.equal(none.status, 200);
    assert.equal(none.headers['referrer-policy'], 'same-origin', 'the page a form answers with posts again');
  } finally {
    await s.close();
  }
});

test('rule 36 — the three forms posted with the page\'s own Origin pass the gate', async () => {
  const s = await start();
  try {
    const origin = `http://${APP}`;
    const lookup = await s.call('POST', '/lookup', { form: { email: 'gerant@aulnes.fr' }, origin });
    assert.equal(lookup.status, 303);
    assert.equal(lookup.location, 'https://aulnes.guestflow.test/login?login_hint=gerant%40aulnes.fr');
    assert.equal((await s.call('POST', '/go', { form: { slug: 'aulnes', email: 'gerant@aulnes.fr' }, origin })).status, 303);
    const forget = await s.call('POST', '/forget', { origin });
    assert.equal(forget.status, 303);
    assert.equal(forget.location, '/');
  } finally {
    await s.close();
  }
});

test('rule 36 — Origin: null and another host stay refused on the login page', async () => {
  const s = await start();
  try {
    for (const origin of ['null', 'https://acme.guestflow.test', 'https://evil.example']) {
      const res = await s.call('POST', '/lookup', { form: { email: 'gerant@aulnes.fr' }, origin });
      assert.equal(res.status, 403, origin);
      assert.match(res.text, /CROSS_ORIGIN/);
    }
  } finally {
    await s.close();
  }
});
