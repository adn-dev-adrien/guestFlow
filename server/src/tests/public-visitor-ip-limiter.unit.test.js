// specs/terms-acceptance-record.md §3.6 — the public limiters count per website VISITOR (relayed by
// the WordPress proxy), not per caller: every call comes from the one WordPress host. The relayed
// address is honoured only once the API key is checked, and an unauthenticated call is refused before
// being counted. Real router + middleware over a real socket; leaf controllers stubbed.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('module');

const API_KEY = 'visitor-limiter-test-key';
process.env.PUBLIC_API_KEY = API_KEY;
process.env.PUBLIC_API_RATELIMIT_MAX = '1000';
process.env.BOOKING_REQUEST_RATELIMIT_MAX = '2';
process.env.BOOKING_REQUEST_RATELIMIT_WINDOW_MS = '60000';

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

let server;
let baseUrl;
const seen = [];

before(async () => {
  const router = withMocks({
    '../../controllers/public/publicBookingRequestController': {
      create: (req, res) => { seen.push(req.visitor); res.status(201).json({ data: { status: 'pending' } }); },
    },
  }, () => {
    for (const f of ['../routes/public/bookingRequests', '../routes/public', '../middleware/rateLimiters']) {
      try { delete require.cache[require.resolve(f)]; } catch { /* not cached */ }
    }
    return require('../routes/public');
  });
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/public/v1', router);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

function book({ visitorIp, key = API_KEY, ua } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  if (visitorIp) headers['x-guestflow-visitor-ip'] = visitorIp;
  if (ua) headers['x-guestflow-visitor-ua'] = ua;
  headers['x-guestflow-plugin'] = '1.8.0';
  return fetch(`${baseUrl}/public/v1/booking-requests`, { method: 'POST', headers, body: '{}' });
}

test('two visitors through the one proxy address get separate booking budgets', async () => {
  assert.equal((await book({ visitorIp: '203.0.113.1' })).status, 201);
  assert.equal((await book({ visitorIp: '203.0.113.1' })).status, 201);
  assert.equal((await book({ visitorIp: '203.0.113.1' })).status, 429, 'visitor A exhausted its own budget');
  assert.equal((await book({ visitorIp: '203.0.113.2' })).status, 201, 'visitor B is not affected');
});

test('the controller receives the relayed visitor (IP, browser, plugin version)', async () => {
  seen.length = 0;
  await book({ visitorIp: '2001:db8::7', ua: 'Mozilla/5.0 (iPhone)' });
  assert.deepEqual(seen[0], { ip: '2001:db8::7', userAgent: 'Mozilla/5.0 (iPhone)', pluginVersion: '1.8.0' });
});

test('a malformed relayed IP is dropped, not trusted', async () => {
  seen.length = 0;
  await book({ visitorIp: 'not-an-ip' });
  assert.equal(seen[0].ip, '');
});

test('without the API key → 401, and the call is not counted against the visitor', async () => {
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await book({ visitorIp: '203.0.113.9', key: 'wrong' })).status, 401);
  }
  assert.equal((await book({ visitorIp: '203.0.113.9' })).status, 201);
});
