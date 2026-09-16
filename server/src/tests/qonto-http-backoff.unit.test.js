// Qonto HTTP back-off (specs/payment-polling-fair-use.md rules 6, 7, 8, 9): exponential retries on
// 429/5xx honouring Retry-After, the RATE_LIMITED abort of a poll pass, the idempotency key on link
// creation, and the env-configurable thresholds. No real waiting: `sleep` is injected.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { resolveRetryOptions, parseRetryAfterMs, retryDelayMs, RETRY_DEFAULTS } = require('../utils/httpRetry');
const { buildQontoClient } = require('../utils/qontoClient');
const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { runPaymentPoll } = require('../utils/paymentPollRunner');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Serves the scripted responses in order (the last one repeats) and records every request.
function scriptedFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const r = responses[Math.min(calls.length, responses.length - 1)];
    calls.push({ url, opts });
    const headers = new Map(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (name) => (headers.has(String(name).toLowerCase()) ? headers.get(String(name).toLowerCase()) : null) },
      text: async () => JSON.stringify(r.body || {}),
    };
  };
  return { fetchImpl, calls };
}

function clientWith(responses, { env = {} } = {}) {
  const { fetchImpl, calls } = scriptedFetch(responses);
  const delays = [];
  const client = buildQontoClient({ sandbox: true, clientId: 'cid', clientSecret: 'secret', env, fetchImpl, retry: { sleep: async (ms) => { delays.push(ms); } } });
  return { client, calls, delays };
}

const NO_PAYMENTS = { status: 200, body: { payments: [] } };

test('a 429 then a 200 succeeds after one back-off of the base delay', async () => {
  const { client, calls, delays } = clientWith([{ status: 429 }, NO_PAYMENTS]);
  const res = await client.getPaymentLinkPayments({ accessToken: 'at', id: 'pl_1' });
  assert.equal(res.paid, false);
  assert.equal(calls.length, 2);
  assert.deepEqual(delays, [1000]);
});

test('delays double between attempts and the budget counts the first request (3 requests at most)', async () => {
  const { client, calls, delays } = clientWith([{ status: 503 }]);
  await assert.rejects(
    () => client.getPaymentLink({ accessToken: 'at', id: 'pl_1' }),
    (err) => { assert.equal(err.status, 503); assert.notEqual(err.code, 'RATE_LIMITED'); return true; },
  );
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test('Retry-After wins when larger, is ignored when unparseable or negative, and every wait is capped at 60 s', () => {
  const nowMs = Date.parse('2026-09-15T12:00:00Z');
  const delay = (attempt, retryAfter) => retryDelayMs({ attempt, baseDelayMs: 1000, maxDelayMs: 60000, retryAfter, nowMs });
  assert.equal(delay(1, '5'), 5000, 'header larger than the computed delay');
  assert.equal(delay(2, '1'), 2000, 'computed delay larger than the header');
  assert.equal(delay(1, 'soon'), 1000, 'unparseable → computed');
  assert.equal(delay(1, '-3'), 1000, 'negative → computed');
  assert.equal(delay(1, '120'), 60000, 'header capped');
  assert.equal(delay(10, null), 60000, 'computed delay capped');

  assert.equal(parseRetryAfterMs(new Date(nowMs + 7000).toUTCString(), nowMs), 7000, 'HTTP-date form');
  assert.equal(parseRetryAfterMs(new Date(nowMs - 7000).toUTCString(), nowMs), null, 'a past date is negative → absent');
  assert.equal(parseRetryAfterMs('', nowMs), null);
});

test('the client honours a Retry-After header on a 429', async () => {
  const { client, delays } = clientWith([{ status: 429, headers: { 'Retry-After': '7' } }, NO_PAYMENTS]);
  await client.getPaymentLinkPayments({ accessToken: 'at', id: 'pl_1' });
  assert.deepEqual(delays, [7000]);
});

test('a 4xx other than 429 is not retried; a 5xx is', async () => {
  const bad = clientWith([{ status: 400, body: { errors: [{ code: 'invalid' }] } }, NO_PAYMENTS]);
  await assert.rejects(() => bad.client.getPaymentLinkPayments({ accessToken: 'at', id: 'pl_1' }), (err) => err.status === 400);
  assert.equal(bad.calls.length, 1);
  assert.deepEqual(bad.delays, []);

  const flaky = clientWith([{ status: 500 }, NO_PAYMENTS]);
  await flaky.client.getPaymentLinkPayments({ accessToken: 'at', id: 'pl_1' });
  assert.equal(flaky.calls.length, 2);
});

test('a 429 that survives the budget raises RATE_LIMITED', async () => {
  const { client, calls } = clientWith([{ status: 429 }]);
  await assert.rejects(
    () => client.getPaymentLinkPayments({ accessToken: 'at', id: 'pl_1' }),
    (err) => { assert.equal(err.code, 'RATE_LIMITED'); assert.equal(err.status, 429); return true; },
  );
  assert.equal(calls.length, 3);
});

test('rule 7: a surviving 429 stops the pass with stoppedBy rate-limit and leaves the remaining links unexamined', async () => {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  const devisId = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount, devisStatus)
                                     VALUES ('devis', 1, 1, '2026-10-10', '2026-10-12', 2, 300, 90, 210, 'draft')`).run().lastInsertRowid);
  const links = paymentLinksModel.buildModel(db);
  const first = links.create({ reservationId: devisId, type: 'deposit', amountCents: 9000, qontoPaymentLinkId: 'ql_first', url: 'u' });
  const second = links.create({ reservationId: devisId, type: 'full', amountCents: 30000, qontoPaymentLinkId: 'ql_second', url: 'u' });
  const { client, calls } = clientWith([{ status: 429 }]);

  const summary = await runPaymentPoll({
    database: db, paymentLinksModel: links, devisModel: devisModel.buildModel(db), qontoClient: client, getAccessToken: async () => 'at',
  });

  assert.equal(summary.stoppedBy, 'rate-limit');
  assert.equal(summary.checked, 1);
  assert.equal(summary.results.length, 1);
  assert.equal(summary.results[0].status, 'error');
  assert.ok(calls.every((c) => c.url.includes('ql_first')), 'the second link was never requested');
  assert.ok(links.findById(first.id).lastPolledAt, 'the examined link is stamped');
  assert.equal(links.findById(second.id).lastPolledAt, null, 'the unexamined link is not');
  assert.equal(links.findById(second.id).status, 'open');
});

test('rule 8: link creation sends one idempotency key, identical across its retries and different between two calls', async () => {
  const created = { status: 200, body: { payment_link: { id: 'pl_new', url: 'https://pay/pl_new', status: 'open' } } };
  const { client, calls } = clientWith([{ status: 503 }, created, created]);

  await client.createPaymentLink({ accessToken: 'at', title: 'Acompte', amountCents: 9000 });
  await client.createPaymentLink({ accessToken: 'at', title: 'Acompte', amountCents: 9000 });

  const keys = calls.map((c) => c.opts.headers['X-Qonto-Idempotency-Key']);
  assert.equal(keys.length, 3);
  assert.match(keys[0], UUID_V4);
  assert.equal(keys[1], keys[0], 'the retry replays the same key');
  assert.notEqual(keys[2], keys[0], 'a separate creation gets a new key');

  const reads = clientWith([NO_PAYMENTS]);
  await reads.client.getPaymentLinkPayments({ accessToken: 'at', id: 'pl_1' });
  assert.equal(reads.calls[0].opts.headers['X-Qonto-Idempotency-Key'], undefined, 'reads carry no key');
});

test('rule 9: env-configured thresholds override the defaults; invalid values fall back', async () => {
  assert.deepEqual(resolveRetryOptions({}), { ...RETRY_DEFAULTS });
  assert.deepEqual(
    resolveRetryOptions({ QONTO_RETRY_MAX_ATTEMPTS: '5', QONTO_RETRY_BASE_DELAY_MS: '250', QONTO_RETRY_MAX_DELAY_MS: '10000' }),
    { maxAttempts: 5, baseDelayMs: 250, maxDelayMs: 10000 },
  );
  assert.deepEqual(resolveRetryOptions({ QONTO_RETRY_MAX_ATTEMPTS: '0', QONTO_RETRY_BASE_DELAY_MS: 'abc', QONTO_RETRY_MAX_DELAY_MS: '-1' }), { ...RETRY_DEFAULTS });

  const single = clientWith([{ status: 503 }], { env: { QONTO_RETRY_MAX_ATTEMPTS: '1' } });
  await assert.rejects(() => single.client.getPaymentLink({ accessToken: 'at', id: 'pl_1' }));
  assert.equal(single.calls.length, 1, 'a budget of one request means no retry');

  const { resolvePollCadence, isPollDue, POLL_CADENCE_DEFAULTS } = paymentLinksModel;
  assert.deepEqual(resolvePollCadence({}), { ...POLL_CADENCE_DEFAULTS });
  const cadence = resolvePollCadence({ PAYMENT_POLL_FRESH_HOURS: '2', PAYMENT_POLL_WARM_DAYS: '1', PAYMENT_POLL_WARM_INTERVAL_MINUTES: '30', PAYMENT_POLL_COLD_INTERVAL_MINUTES: 'nope' });
  assert.deepEqual(cadence, { freshHours: 2, warmDays: 1, warmIntervalMinutes: 30, coldIntervalMinutes: POLL_CADENCE_DEFAULTS.coldIntervalMinutes });

  const nowMs = Date.parse('2026-09-15T12:00:00Z');
  const link = { createdAt: '2026-09-15 06:00:00', lastPolledAt: new Date(nowMs - 35 * 60 * 1000).toISOString() };
  assert.equal(isPollDue(link, nowMs, POLL_CADENCE_DEFAULTS), true, 'default: 6 h old is still fresh');
  assert.equal(isPollDue(link, nowMs, cadence), true, 'custom: warm, 35 min ≥ 30 min');
  assert.equal(isPollDue({ ...link, lastPolledAt: new Date(nowMs - 20 * 60 * 1000).toISOString() }, nowMs, cadence), false, 'custom: warm, 20 min < 30 min');
});
