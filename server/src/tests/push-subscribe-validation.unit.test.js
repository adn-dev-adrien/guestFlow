// specs/pwa-push-notifications.md rule 15 (audit R22, E22-5) — the subscription is judged when it arrives: strings of a
// bounded length, an https endpoint on the default port, no private literal nor localhost, p256dh 65 bytes and auth
// 16 bytes in base64url. No allow-list of push hosts, it would break a new browser. A stored row is never re-judged.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const net = require('net');
const nodeUrl = require('url');
const Database = require('better-sqlite3');
const webpush = require('web-push');

const { create } = require('../models/pushSubscriptionsModel');
const { buildPushService } = require('../utils/pushService');

function fresh() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, endpoint TEXT UNIQUE, p256dh TEXT, auth TEXT);
    CREATE TABLE user_push_prefs (userId INTEGER PRIMARY KEY, newReservation INT, arrivals INT, departures INT, breakfast INT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, isActive INT, isSupportAccount INT);
    CREATE TABLE user_roles (userId INT, role TEXT);
    INSERT INTO users VALUES (1,1,0); INSERT INTO user_roles VALUES (1,'admin');`);
  return { db, model: create(db), rows: () => db.prepare('SELECT endpoint FROM push_subscriptions').all().map((r) => r.endpoint) };
}

const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const P256DH = ecdh.getPublicKey().toString('base64url');
const AUTH = crypto.randomBytes(16).toString('base64url');
const keys = { p256dh: P256DH, auth: AUTH };

test('rule 15 — what real browsers send is accepted', () => {
  const { model, rows } = fresh();
  const endpoints = [
    'https://fcm.googleapis.com/fcm/send/abc:APA91bExample_-123',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABexample',
    'https://web.push.apple.com/QAbcDEF_ghi-123',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB%2Bexample',
    'https://push.new-browser.example/any/path:443?x=1',
    'https://fcm.googleapis.com:443/fcm/send/default-port',
    'https://8.8.8.8/public-literal',
  ];
  endpoints.forEach((endpoint) => assert.deepEqual(model.subscribe(1, { endpoint, keys }), { ok: true }, endpoint));
  assert.deepEqual(rows().sort(), [...endpoints].sort(), 'stored exactly as sent');
});

test('rule 15 — the length ceiling is 2048 characters, included', () => {
  const { model, rows } = fresh();
  const base = 'https://push.example/';
  const longest = `${base}${'a'.repeat(2048 - base.length)}`;
  assert.deepEqual(model.subscribe(1, { endpoint: longest, keys }), { ok: true });
  assert.deepEqual(model.subscribe(1, { endpoint: `${longest}a`, keys }), { error: 'INVALID_SUBSCRIPTION' });
  assert.deepEqual(rows(), [longest]);
});

test('rule 15 — a host of 255 characters is the longest one both parsers read', () => {
  const { model } = fresh();
  assert.deepEqual(model.subscribe(1, { endpoint: `https://${'a'.repeat(255)}/x`, keys }), { ok: true });
  assert.deepEqual(model.subscribe(1, { endpoint: `https://${'a'.repeat(256)}/x`, keys }), { error: 'INVALID_SUBSCRIPTION' });
});

test('rule 15 — padded base64url keys are the same bytes', () => {
  const { model } = fresh();
  const padded = { p256dh: `${P256DH}=`, auth: `${AUTH}==` };
  assert.deepEqual(model.subscribe(1, { endpoint: 'https://push.example/p', keys: padded }), { ok: true });
});

test('rule 15 — an endpoint that is not a public https address is refused and not stored', () => {
  const { model, rows } = fresh();
  const refused = [
    'https://127.0.0.1:8443/internal',
    'https://127.0.0.1/internal',
    'https://127.1/short-form',
    'https://2130706433/decimal-form',
    'https://0x7f.1/hex-form',
    'https://10.0.0.5/lan',
    'https://192.168.0.24/lan',
    'https://172.16.0.1/lan',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/v6',
    'https://[::ffff:127.0.0.1]/mapped',
    'https://[fe80::1]/link-local',
    'https://localhost/x',
    'https://LOCALHOST/x',
    'https://localhost./x',
    'https://foo.localhost/x',
    'https://foo.localhost./x',
    'https://a.example\\@127.0.0.1/backslash',
    'https://push.example/with space',
    'https://push.example/back\\slash',
    `https://${'a'.repeat(256)}/x`,
    'https://127.0.0.1}/x',
    'https://10.0.0.5{/x',
    'https://192.168.0.24"/x',
    'https://localhost\'/x',
    'https://localhost;/x',
    'https://localhost`/x',
    'https://10.0.0.5%2Eexample/percent-in-the-host',
    'https://{/x',
    'https://localhost../x',
    'https://127.0.0.1../x',
    'https://push.example../x',
    'https:///push.example/x',
    'https:/push.example/x',
    'https:push.example/x',
    'https://user@push.example/userinfo',
    'https://134744072/decimal-of-a-public-address',
    ' https://127.0.0.1/space',
    'https://push.example:8443/other-port',
    'http://push.example/not-https',
    'ftp://push.example/x',
    'not a url',
    '',
    `https://push.example/${'a'.repeat(2048)}`,
  ];
  refused.forEach((endpoint) => assert.deepEqual(model.subscribe(1, { endpoint, keys }), { error: 'INVALID_SUBSCRIPTION' }, endpoint));
  assert.deepEqual(rows(), []);
});

// web-push dials url.parse(endpoint).hostname, the check reads new URL: an accepted endpoint must mean the same host to both.
test('rule 15 — what is checked is what web-push dials', () => {
  const { model, rows } = fresh();
  const pieces = ['https://', 'https:', '/', '//', 'push.example', 'localhost', '127.0.0.1', '10.0.0.5', '8.8.8.8', '[::1]', '.', '..', ':443', ':8443',
    '@', '%2E', '%31', '}', '{', '"', "'", ';', '`', '?', '#', 'a', '-', '_', '0x7f', '\u3002', 'é'];
  let seed = 963;
  const next = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const offered = ['https://push.example/x'];
  for (let i = 0; i < 20000; i += 1) {
    let host = '';
    for (let n = next(3) + 1; n > 0; n -= 1) host += pieces[next(pieces.length)];
    offered.push(`${next(5) ? 'https://' : ''}${host}${next(2) ? '/x' : ''}`);
  }
  const accepted = offered.filter((endpoint) => !model.subscribe(1, { endpoint, keys }).error);
  assert.ok(accepted.length > 100, `the generator reaches accepted endpoints (${accepted.length})`);
  assert.deepEqual(rows().sort(), [...new Set(accepted)].sort());
  for (const endpoint of accepted) {
    const dialled = nodeUrl.parse(endpoint).hostname;
    assert.equal(`${dialled}`, new URL(endpoint).hostname.replace(/^\[|\]$/g, ''), endpoint);
    assert.ok(dialled, endpoint);
    assert.doesNotMatch(dialled, /^(localhost\.?|.*\.localhost\.?|127\.0\.0\.1\.?|10\.0\.0\.5\.?|::1)$/, endpoint);
  }
});

test('rule 15 — fields of the wrong type or keys of the wrong size are refused', () => {
  const { model, rows } = fresh();
  const endpoint = 'https://push.example/x';
  const refused = [
    null,
    'text',
    {},
    { endpoint },
    { endpoint, keys: 'x' },
    { endpoint: { a: 1 }, keys },
    { endpoint: ['https://push.example/x'], keys },
    { endpoint, keys: { p256dh: { a: 1 }, auth: AUTH } },
    { endpoint, keys: { p256dh: P256DH, auth: 1 } },
    { endpoint, keys: { p256dh: 'x', auth: 'y' } },
    { endpoint, keys: { p256dh: P256DH.slice(0, -2), auth: AUTH } },
    { endpoint, keys: { p256dh: P256DH, auth: `${AUTH}AA` } },
    { endpoint, keys: { p256dh: `${P256DH.slice(0, -1)}+`, auth: AUTH } },
    { endpoint, keys: { p256dh: `${P256DH.slice(0, -1)}!`, auth: AUTH } },
    { endpoint, keys: { p256dh: 'A'.repeat(5000), auth: AUTH } },
  ];
  refused.forEach((sub) => assert.deepEqual(model.subscribe(1, sub), { error: 'INVALID_SUBSCRIPTION' }, JSON.stringify(sub).slice(0, 80)));
  assert.deepEqual(rows(), []);
});

test('rule 15 — the iCal dev switch does not open the push check', (t) => {
  const before = process.env.GUESTFLOW_ICAL_ALLOW_PRIVATE;
  process.env.GUESTFLOW_ICAL_ALLOW_PRIVATE = '1';
  t.after(() => {
    if (before === undefined) delete process.env.GUESTFLOW_ICAL_ALLOW_PRIVATE;
    else process.env.GUESTFLOW_ICAL_ALLOW_PRIVATE = before;
  });
  const { model } = fresh();
  assert.deepEqual(model.subscribe(1, { endpoint: 'https://127.0.0.1/x', keys }), { error: 'INVALID_SUBSCRIPTION' });
});

test('rule 15 — a refused endpoint is never dialled by the fan-out; a stored row is not re-judged', async (t) => {
  const hits = [];
  const server = net.createServer((socket) => { hits.push(socket.localPort); socket.on('error', () => {}); socket.destroy(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((done) => server.close(done)));
  const stored = `https://127.0.0.1:${server.address().port}/stored`;

  const { db, model, rows } = fresh();
  const vapid = webpush.generateVAPIDKeys();
  webpush.setVapidDetails('mailto:a@b.fr', vapid.publicKey, vapid.privateKey);
  const service = buildPushService({ webpush, model, vapid: { isConfigured: () => true }, logger: { warn: () => {} } });

  assert.deepEqual(model.subscribe(1, { endpoint: stored, keys }), { error: 'INVALID_SUBSCRIPTION' });
  assert.equal((await service.sendToUser(1, { title: 't' })).skipped, 'no_subscription');
  assert.equal(hits.length, 0);

  db.prepare('INSERT INTO push_subscriptions (userId, endpoint, p256dh, auth) VALUES (1, ?, ?, ?)').run(stored, P256DH, AUTH);
  const result = await service.sendToUser(1, { title: 't' });
  assert.equal(result.failed, 1);
  assert.equal(hits.length, 1, 'a row already stored still goes out');
  assert.deepEqual(rows(), [stored], 'and is not pruned by this rule');
});

test('rule 15 — the route answers 400 with a short French message', () => {
  const controller = require('../controllers/pushController');
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  controller.subscribe({ user: { id: 1 }, body: { subscription: { endpoint: 'https://127.0.0.1/x', keys } } }, res);
  assert.equal(res.code, 400);
  assert.deepEqual(res.body, { error: 'INVALID_SUBSCRIPTION', message: 'Abonnement refusé.' });
});
