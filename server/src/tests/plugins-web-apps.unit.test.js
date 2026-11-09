// specs/plugins-phase-1-sdk.md rule 48 — `ctx.webApp`: a plugin serves a web app of its own, on its own host or under
// a path segment of its own, only while it is live; the core's trees (/api, /public, /uploads, /plugin-assets) stay the
// core's on every host, and a path that would shadow one is refused at registration.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const { mountWebApps } = require('../plugins/loader');

async function withApp(fn, { live = true } = {}) {
  registry.reset();
  registry.configure({ isActive: () => live, allows: () => true });
  const ctx = createContext('demo', {});
  const host = { value: 'app.example.test' };
  ctx.webApp({ key: 'guest', host: () => host.value, handler: (req, res) => res.send(`guest ${req.path}`) });
  ctx.webApp({ key: 'studio', path: '/studio', handler: (req, res) => res.send(`studio ${req.path}`) });
  const app = express();
  mountWebApps(app);
  app.use((req, res) => res.send(`core ${req.path}`));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  // fetch() may not set Host: a plain request does, as a browser on that host would.
  const get = (p, hostHeader = 'admin.example.test') => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: p, headers: { host: hostHeader } }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
  try {
    await fn({ get, host });
  } finally {
    await new Promise((resolve) => { server.close(resolve); });
    registry.reset();
  }
}

test('rule 47: on its own host the web app answers every path but the core\'s trees', () => withApp(async ({ get }) => {
  assert.equal(await get('/', 'app.example.test'), 'guest /');
  assert.equal(await get('/s/abc', 'APP.example.test:443'), 'guest /s/abc');
  for (const tree of ['/api/x', '/public/v1/guest/me', '/uploads/a.webp', '/plugin-assets/x/y']) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal(await get(tree, 'app.example.test'), `core ${tree}`, tree);
  }
  assert.equal(await get('/', 'admin.example.test'), 'core /', 'another host is the core\'s');
}));

test('rule 47: under its path, on any host; a host not set yet claims nothing', () => withApp(async ({ get, host }) => {
  assert.equal(await get('/studio'), 'studio /studio');
  assert.equal(await get('/studio/livret/3'), 'studio /studio/livret/3');
  assert.equal(await get('/studios'), 'core /studios');
  host.value = null;
  assert.equal(await get('/', 'app.example.test'), 'core /');
}));

test('rule 47: a plugin that is not live serves nothing — its paths fall through to the core', () => withApp(async ({ get }) => {
  assert.equal(await get('/studio'), 'core /studio');
  assert.equal(await get('/', 'app.example.test'), 'core /');
}, { live: false }));

test('rule 47: a web app needs a key, a handler and a path or a host; a path may not shadow a core tree', () => {
  registry.reset();
  const ctx = createContext('demo', {});
  const handler = () => {};
  assert.throws(() => ctx.webApp({ path: '/x', handler }), /needs a key/);
  assert.throws(() => ctx.webApp({ key: 'a', path: '/x' }), /needs a handler/);
  assert.throws(() => ctx.webApp({ key: 'a', handler }), /needs a path or a host/);
  ['/api', '/public', '/uploads', '/plugin-assets', '/login', '/assets', '/a/b', 'studio', '/Studio'].forEach((path) => {
    assert.throws(() => ctx.webApp({ key: 'a', path, handler }), /one segment of its own/, path);
  });
  assert.throws(() => ctx.webApp({ key: 'a', host: 'app.example.test', handler }), /host must be a function/);
  ctx.webApp({ key: 'ok', path: '/studio', handler });
  assert.equal(registry.get('demo').webApps.length, 1);
  registry.reset();
});
