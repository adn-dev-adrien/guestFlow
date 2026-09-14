const test = require('node:test');
const assert = require('node:assert/strict');

const gateSignature = require('../utils/gateSignature');
const { signRequest, verifyResult, sign, isFresh, matches, WINDOW_MS, __test } = gateSignature;

// specs/guest-gate-access.md §3.9 rules 31 and 32 — the second factor on the GuestFlow ↔ Sowel
// channel: fail closed with no secret, and a freshness window of ±2 min. The payloads are pinned
// here too, because both halves compute them independently and a silent change breaks the channel.
//
// The hole it closes is worth restating, because the tests below only make sense against it: the
// API key proves the HOUSE to GuestFlow, and nothing proved GuestFlow to the house. The plugin
// polls over plain HTTP on the LAN, so anyone able to answer as that address could hand it a forged
// request and have the gate pulsed — without knowing any key, since the key travels away from the
// house, never towards it.

const SECRET = 'a-secret-that-never-travels';

test('the signed payloads are pinned — changing one silently breaks both sides', () => {
  // These two strings ARE the contract between guestFlow and the plugin. A reordering here would
  // make every signature fail in production while every unit test still passed.
  assert.equal(__test.requestPayload({ id: 42, signedAt: 1700, reservationId: 7 }), '42.1700.7');
  assert.equal(__test.requestPayload({ id: 42, signedAt: 1700, reservationId: null }), '42.1700.');
  assert.equal(__test.resultPayload({ id: 42, status: 'opened', timestamp: 1700 }), '42.opened.1700');
});

test('signRequest stamps the moment and signs id, moment and stay together', () => {
  const now = 1_700_000_000_000;
  const signed = signRequest({ id: 42, reservationId: 7 }, SECRET, { now });

  assert.equal(signed.signedAt, now);
  assert.equal(signed.signature, sign('42.1700000000000.7', SECRET));
  assert.match(signed.signature, /^[0-9a-f]{64}$/);
});

test('the same request signed twice at the same instant gives the same signature', () => {
  const now = 1_700_000_000_000;
  assert.equal(
    signRequest({ id: 1, reservationId: 1 }, SECRET, { now }).signature,
    signRequest({ id: 1, reservationId: 1 }, SECRET, { now }).signature,
  );
});

test('another secret produces another signature — that is the whole point', () => {
  const now = 1_700_000_000_000;
  assert.notEqual(
    signRequest({ id: 1, reservationId: 1 }, SECRET, { now }).signature,
    signRequest({ id: 1, reservationId: 1 }, 'the-attacker-guess', { now }).signature,
  );
});

// --- verifying an outcome reported by the house ---

function outcome(over = {}) {
  const timestamp = over.timestamp ?? Date.now();
  const id = over.id ?? 42;
  const status = over.status ?? 'opened';
  return {
    id,
    status,
    timestamp,
    signature: over.signature ?? sign(`${id}.${status}.${timestamp}`, over.secret ?? SECRET),
  };
}

test('a properly signed outcome passes', () => {
  assert.deepEqual(verifyResult(outcome(), SECRET), { ok: true });
});

test('no signing secret configured refuses everything — fail closed', () => {
  const result = verifyResult(outcome(), '');
  assert.equal(result.ok, false);
  assert.match(result.reason, /no signing secret/);
  // A channel that silently drops its second factor when a variable is missing is worse than one
  // that never had it: nobody would notice.
});

test('a missing signature is refused', () => {
  const result = verifyResult({ ...outcome(), signature: undefined }, SECRET);
  assert.equal(result.ok, false);
  assert.match(result.reason, /missing signature/);
});

test('a signature from another secret is refused', () => {
  const result = verifyResult(outcome({ secret: 'wrong' }), SECRET);
  assert.equal(result.ok, false);
  assert.match(result.reason, /mismatch/);
});

test('a captured call cannot be replayed tomorrow', () => {
  const captured = outcome({ timestamp: Date.now() - 24 * 60 * 60 * 1000 });
  const result = verifyResult(captured, SECRET);
  assert.equal(result.ok, false);
  assert.match(result.reason, /stale/);
});

test('the freshness window is two minutes, both ways, for clock drift', () => {
  const now = 1_700_000_000_000;
  assert.equal(isFresh(now, { now }), true);
  assert.equal(isFresh(now - WINDOW_MS + 1000, { now }), true);
  assert.equal(isFresh(now + WINDOW_MS - 1000, { now }), true, 'a house clock slightly ahead is fine');
  assert.equal(isFresh(now - WINDOW_MS - 1000, { now }), false);
  assert.equal(isFresh(now + WINDOW_MS + 1000, { now }), false);
  assert.equal(isFresh(undefined, { now }), false);
  assert.equal(isFresh('not-a-number', { now }), false);
});

test('changing the status invalidates the signature — an outcome cannot be edited in flight', () => {
  const signed = outcome({ status: 'opened' });
  const tampered = { ...signed, status: 'refused' };
  assert.equal(verifyResult(tampered, SECRET).ok, false);
});

test('changing the request id invalidates it too — an answer cannot be moved to another request', () => {
  const signed = outcome({ id: 42 });
  assert.equal(verifyResult({ ...signed, id: 43 }, SECRET).ok, false);
});

test('matches never throws, whatever it is handed', () => {
  const expected = sign('x', SECRET);
  assert.equal(matches(undefined, expected), false);
  assert.equal(matches('', expected), false);
  assert.equal(matches('short', expected), false);
  assert.equal(matches({}, expected), false);
  assert.equal(matches(expected, expected), true);
});
