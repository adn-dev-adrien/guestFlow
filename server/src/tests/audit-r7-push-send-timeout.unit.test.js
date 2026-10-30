// specs/pwa-push-notifications.md rule 14 (audit R7, finding N7) — every push send is bounded, so a push
// endpoint that accepts the connection and never answers cannot hold the caller (payment poll, Qonto
// webhook, Neat pass, the per-minute runners) past the bound.

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const crypto = require('node:crypto');
const webpush = require('web-push');

const { buildPushService, SEND_TIMEOUT_MS } = require('../utils/pushService');

const vapid = { isConfigured: () => true };
const quiet = { warn() {} };
const SUB_A = { endpoint: 'https://push.invalid/a', p256dh: 'pa', auth: 'aa' };
const SUB_B = { endpoint: 'https://push.invalid/b', p256dh: 'pb', auth: 'ab' };

function model(subs) {
  return { subscriptionsForPref: () => subs, listByUser: () => subs, removeByEndpoint() {} };
}

const PENDING = 'still pending';
function within(ms, promise) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(PENDING), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

function silentServer() {
  const sockets = new Set();
  const server = net.createServer((s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    close: () => { for (const s of sockets) s.destroy(); return new Promise((r) => server.close(r)); },
  })));
}

test('rule 14 — the default bound is 10 s and each send passes it to web-push as its socket timeout', async () => {
  assert.equal(SEND_TIMEOUT_MS, 10_000);
  const seen = [];
  const stub = { sendNotification: async (_s, _b, options) => { seen.push(options); } };
  const res = await buildPushService({ webpush: stub, model: model([SUB_A]), vapid, logger: quiet }).sendToPref('arrivals', { title: 'T' });
  assert.equal(res.sent, 1);
  assert.equal(seen[0] && seen[0].timeout, SEND_TIMEOUT_MS);
});

test('rule 14 — a send that never settles is counted failed at the bound, never awaited for good', async () => {
  const warned = [];
  const stub = { sendNotification: () => new Promise(() => {}) };
  const svc = buildPushService({ webpush: stub, model: model([SUB_A]), vapid, logger: { warn: (...a) => warned.push(a.join(' ')) }, sendTimeoutMs: 60 });
  const started = Date.now();
  const res = await within(1000, svc.sendToPref('newReservation', { title: 'T' }));
  assert.deepEqual(res, { sent: 0, pruned: 0, failed: 1 });
  assert.ok(Date.now() - started < 1000);
  assert.match(warned.join('\n'), /timeout/i);
});

test('rule 14 — one silent endpoint does not hold the others; sendToUser is bounded too', async () => {
  const stub = { sendNotification: (s) => (s.endpoint.endsWith('/a') ? new Promise(() => {}) : Promise.resolve()) };
  const svc = buildPushService({ webpush: stub, model: model([SUB_A, SUB_B]), vapid, logger: quiet, sendTimeoutMs: 60 });
  assert.deepEqual(await within(1000, svc.sendToPref('arrivals', { title: 'T' })), { sent: 1, pruned: 0, failed: 1 });
  assert.deepEqual(await within(1000, svc.sendToUser(7, { title: 'T' })), { sent: 1, pruned: 0, failed: 1 });
});

test('rule 14 — the real web-push against a local endpoint that accepts TCP and never answers resolves failed', async () => {
  const server = await silentServer();
  try {
    const keys = webpush.generateVAPIDKeys();
    webpush.setVapidDetails('mailto:probe@example.test', keys.publicKey, keys.privateKey);
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const sub = { endpoint: `https://127.0.0.1:${server.port}/push/x`, p256dh: ecdh.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
    const svc = buildPushService({ webpush, model: model([sub]), vapid, logger: quiet, sendTimeoutMs: 300 });
    const started = Date.now();
    const res = await within(3000, svc.sendToPref('newReservation', { title: 'T' }));
    assert.deepEqual(res, { sent: 0, pruned: 0, failed: 1 });
    assert.ok(Date.now() - started < 3000, `resolved after ${Date.now() - started} ms`);
  } finally {
    await server.close();
  }
});
