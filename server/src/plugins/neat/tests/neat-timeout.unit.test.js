/**
 * specs/neat-cancellation-insurance-subscription.md §3.2 rule 17 — Neat calls are bounded and a failed
 * live price opens a 60 s breaker (round-6 audit N6). Uses a local HTTP server that accepts the
 * connection and never answers.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { buildNeatClient } = require('../client');
const { resolveInsurancePricing, resetPriceBreaker, BREAKER_MS } = require('../pricing');
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
