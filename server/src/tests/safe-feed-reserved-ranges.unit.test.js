// specs/ical-import-hardening.md rule 17 (« A feed is read bounded and public-only »), reading of 2026-11-05 (audit R23,
// E23-6 and R23-I7): the reserved ranges are not public, for the iCal feeds and the push door alike. No dial.
const test = require('node:test');
const assert = require('node:assert/strict');

const { isPrivateAddress, assertPublicHost, FeedFetchError } = require('../utils/safeFeedFetch');
const Database = require('better-sqlite3');
const { create } = require('../models/pushSubscriptionsModel');

const RESERVED = [
  '198.18.0.1', '198.19.255.254', '192.0.0.1', '192.0.0.192', '192.0.2.1', '198.51.100.1', '203.0.113.1', '192.88.99.1',
  '::ffff:198.18.0.1', '2002:c612:1::',
  'fec0::1', 'feff::1', '2001:db8::1', '2001::1', '2001:1ff:ffff::1', '100::1', '::ffff:0:7f00:1', '::ffff:0:a00:1', '5f00::1',
  '3fff::1', '3fff:fff:ffff::1', '4000::1', 'dfff::1',
];
for (const address of RESERVED) {
  test(`rule 17: ${address} is not public`, () => {
    assert.equal(isPrivateAddress(address), true);
    assert.throws(() => assertPublicHost(`[${address}]`.replace(/^\[(\d+\.\d+\.\d+\.\d+)\]$/, '$1'), { env: {} }), FeedFetchError);
  });
}

const STILL_REFUSED = ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '100.64.0.1', '169.254.169.254', '0.0.0.0', '224.0.0.1', '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '64:ff9b::7f00:1', '::ffff:7f00:1', '2002:7f00:1::'];
for (const address of STILL_REFUSED) {
  test(`rule 17: ${address} stays refused`, () => assert.equal(isPrivateAddress(address), true));
}

const PUBLIC = [
  '8.8.8.8', '1.1.1.1', '192.0.1.1', '192.0.3.1', '192.88.98.1', '198.17.255.255', '198.20.0.1', '198.51.99.1', '203.0.112.1', '203.0.114.1',
  '2606:4700:4700::1111', '2a00:1450:4001::1', '2001:4860:4860::8888', '2001:200::1', '2001:db9::1', '3ffe::1', '3fff:1000::1', '2002:808:808::', '::ffff:8.8.8.8',
];
for (const address of PUBLIC) {
  test(`rule 17: ${address} stays public`, () => assert.equal(isPrivateAddress(address), false));
}

test('rule 17: the dev switch still lifts the literal check for iCal', () => {
  assert.doesNotThrow(() => assertPublicHost('198.18.0.1', { env: { GUESTFLOW_ICAL_ALLOW_PRIVATE: '1' } }));
});

test('pwa-push rule 15: a reserved literal is refused at the push door', () => {
  const keys = { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') };
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, endpoint TEXT UNIQUE, p256dh TEXT, auth TEXT);
    CREATE TABLE user_push_prefs (userId INTEGER PRIMARY KEY, newReservation INT, arrivals INT, departures INT, breakfast INT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, isActive INT, isSupportAccount INT);
    CREATE TABLE user_roles (userId INT, role TEXT);`);
  const model = create(db);
  for (const host of ['198.18.0.1', '192.0.2.1', '[2001:db8::1]', '[fec0::1]']) {
    assert.deepEqual(model.subscribe(1, { endpoint: `https://${host}/x`, keys }), { error: 'INVALID_SUBSCRIPTION' }, host);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 0);
});
