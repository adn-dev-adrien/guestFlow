const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('module');

/**
 * HTTP integration tests for the PUBLIC API (specs/public-api.md §7).
 *
 * Unit tests already cover the key-auth LOGIC, the controller FLOWS, the projections and the
 * validators in isolation. What they cannot prove is the WIRING of the real router stack:
 *   - is every public route actually mounted behind the API key middleware (no hole)?
 *   - do the rate limiters really emit 429 over HTTP (the one item the spec left unverified)?
 *   - is the uniform error envelope what the wire actually returns?
 *
 * So here we mount the REAL `/public/v1` router with the REAL middleware (requirePublicApiKey +
 * the rate limiters) and drive it over a real TCP socket. Only the leaf CONTROLLERS are stubbed —
 * we are testing the pipe, not the handlers. `trust proxy` + a unique X-Forwarded-For per test
 * gives each test its own rate-limit bucket so they don't bleed into each other.
 *
 * Env is set BEFORE requiring the app code because the limiters read their thresholds at module
 * load time. The key is read per-request, so it only needs to be set before the first request.
 */

const API_KEY = 'integration-test-public-key';
process.env.PUBLIC_API_KEY = API_KEY;
process.env.PUBLIC_API_RATELIMIT_MAX = '5';
process.env.PUBLIC_API_RATELIMIT_WINDOW_MS = '60000';
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

// Leaf controller stubs: a public GET answers 200, the quote 200, the booking request 201. The
// pipe (auth + limiters + routing) is the unit under test, not these.
const catalogStub = {
  listProperties: (req, res) => res.json({ data: [] }),
  getProperty: (req, res) => res.json({ data: { id: Number(req.params.id) } }),
  listOptions: (req, res) => res.json({ data: [] }),
  listResources: (req, res) => res.json({ data: [] }),
  getAvailability: (req, res) => res.json({ data: { blockedDates: [] } }),
};
const quoteStub = { quote: (req, res) => res.json({ data: { finalPrice: 0 } }) };
const bookingStub = { create: (req, res) => res.status(201).json({ data: { status: 'pending' } }) };

function buildPublicRouter() {
  const routeFiles = [
    '../controllers/public/publicCatalogController',
    '../controllers/public/publicQuoteController',
    '../controllers/public/publicBookingRequestController',
    '../routes/public/properties',
    '../routes/public/quote',
    '../routes/public/bookingRequests',
    '../routes/public',
  ];
  return withMocks({
    '../../controllers/public/publicCatalogController': catalogStub,
    '../../controllers/public/publicQuoteController': quoteStub,
    '../../controllers/public/publicBookingRequestController': bookingStub,
  }, () => {
    for (const f of routeFiles) {
      try { delete require.cache[require.resolve(f)]; } catch { /* not cached yet */ }
    }
    return require('../routes/public');
  });
}

let server;
let baseUrl;

before(async () => {
  const express = require('express');
  const app = express();
  // trust the first proxy hop so a per-test X-Forwarded-For drives req.ip → isolated limiter
  // buckets. A numeric value (not `true`) keeps express-rate-limit's trust-proxy check happy.
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/public/v1', buildPublicRouter());

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

function call(method, path, { ip, key, keyHeader = 'authorization', body } = {}) {
  const headers = { 'x-forwarded-for': ip || '10.9.9.9' };
  if (key) headers[keyHeader] = keyHeader === 'authorization' ? `Bearer ${key}` : key;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const READ_ROUTES = [
  ['GET', '/public/v1/properties'],
  ['GET', '/public/v1/properties/1'],
  ['GET', '/public/v1/properties/1/options'],
  ['GET', '/public/v1/properties/1/resources'],
  ['GET', '/public/v1/properties/1/availability'],
];
const WRITE_ROUTES = [
  ['POST', '/public/v1/quote'],
  ['POST', '/public/v1/booking-requests'],
];

test('every public route is fail-closed: no key → 401 + uniform envelope (one IP per route so the read limiter never interferes)', async () => {
  const all = [...READ_ROUTES, ...WRITE_ROUTES];
  for (let i = 0; i < all.length; i += 1) {
    const [method, path] = all[i];
    const res = await call(method, path, { ip: `10.1.0.${i + 1}`, body: method === 'POST' ? {} : undefined });
    assert.equal(res.status, 401, `${method} ${path} must require the key`);
    const json = await res.json();
    assert.equal(json.error.code, 'UNAUTHENTICATED', `${method} ${path} envelope`);
    assert.ok(typeof json.error.message === 'string' && json.error.message.length > 0);
  }
});

test('a wrong key is rejected (401), Bearer and X-API-Key both authenticate', async () => {
  const wrong = await call('GET', '/public/v1/properties', { ip: '10.2.0.1', key: 'nope' });
  assert.equal(wrong.status, 401);

  const bearer = await call('GET', '/public/v1/properties', { ip: '10.2.0.2', key: API_KEY });
  assert.equal(bearer.status, 200);

  const apiKeyHeader = await call('GET', '/public/v1/properties', { ip: '10.2.0.3', key: API_KEY, keyHeader: 'x-api-key' });
  assert.equal(apiKeyHeader.status, 200);
});

test('publicApiLimiter emits 429 once the per-IP window is exceeded (max=5)', async () => {
  const ip = '10.3.0.1';
  const statuses = [];
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await call('GET', '/public/v1/properties', { ip, key: API_KEY });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200], 'first 5 pass');
  assert.equal(statuses[5], 429, '6th request over the limit is throttled');
});

test('bookingRequestLimiter is stricter than the read limiter (max=2 → 3rd booking is 429)', async () => {
  const ip = '10.4.0.1';
  const r1 = await call('POST', '/public/v1/booking-requests', { ip, key: API_KEY, body: {} });
  const r2 = await call('POST', '/public/v1/booking-requests', { ip, key: API_KEY, body: {} });
  const r3 = await call('POST', '/public/v1/booking-requests', { ip, key: API_KEY, body: {} });
  assert.equal(r1.status, 201, '1st booking accepted');
  assert.equal(r2.status, 201, '2nd booking accepted');
  assert.equal(r3.status, 429, '3rd booking throttled by the dedicated anti-spam limiter');
});

test('the booking limiter does NOT throttle plain reads on the same IP', async () => {
  // Reads on this IP must stay governed only by the (generous) public limiter, never by the
  // stricter booking limiter. 3 reads < public max 5 → all pass even though booking max is 2.
  const ip = '10.5.0.1';
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await call('GET', '/public/v1/properties', { ip, key: API_KEY });
    assert.equal(res.status, 200, 'reads are not subject to the booking limiter');
  }
});
