// specs/control-plane-plans-and-access.md rules 24, 25 and 27 over HTTP on the `app` host: a form
// with no password field, the 303 with its hint, the list, the remembered space, the 429 after ten
// lookups, and the console and the login page each absent from the other's host.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const session = require('express-session');
const { createApp } = require('../app');
const { makeContext, makeInstance, NEW_CUSTOMER } = require('./helpers');

const APP = 'app.guestflow.test';

async function start() {
  const h = makeContext({ at: '2026-10-01T08:00:00Z' });
  makeInstance(h.root, 'aulnes', { users: [{ email: 'gerant@aulnes.fr' }, { email: 'compta@lamy.fr' }] });
  makeInstance(h.root, 'moulin', { users: [{ email: 'compta@lamy.fr' }] });
  await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
  const moulin = await h.ctx.controllers.customers.create({ ...NEW_CUSTOMER, slug: 'moulin', companyName: 'Le Moulin', contactEmail: 'jo@moulin.fr' }, 'op');
  h.ctx.controllers.login.readDirectory();
  const app = createApp(h.ctx, { sessionSecret: 'test', sessionStore: new session.MemoryStore(), appHost: APP });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;
  function call(method, url, { host = APP, form, cookie } = {}) {
    const body = form ? new URLSearchParams(form).toString() : undefined;
    return new Promise((resolve, reject) => {
      const req = http.request({ port, method, path: url, headers: {
        host, ...(body ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } : {}), ...(cookie ? { cookie } : {}),
      } }, (res) => {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, cookie: res.headers['set-cookie'], headers: res.headers, text }));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
  return { ...h, moulin, call, close: () => new Promise((r) => server.close(r)) };
}

test('rules 24, 25 — the form has no password field; one space is a 303 with the hint and the cookie', async () => {
  const s = await start();
  try {
    const page = await s.call('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.text, /name="email"/);
    assert.doesNotMatch(page.text, /type="password"|<script/i);
    const csp = page.headers['content-security-policy'];
    assert.match(csp, /form-action 'self' https:\/\/\*\.guestflow\.test/, 'the redirect to the space is allowed');
    assert.match(csp, /default-src 'none'/);
    const res = await s.call('POST', '/lookup', { form: { email: ' Gerant@Aulnes.fr', password: 'ignored', role: 'admin' } });
    assert.equal(res.status, 303);
    assert.equal(res.location, 'https://aulnes.guestflow.test/login?login_hint=gerant%40aulnes.fr');
    assert.match(res.cookie[0], /^gf_space=aulnes; Max-Age=7776000; .*HttpOnly; SameSite=Lax/);
    assert.doesNotMatch(res.cookie[0], /Domain=/i, 'host-only');
  } finally {
    await s.close();
  }
});

test('rule 24 — several spaces are a list; none is the neutral sentence; the remembered space is offered', async () => {
  const s = await start();
  try {
    const list = await s.call('POST', '/lookup', { form: { email: 'compta@lamy.fr' } });
    assert.match(list.text, /Cette adresse a accès à 2 espaces/);
    assert.ok(list.text.indexOf('Gîte des Aulnes') < list.text.indexOf('Le Moulin'));
    const chosen = await s.call('POST', '/go', { form: { slug: 'moulin', email: 'compta@lamy.fr' } });
    assert.equal(chosen.location, 'https://moulin.guestflow.test/login?login_hint=compta%40lamy.fr');

    const none = await s.call('POST', '/lookup', { form: { email: 'personne@nulle.part' } });
    assert.match(none.text, /Aucun espace GuestFlow n’est associé à cette adresse/);

    const back = await s.call('GET', '/', { cookie: 'gf_space=moulin' });
    assert.match(back.text, /Continuer vers Le Moulin/);
    assert.match(back.text, /Utiliser une autre adresse/);
    const forget = await s.call('POST', '/forget', { cookie: 'gf_space=moulin' });
    assert.match(forget.cookie[0], /^gf_space=;/);

    s.ctx.controllers.customers.rename(s.moulin.id, { slug: 'moulin-neuf', checked: s.ctx.controllers.customers.RENAME_CHECKLIST.map((i) => i.key) }, 'op');
    const stale = await s.call('GET', '/', { cookie: 'gf_space=moulin' });
    assert.match(stale.text, /name="email"/, 'a space renamed since is forgotten silently');
    assert.match(stale.cookie[0], /^gf_space=;/);
  } finally {
    await s.close();
  }
});

test('rule 27 — the eleventh lookup in a minute answers 429 with the page itself', async () => {
  const s = await start();
  try {
    for (let i = 0; i < 10; i += 1) assert.equal((await s.call('POST', '/lookup', { form: { email: 'x@y.fr' } })).status, 200);
    const refused = await s.call('POST', '/lookup', { form: { email: 'gerant@aulnes.fr' } });
    assert.equal(refused.status, 429);
    assert.match(refused.text, /Trop de recherches depuis votre connexion\. Réessayez dans une minute\./);
  } finally {
    await s.close();
  }
});

test('rule 24 — the console answers nothing on the app host, and the login page nothing on the console host', async () => {
  const s = await start();
  try {
    assert.equal((await s.call('GET', '/api/customers')).status, 404);
    assert.equal((await s.call('POST', '/api/auth/login')).status, 404);
    assert.equal((await s.call('POST', '/lookup', { host: 'console.guestflow.test', form: { email: 'gerant@aulnes.fr' } })).status, 404);
  } finally {
    await s.close();
  }
});

test('rule 27 — the remembered-space page counts against the same limit as the lookups', async () => {
  const s = await start();
  try {
    const cookie = 'gf_space=moulin';
    for (let i = 0; i < 10; i += 1) assert.equal((await s.call('GET', '/', { cookie: `gf_space=slug-${i}` })).status, 200);
    assert.equal((await s.call('GET', '/', { cookie })).status, 429, 'cannot walk the slugs to read company names');
    assert.equal((await s.call('GET', '/')).status, 200, 'without a cookie the empty form is always served');
  } finally {
    await s.close();
  }
});
