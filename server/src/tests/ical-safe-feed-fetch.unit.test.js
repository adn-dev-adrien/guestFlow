// specs/ical-import-hardening.md rule 17 — an iCal feed URL is operator input read from inside the LAN:
// private, loopback and link-local addresses are refused (directly, by name, through a redirect), the
// body is capped at 5 MB, unless a dev setting lifts the address check (audit 2026-10-28).
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchPublic, readCapped, assertPublicHost, isPrivateAddress, MAX_FEED_BYTES, FeedFetchError,
} = require('../utils/safeFeedFetch');

const resolveTo = (...addresses) => async () => addresses.map((address) => ({ address }));
const PRIVATE_MESSAGE = 'Adresse du flux non autorisée (réseau privé).';

test('rule 17 — private, loopback, link-local and unique-local addresses are recognised', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.24', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:192.168.0.1']) {
    assert.equal(isPrivateAddress(a), true, a);
  }
  for (const a of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(a), false, a);
  }
});

test('rule 17 — an IP literal on a private range is refused without any lookup', async () => {
  await assert.rejects(assertPublicHost('192.168.0.24', { lookup: () => { throw new Error('no lookup'); }, env: {} }), { message: PRIVATE_MESSAGE });
  await assert.rejects(assertPublicHost('[::1]', { env: {} }), { message: PRIVATE_MESSAGE });
});

test('rule 17 — localhost and a name that resolves to a private address are refused', async () => {
  await assert.rejects(assertPublicHost('localhost', { env: {} }), FeedFetchError);
  await assert.rejects(assertPublicHost('feeds.example', { lookup: resolveTo('93.184.216.34', '10.0.0.5'), env: {} }), { message: PRIVATE_MESSAGE });
});

test('rule 17 — a public name passes, and a name that does not resolve is left to the fetch', async () => {
  await assertPublicHost('feeds.example', { lookup: resolveTo('93.184.216.34'), env: {} });
  await assertPublicHost('feeds.example', { lookup: async () => { throw new Error('ENOTFOUND'); }, env: {} });
});

test('rule 17 — GUESTFLOW_ICAL_ALLOW_PRIVATE=1 lifts the address check for a dev box', async () => {
  await assertPublicHost('127.0.0.1', { env: { GUESTFLOW_ICAL_ALLOW_PRIVATE: '1' } });
});

test('rule 17 — a redirect to a private address is refused, and the hop is never fetched', async () => {
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    return { status: 302, headers: { get: (h) => (h === 'location' ? 'http://169.254.169.254/latest/meta-data' : null) } };
  };
  await assert.rejects(
    fetchPublic('http://feeds.example/a.ics', { fetchImpl, lookup: resolveTo('93.184.216.34'), env: {} }),
    { message: PRIVATE_MESSAGE },
  );
  assert.deepEqual(fetched, ['http://feeds.example/a.ics']);
});

test('rule 17 — a redirect to a public address is followed, at most three times', async () => {
  let hops = 0;
  const fetchImpl = async () => {
    hops += 1;
    return { status: 301, headers: { get: () => `http://feeds.example/hop${hops}` } };
  };
  await assert.rejects(fetchPublic('http://feeds.example/a.ics', { fetchImpl, lookup: resolveTo('93.184.216.34'), env: {} }), { message: 'Trop de redirections.' });
  assert.equal(hops, 4);

  const ok = await fetchPublic('http://feeds.example/a.ics', {
    fetchImpl: async (url) => (url.endsWith('a.ics') ? { status: 302, headers: { get: () => '/b.ics' } } : { status: 200, ok: true, headers: { get: () => null } }),
    lookup: resolveTo('93.184.216.34'),
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
  } finally {
    global.fetch = original;
    if (previous !== undefined) process.env.GUESTFLOW_ICAL_ALLOW_PRIVATE = previous;
  }
});
