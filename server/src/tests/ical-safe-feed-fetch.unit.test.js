// specs/ical-import-hardening.md rule 17 — an iCal feed URL is operator input read from inside the LAN:
// private, loopback and link-local addresses are refused (literal, IPv4-mapped IPv6, by name, through a
// redirect, through DNS rebinding), the body is capped at 5 MB, unless a dev setting lifts the address
// check (audit 2026-10-28, review of PR #846).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  fetchPublic, readCapped, assertPublicHost, guardedLookup, isPrivateAddress, MAX_FEED_BYTES, FeedFetchError,
} = require('../utils/safeFeedFetch');

const PRIVATE_MESSAGE = 'Adresse du flux non autorisée (réseau privé).';
const resolveTo = (...addresses) => (host, cb) => cb(null, addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
const lookupOnce = (lookup, host = 'feeds.example') => new Promise((resolve, reject) => {
  lookup(host, { all: true }, (error, records) => (error ? reject(error) : resolve(records)));
});

test('rule 17 — private, loopback, link-local, unique-local, NAT64 and mapped addresses are recognised', () => {
  for (const a of [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.24', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', 'fd00::1', 'fe80::1', 'ff02::1',
    '::ffff:192.168.0.1', '::ffff:7f00:1', '::ffff:c0a8:18', '::127.0.0.1', '::7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::',
  ]) {
    assert.equal(isPrivateAddress(a), true, a);
  }
  for (const a of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(a), false, a);
  }
  assert.equal(isPrivateAddress('not an address'), true, 'unparseable means refused');
});

test('rule 17 — the URL parser\'s rewrite of an IPv4-mapped literal is still refused', () => {
  assert.equal(new URL('http://[::ffff:127.0.0.1]/').hostname, '[::ffff:7f00:1]');
  assert.throws(() => assertPublicHost(new URL('http://[::ffff:127.0.0.1]/').hostname, { env: {} }), { message: PRIVATE_MESSAGE });
  assert.throws(() => assertPublicHost(new URL('http://[::ffff:192.168.0.24]/').hostname, { env: {} }), { message: PRIVATE_MESSAGE });
});

test('rule 17 — a private IP literal, localhost and *.localhost are refused', () => {
  assert.throws(() => assertPublicHost('192.168.0.24', { env: {} }), { message: PRIVATE_MESSAGE });
  assert.throws(() => assertPublicHost('[::1]', { env: {} }), { message: PRIVATE_MESSAGE });
  assert.throws(() => assertPublicHost('localhost', { env: {} }), FeedFetchError);
  assert.throws(() => assertPublicHost('feeds.localhost', { env: {} }), FeedFetchError);
  assert.doesNotThrow(() => assertPublicHost('feeds.example', { env: {} }));
});

test('rule 17 — GUESTFLOW_ICAL_ALLOW_PRIVATE=1 lifts the address check for a dev box', async () => {
  assert.doesNotThrow(() => assertPublicHost('127.0.0.1', { env: { GUESTFLOW_ICAL_ALLOW_PRIVATE: '1' } }));
  const records = await lookupOnce(guardedLookup({ resolve: resolveTo('127.0.0.1'), env: { GUESTFLOW_ICAL_ALLOW_PRIVATE: '1' } }));
  assert.equal(records[0].address, '127.0.0.1');
});

test('rule 17 — the connection\'s own lookup refuses a name that resolves to a private address, even mapped', async () => {
  await assert.rejects(lookupOnce(guardedLookup({ resolve: resolveTo('93.184.216.34', '10.0.0.5'), env: {} })), { message: PRIVATE_MESSAGE });
  await assert.rejects(lookupOnce(guardedLookup({ resolve: resolveTo('::ffff:7f00:1'), env: {} })), { message: PRIVATE_MESSAGE });
  const records = await lookupOnce(guardedLookup({ resolve: resolveTo('93.184.216.34'), env: {} }));
  assert.equal(records[0].address, '93.184.216.34');
});

test('rule 17 — a failed lookup refuses, it never lets the connection through', async () => {
  const failing = guardedLookup({ resolve: (host, cb) => cb(new Error('ENOTFOUND')), env: {} });
  await assert.rejects(lookupOnce(failing), { message: 'ENOTFOUND' });
  await assert.rejects(lookupOnce(guardedLookup({ resolve: (host, cb) => cb(null, []), env: {} })), FeedFetchError);
});

test('rule 17 — DNS rebinding: a name that answers public once then private is refused at dial time, on a real connection', async () => {
  const server = http.createServer((req, res) => res.end('BEGIN:VCALENDAR\r\nEND:VCALENDAR'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  let answers = 0;
  const rebinding = (host, cb) => { answers += 1; cb(null, [{ address: answers === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }]); };
  try {
    // First answer public (a pre-check would pass), the one the connection dials is private.
    await lookupOnce(guardedLookup({ resolve: rebinding, env: {} }));
    await assert.rejects(fetchPublic(`http://rebind.example:${port}/feed.ics`, { resolve: rebinding, env: {} }), { message: PRIVATE_MESSAGE });
    // Control: a public answer would have been dialled (the address, not the name, is what connects).
    const ok = await fetchPublic(`http://good.example:${port}/feed.ics`, { resolve: resolveTo('127.0.0.1'), env: { GUESTFLOW_ICAL_ALLOW_PRIVATE: '1' } });
    assert.equal(ok.status, 200);
    await ok.text();
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('rule 17 — a redirect to an IPv4-mapped loopback literal is refused, and the hop is never fetched', async () => {
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    return { status: 302, headers: { get: (h) => (h === 'location' ? 'http://[::ffff:127.0.0.1]:8080/secret' : null) } };
  };
  await assert.rejects(fetchPublic('http://feeds.example/a.ics', { fetchImpl, env: {} }), { message: PRIVATE_MESSAGE });
  assert.deepEqual(fetched, ['http://feeds.example/a.ics']);
});

test('rule 17 — a redirect to a metadata address is refused too', async () => {
  const fetchImpl = async () => ({ status: 302, headers: { get: () => 'http://169.254.169.254/latest/meta-data' } });
  await assert.rejects(fetchPublic('http://feeds.example/a.ics', { fetchImpl, env: {} }), { message: PRIVATE_MESSAGE });
});

test('rule 17 — a redirect to a public address is followed, at most three times, and each fetch carries the pinning dispatcher', async () => {
  let hops = 0;
  const dispatchers = new Set();
  const fetchImpl = async (url, options) => {
    hops += 1;
    dispatchers.add(options.dispatcher);
    return { status: 301, headers: { get: () => `http://feeds.example/hop${hops}` } };
  };
  await assert.rejects(fetchPublic('http://feeds.example/a.ics', { fetchImpl, env: {} }), { message: 'Trop de redirections.' });
  assert.equal(hops, 4);
  assert.equal(dispatchers.size, 1);
  assert.ok([...dispatchers][0], 'a dispatcher is passed on every hop');

  const ok = await fetchPublic('http://feeds.example/a.ics', {
    fetchImpl: async (url) => (url.endsWith('a.ics') ? { status: 302, headers: { get: () => '/b.ics' } } : { status: 200, ok: true, headers: { get: () => null } }),
    env: {},
  });
  assert.equal(ok.status, 200);
});

test('rule 17 — only http(s) addresses are fetched', async () => {
  await assert.rejects(fetchPublic('file:///etc/passwd', { fetchImpl: async () => { throw new Error('never'); }, env: {} }), { message: 'Adresse du flux invalide.' });
});

test('rule 17 — the body is capped at 5 MB: declared length, streamed length, and plain text', async () => {
  assert.equal(MAX_FEED_BYTES, 5 * 1024 * 1024);
  await assert.rejects(readCapped({ headers: { get: () => String(MAX_FEED_BYTES + 1) }, text: async () => '' }, MAX_FEED_BYTES), { message: 'Flux iCal trop volumineux.' });

  let cancelled = false;
  const chunks = [new Uint8Array(60), new Uint8Array(60)];
  const streamed = { headers: { get: () => null }, body: { getReader: () => ({ read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true }), cancel: async () => { cancelled = true; } }) } };
  await assert.rejects(readCapped(streamed, 100), { message: 'Flux iCal trop volumineux.' });
  assert.equal(cancelled, true, 'the connection is released as soon as the cap is passed');

  await assert.rejects(readCapped({ headers: { get: () => null }, text: async () => 'x'.repeat(101) }, 100), FeedFetchError);
  assert.equal(await readCapped({ headers: { get: () => null }, text: async () => 'BEGIN:VCALENDAR' }, 100), 'BEGIN:VCALENDAR');
});

test('rule 17 — a feed that is under the cap is read whole from a stream', async () => {
  const chunks = [Buffer.from('BEGIN:VCAL'), Buffer.from('ENDAR')];
  const response = { headers: { get: () => null }, body: { getReader: () => ({ read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true }), cancel: async () => {} }) } };
  assert.equal(await readCapped(response, 100), 'BEGIN:VCALENDAR');
});

test('rule 17 — a source whose URL is a private address fails with a readable message and never calls fetch', async () => {
  const Database = require('better-sqlite3');
  const propertyIcalModel = require('../models/propertyIcalModel');
  const db = new Database(':memory:');
  db.exec(require('fs').readFileSync(require('path').join(__dirname, '..', 'schema.sql'), 'utf8'));
  const model = propertyIcalModel.buildModel(db);
  const original = global.fetch;
  const previous = process.env.GUESTFLOW_ICAL_ALLOW_PRIVATE;
  delete process.env.GUESTFLOW_ICAL_ALLOW_PRIVATE;
  global.fetch = async () => { throw new Error('fetch must not be reached'); };
  try {
    await assert.rejects(model.fetchFeed({ url: 'http://192.168.0.24:8080/feed.ics' }), { message: PRIVATE_MESSAGE });
    await assert.rejects(model.fetchFeed({ url: 'http://[::ffff:c0a8:18]/feed.ics' }), { message: PRIVATE_MESSAGE });
  } finally {
    global.fetch = original;
    if (previous !== undefined) process.env.GUESTFLOW_ICAL_ALLOW_PRIVATE = previous;
  }
});
