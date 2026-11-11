// specs/pwa-push-notifications.md rule 15, reading of 2026-11-05 (audit R23, E23-7) — a name is judged where it is
// dialled: a stored endpoint whose name answers a private address opens no connection, with the real web-push. The name
// is forced to a loopback listener through the resolver; the iCal dev switch does not apply.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const dns = require('node:dns');
const https = require('node:https');
const net = require('node:net');
const webpush = require('web-push');

const { buildPushService, pushAgent } = require('../utils/pushService');

const vapid = { isConfigured: () => true };
const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const keys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
const generated = webpush.generateVAPIDKeys();
webpush.setVapidDetails('mailto:test@example.test', generated.publicKey, generated.privateKey);

async function listener(t) {
  const hits = { tcp: 0 };
  const server = net.createServer((socket) => { hits.tcp += 1; socket.destroy(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((done) => server.close(done)));
  return { hits, port: server.address().port };
}

function answering(t, address) {
  const real = dns.lookup;
  dns.lookup = (host, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    if (host !== 'internal.example') return real(host, options, callback);
    return options && options.all ? done(null, [{ address, family: 4 }]) : done(null, address, 4);
  };
  t.after(() => { dns.lookup = real; });
}

function serviceOver(endpoint) {
  const removed = [];
  const warned = [];
  const model = { subscriptionsForPref: () => [{ endpoint, ...keys }], listByUser: () => [], removeByEndpoint: (e) => removed.push(e) };
  const service = buildPushService({ model, vapid, logger: { warn: (...a) => warned.push(a.join(' ')) } });
  return { service, removed, warned };
}

for (const address of ['127.0.0.1', '10.1.2.3', '198.18.0.1']) {
  test(`rule 15: a name answering ${address} opens no connection, counts failed, and the row stays`, async (t) => {
    const { hits, port } = await listener(t);
    answering(t, address);
    const { service, removed, warned } = serviceOver(`https://internal.example:${port}/x`);
    const outcome = await service.sendToPref('arrivals', { title: 'T' });
    assert.deepEqual(outcome, { sent: 0, pruned: 0, failed: 1 });
    assert.equal(hits.tcp, 0);
    assert.deepEqual(removed, []);
    assert.equal(warned.length, 1);
  });
}

test('rule 15: the iCal dev switch does not open the push door', async (t) => {
  const { hits, port } = await listener(t);
  answering(t, '127.0.0.1');
  process.env.GUESTFLOW_ICAL_ALLOW_PRIVATE = '1';
  t.after(() => { delete process.env.GUESTFLOW_ICAL_ALLOW_PRIVATE; });
  const { service } = serviceOver(`https://internal.example:${port}/x`);
  const outcome = await service.sendToPref('arrivals', { title: 'T' });
  assert.equal(outcome.failed, 1);
  assert.equal(hits.tcp, 0);
});

test('rule 15: web-push accepts the agent, and each send carries it beside its bound', async () => {
  assert.ok(pushAgent instanceof https.Agent);
  const seen = [];
  const stub = { sendNotification: async (_s, _b, options) => { seen.push(options); } };
  const model = { subscriptionsForPref: () => [{ endpoint: 'https://push.invalid/a', p256dh: 'p', auth: 'a' }] };
  await buildPushService({ webpush: stub, model, vapid, logger: { warn() {} } }).sendToPref('arrivals', {});
  assert.equal(seen[0].agent, pushAgent);
  assert.equal(seen[0].timeout, 10_000);
});

test('rule 15: a public answer passes the lookup', async () => {
  const lookup = pushAgent.options.lookup;
  const real = dns.lookup;
  dns.lookup = (host, options, callback) => callback(null, [{ address: '8.8.8.8', family: 4 }]);
  try {
    const answer = await new Promise((resolve, reject) => {
      lookup('push.example', { all: true }, (error, list) => (error ? reject(error) : resolve(list)));
    });
    assert.deepEqual(answer, [{ address: '8.8.8.8', family: 4 }]);
  } finally {
    dns.lookup = real;
  }
});
