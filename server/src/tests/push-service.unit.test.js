const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPushService } = require('../utils/pushService');

// specs/pwa-push-notifications.md §3.3 + §3.4 — fan-out, pruning, and total isolation (never throws).

function stubVapid(configured = true) { return { isConfigured: () => configured, getPublicKey: () => 'pub' }; }

function stubModel(subs) {
  const pruned = [];
  return {
    subscriptionsForPref: () => subs,
    removeByEndpoint: (e) => pruned.push(e),
    _pruned: pruned,
  };
}

const SUBS = [
  { endpoint: 'https://push/a', p256dh: 'pa', auth: 'aa' },
  { endpoint: 'https://push/b', p256dh: 'pb', auth: 'ab' },
];

test('sendToPref sends one notification per subscription', async () => {
  const sent = [];
  const webpush = { sendNotification: async (s, body) => { sent.push({ endpoint: s.endpoint, body }); } };
  const svc = buildPushService({ webpush, model: stubModel(SUBS), vapid: stubVapid(), logger: { warn() {} } });
  const res = await svc.sendToPref('arrivals', { title: 'T', body: 'B' });
  assert.equal(res.sent, 2);
  assert.equal(sent.length, 2);
  assert.equal(JSON.parse(sent[0].body).title, 'T');
});

test('a 410/404 endpoint is pruned; the others still send', async () => {
  const model = stubModel(SUBS);
  const webpush = {
    sendNotification: async (s) => { if (s.endpoint.endsWith('/a')) { const e = new Error('gone'); e.statusCode = 410; throw e; } },
  };
  const svc = buildPushService({ webpush, model, vapid: stubVapid(), logger: { warn() {} } });
  const res = await svc.sendToPref('arrivals', { title: 'T' });
  assert.equal(res.sent, 1);
  assert.equal(res.pruned, 1);
  assert.deepEqual(model._pruned, ['https://push/a']);
});

test('a transient send error does NOT prune and never throws', async () => {
  const model = stubModel(SUBS);
  const webpush = { sendNotification: async () => { const e = new Error('500'); e.statusCode = 500; throw e; } };
  const svc = buildPushService({ webpush, model, vapid: stubVapid(), logger: { warn() {} } });
  const res = await svc.sendToPref('arrivals', { title: 'T' });
  assert.equal(res.sent, 0);
  assert.equal(res.pruned, 0);
  assert.deepEqual(model._pruned, [], 'transient error keeps the subscription');
});

test('no VAPID → skipped, no model access, no throw', async () => {
  let touched = false;
  const model = { subscriptionsForPref: () => { touched = true; return SUBS; }, removeByEndpoint() {} };
  const svc = buildPushService({ webpush: {}, model, vapid: stubVapid(false), logger: { warn() {} } });
  const res = await svc.sendToPref('arrivals', { title: 'T' });
  assert.equal(res.skipped, 'no_vapid');
  assert.equal(touched, false);
});

test('sendToPref never rejects even if the model itself throws', async () => {
  const model = { subscriptionsForPref: () => { throw new Error('db down'); }, removeByEndpoint() {} };
  const svc = buildPushService({ webpush: {}, model, vapid: stubVapid(), logger: { warn() {} } });
  const res = await svc.sendToPref('arrivals', { title: 'T' });
  assert.equal(res.error, true);
  assert.equal(res.sent, 0);
});
