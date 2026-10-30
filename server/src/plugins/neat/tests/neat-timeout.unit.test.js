/**
 * specs/neat-cancellation-insurance-subscription.md §3.2 rule 17 — Neat calls are bounded by one budget
 * per call, a client and its token are reused, and an outage opens a 60 s breaker (round-6 audit N6, D1). Uses a local HTTP server that accepts the
 * connection and never answers.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { buildNeatClient } = require('../client');
const { resolveInsurancePricing, createInsuranceProcessor, resetPriceBreaker, BREAKER_MS } = require('../pricing');
const { listenLocal } = require('../../../tests/listenLocal');

const FIELDS = [{ id: 'f-nights', title: 'Nuits', name: 'nights', type: 'number', required: true, options: [] }];
const settings = {
  neatConfig: () => ({
    environment: 'staging', clientId: 'id', clientSecret: 'secret', salesChannelId: 'ch-1', contractId: 'c-1',
    fieldMappingJson: JSON.stringify({ 'f-nights': { source: 'nights' } }),
    contractFieldsJson: JSON.stringify(FIELDS), marginPercent: 30,
  }),
};
const SNAPSHOT = { startDate: '2026-10-01', endDate: '2026-10-08', nights: 7, guests: 2, accommodationAmount: 700, totalAmount: 700 };
const silentLogger = { warn: () => {}, log: () => {}, error: () => {} };

function fakeCache(row = null) {
  return { getCachedPremium: () => row, storePremium() {} };
}

async function hangingServer() {
  const hits = { count: 0 };
  const sockets = new Set();
  const server = http.createServer(() => { hits.count += 1; });
  server.on('connection', (s) => sockets.add(s));
  const listening = await listenLocal(server);
  listening.hits = hits;
  listening.destroyAll = () => { sockets.forEach((s) => s.destroy()); };
  return listening;
}

async function withHang(fn) {
  const server = await hangingServer();
  resetPriceBreaker();
  try {
    await fn(server, `http://127.0.0.1:${server.address().port}`);
  } finally {
    server.destroyAll();
    await new Promise((r) => server.close(r));
  }
}

test('rule 17 — a Neat that never answers rejects within timeoutMs with a 504', async () => {
  await withHang(async (server, baseUrl) => {
    const client = buildNeatClient({ baseUrl, clientId: 'id', clientSecret: 'secret', timeoutMs: 150 });
    const t0 = Date.now();
    await assert.rejects(client.price('c-1', { serviceFieldValues: [] }), (err) => err.status === 504 && err.code === 'NEAT_TIMEOUT' && /timed out/.test(err.message));
    assert.ok(Date.now() - t0 < 1500, 'bounded');
  });
});

test('rule 17 — a body that stalls after the headers is bounded too', async () => {
  const server = await listenLocal(http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"tok');
  }));
  try {
    const client = buildNeatClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, clientId: 'id', clientSecret: 'secret', timeoutMs: 150 });
    await assert.rejects(client.testConnection(), (err) => err.code === 'NEAT_TIMEOUT');
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

test('rule 17 — the quote answers within the bound at the static fallback when Neat hangs', async () => {
  await withHang(async (server, baseUrl) => {
    const buildClient = (c) => buildNeatClient({ ...c, baseUrl, timeoutMs: 150 });
    const t0 = Date.now();
    const out = await resolveInsurancePricing({ settingsModel: settings, cacheModel: fakeCache(null), buildClient, logger: silentLogger }, SNAPSHOT);
    assert.equal(out, null, 'null = the static tariff applies');
    assert.ok(Date.now() - t0 < 1500);
    const stale = await resolveInsurancePricing({
      settingsModel: settings, cacheModel: fakeCache({ premium: 10, fetchedAt: '2020-01-01T00:00:00.000Z' }), buildClient, logger: silentLogger,
      now: () => new Date(Date.now() + BREAKER_MS * 2),
    }, SNAPSHOT);
    assert.equal(stale.source, 'stale-cache');
  });
});

test('rule 17 — the breaker skips Neat for 60 s after a failure, then retries', async () => {
  await withHang(async (server, baseUrl) => {
    const buildClient = (c) => buildNeatClient({ ...c, baseUrl, timeoutMs: 100 });
    let nowMs = Date.parse('2026-10-30T10:00:00Z');
    const deps = { settingsModel: settings, cacheModel: fakeCache(null), buildClient, logger: silentLogger, now: () => new Date(nowMs) };

    await resolveInsurancePricing(deps, SNAPSHOT);
    const afterFirst = server.hits.count;
    assert.ok(afterFirst >= 1);

    const t0 = Date.now();
    nowMs += 30 * 1000;
    assert.equal(await resolveInsurancePricing(deps, SNAPSHOT), null);
    assert.ok(Date.now() - t0 < 50, 'skipped without waiting');
    assert.equal(server.hits.count, afterFirst, 'no second call inside the window');

    nowMs += BREAKER_MS;
    await resolveInsurancePricing(deps, SNAPSHOT);
    assert.ok(server.hits.count > afterFirst, 'retried once the window elapsed');
  });
});

test('rule 17 — a success closes the breaker', async () => {
  resetPriceBreaker();
  let calls = 0;
  let fail = true;
  const buildClient = () => ({ price: async () => { calls += 1; if (fail) throw new Error('down'); return { amount: 10 }; } });
  let nowMs = Date.parse('2026-10-30T10:00:00Z');
  const deps = { settingsModel: settings, cacheModel: fakeCache(null), buildClient, logger: silentLogger, now: () => new Date(nowMs) };
  await resolveInsurancePricing(deps, SNAPSHOT);
  fail = false;
  nowMs += BREAKER_MS + 1;
  assert.equal((await resolveInsurancePricing(deps, SNAPSHOT)).source, 'live');
  await resolveInsurancePricing({ ...deps, cacheModel: fakeCache(null) }, SNAPSHOT);
  assert.equal(calls, 3, 'closed: the next quote calls Neat again');
});

test('rule 17 — the subscription pass records a timeout as an unavailable failure and moves on', async () => {
  await withHang(async (server, baseUrl) => {
    const { runNeatSubscriptionPass } = require('../subscriptionRunner');
    const { buildModel } = require('../subscriptionsModel');
    const { freshNeatDb, fakeNeatSettings, insertReservation, fakePushService } = require('./neatFixtures');
    const db = freshNeatDb();
    const model = buildModel(db);
    const id = insertReservation(db);
    const summary = await runNeatSubscriptionPass({
      db, settingsModel: fakeNeatSettings(), model, pushService: fakePushService(), logger: silentLogger,
      now: () => new Date('2027-06-01T10:00:00Z'),
      buildClient: (c) => buildNeatClient({ ...c, baseUrl, timeoutMs: 150 }),
    }, 'test');
    assert.equal(summary.failed, 1);
    const job = model.getByReservationId(id, 'staging');
    assert.equal(job.status, 'failed');
    assert.equal(job.errorKind, 'unavailable');
    assert.match(job.lastError, /timed out/);
    db.close();
  });
});

// ---- one budget per call (review D1) ----

// Fake Neat: `auth` and `price` answer after their delay; `price` can answer 401 on its first hit.
async function slowNeat({ authMs = 0, priceMs = 0, firstPrice401 = false, priceStatus = 200, priceBody = { amount: 10 } } = {}) {
  const hits = { auth: 0, price: 0 };
  const server = await listenLocal(http.createServer((req, res) => {
    req.resume();
    const isAuth = req.url.endsWith('/auth');
    if (isAuth) hits.auth += 1; else hits.price += 1;
    const delay = isAuth ? authMs : priceMs;
    setTimeout(() => {
      res.setHeader('content-type', 'application/json');
      if (isAuth) { res.end(JSON.stringify({ token: `t${hits.auth}`, serviceAccount: { id: 'sa' } })); return; }
      if (firstPrice401 && hits.price === 1) { res.statusCode = 401; res.end('{}'); return; }
      res.statusCode = priceStatus;
      res.end(JSON.stringify(priceBody));
    }, delay);
  }));
  server.hits = hits;
  server.baseUrl = `http://127.0.0.1:${server.address().port}`;
  server.stop = () => new Promise((r) => { server.closeAllConnections(); server.close(r); });
  return server;
}

const cfg = { clientId: 'id', clientSecret: 'secret' };

test('rule 17 — auth and price share one budget: two slow exchanges stay within timeoutMs, at the fallback', async () => {
  resetPriceBreaker();
  const server = await slowNeat({ authMs: 300, priceMs: 300 });
  try {
    const buildClient = (c) => buildNeatClient({ ...c, baseUrl: server.baseUrl, timeoutMs: 400 });
    const t0 = Date.now();
    const out = await resolveInsurancePricing({ settingsModel: settings, cacheModel: fakeCache(null), buildClient, logger: silentLogger }, SNAPSHOT);
    assert.equal(out, null, 'the static tariff applies');
    assert.ok(Date.now() - t0 < 550, `answered within the single budget (${Date.now() - t0} ms)`);
  } finally { await server.stop(); }
});

test('rule 17 — the 401 re-auth and retry stay inside the same budget', async () => {
  const server = await slowNeat({ authMs: 100, priceMs: 100, firstPrice401: true });
  try {
    const client = buildNeatClient({ ...cfg, baseUrl: server.baseUrl, timeoutMs: 250 });
    const t0 = Date.now();
    await assert.rejects(client.price('c-1', { serviceFieldValues: [] }), (err) => err.code === 'NEAT_TIMEOUT');
    assert.ok(Date.now() - t0 < 400, `auth + 401 + re-auth + retry capped at the budget (${Date.now() - t0} ms)`);
    assert.equal(server.hits.auth, 2, 'it did try the re-auth');
  } finally { await server.stop(); }
});

test('rule 17 — a 401 retry that fits the budget still succeeds', async () => {
  const server = await slowNeat({ firstPrice401: true });
  try {
    const client = buildNeatClient({ ...cfg, baseUrl: server.baseUrl, timeoutMs: 1000 });
    assert.deepEqual(await client.price('c-1', { serviceFieldValues: [] }), { amount: 10 });
    assert.equal(server.hits.auth, 2);
  } finally { await server.stop(); }
});

test('rule 17 — the processor reuses one client and its token: a normal quote is a single exchange', async () => {
  resetPriceBreaker();
  const server = await slowNeat();
  try {
    const processor = createInsuranceProcessor({
      settings, cacheModel: () => fakeCache(null), logger: silentLogger,
      buildClient: (c) => buildNeatClient({ ...c, baseUrl: server.baseUrl, timeoutMs: 1000 }),
    });
    assert.equal((await processor.priceLive(SNAPSHOT)).cancellationInsurancePrice, 13);
    assert.equal((await processor.priceLive({ ...SNAPSHOT, nights: 3 })).cancellationInsurancePrice, 13);
    assert.deepEqual(server.hits, { auth: 1, price: 2 });
  } finally { await server.stop(); }
});

test('rule 17 — a token older than the client\'s max age is renewed', async () => {
  const { TOKEN_MAX_AGE_MS } = require('../client');
  const server = await slowNeat();
  const realNow = Date.now;
  try {
    const client = buildNeatClient({ ...cfg, baseUrl: server.baseUrl, timeoutMs: 1000 });
    await client.price('c-1', { serviceFieldValues: [] });
    Date.now = () => realNow() + TOKEN_MAX_AGE_MS + 1000;
    await client.price('c-1', { serviceFieldValues: [] });
    assert.equal(server.hits.auth, 2);
  } finally { Date.now = realNow; await server.stop(); }
});

// ---- what opens the breaker (review) ----

async function secondQuoteSkipped(server, nowStep = 1000) {
  resetPriceBreaker();
  let nowMs = Date.parse('2026-10-30T10:00:00Z');
  const deps = {
    settingsModel: settings, cacheModel: fakeCache(null), logger: silentLogger, now: () => new Date(nowMs),
    buildClient: (c) => buildNeatClient({ ...c, baseUrl: server.baseUrl, timeoutMs: 500 }),
  };
  await resolveInsurancePricing(deps, SNAPSHOT);
  const afterFirst = server.hits.price;
  nowMs += nowStep;
  await resolveInsurancePricing(deps, { ...SNAPSHOT, nights: 3 });
  return server.hits.price === afterFirst;
}

test('rule 17 — a 4xx refusal does not open the breaker', async () => {
  const server = await slowNeat({ priceStatus: 400, priceBody: { message: [{ field: 'nights', errors: ['bad'] }] } });
  try { assert.equal(await secondQuoteSkipped(server), false, 'the next stay still calls Neat'); } finally { await server.stop(); }
});

test('rule 17 — a non-amount answer does not open the breaker', async () => {
  const server = await slowNeat({ priceBody: { amount: 'abc' } });
  try { assert.equal(await secondQuoteSkipped(server), false); } finally { await server.stop(); }
});

test('rule 17 — a 5xx opens the breaker', async () => {
  const server = await slowNeat({ priceStatus: 503 });
  try { assert.equal(await secondQuoteSkipped(server), true); } finally { await server.stop(); }
});

test('rule 17 — a 429 rate limit opens the breaker', async () => {
  const server = await slowNeat({ priceStatus: 429 });
  try { assert.equal(await secondQuoteSkipped(server), true); } finally { await server.stop(); }
});

test('rule 17 — a network error opens the breaker', async () => {
  const closed = await listenLocal(http.createServer());
  const baseUrl = `http://127.0.0.1:${closed.address().port}`;
  await new Promise((r) => closed.close(r));
  resetPriceBreaker();
  let calls = 0;
  const deps = {
    settingsModel: settings, cacheModel: fakeCache(null), logger: silentLogger,
    buildClient: (c) => { calls += 1; return buildNeatClient({ ...c, baseUrl, timeoutMs: 500 }); },
  };
  await resolveInsurancePricing(deps, SNAPSHOT);
  await resolveInsurancePricing(deps, { ...SNAPSHOT, nights: 3 });
  assert.equal(calls, 1, 'the second quote never reached the client');
});
