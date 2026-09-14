// specs/gate-access-portier.md §4.1 — the byte-level contract with Portier.
//
// Three programs written separately must produce the same signature for the same message
// (Portier `specs/contract.md` §8). These are the vectors of `specs/contract-vectors.json`, pinned
// here verbatim: a reordered field, seconds instead of milliseconds or a key used as text instead of
// bytes would leave every other suite green and break every call in production.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decodeKey, serviceCanonical, signService, eventCanonical, signEvent, verifyEvent,
} = require('../utils/portierClient');

const K_GF = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8';

const SVC = {
  method: 'PUT',
  path: '/svc/v1/stays/1234',
  ts: '1789999200000',
  actor: '',
  body: '{"revision":42,"startsAt":"2026-09-21T14:00:00.000Z","endsAt":"2026-09-28T09:00:00.000Z","propertyName":"Gîte","guestFirstName":"Camille","reservationNumber":"202609042"}',
  canonical: 'svc|PUT|/svc/v1/stays/1234|1789999200000||c720384ed9ba224c24d5db0ecffe15d1fb24e645ee8afccd008924b85baef159',
  sig: 'd449f0ed0767e398fea7036862a7dab4472a3a1f40e9884deabd2e3640f06e85',
};

const SVC_OWNER_GET = {
  method: 'GET',
  path: '/svc/v1/accesses?state=current',
  ts: '1789999200000',
  actor: '7|adrien@example.com',
  body: '',
  canonical: 'svc|GET|/svc/v1/accesses?state=current|1789999200000|7|adrien@example.com|e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  sig: '7e923d585977747d9b7310e80be6840709fe38b54f9502007a3895d68190c634',
};

const EVT = {
  ts: '1789999200000',
  body: '{"type":"devices_over_six","accessId":"6f1c2a9e-3b7d-4c55-9a10-2e8f4b6d7c01","label":"Camille (Gîte · 202609042)","count":7,"at":"2026-09-22T18:03:00.000Z"}',
  canonical: 'evt|1789999200000|dfc139362a4ca89976b01feb249e42625088a9340334287177caaf93ee468fcc',
  sig: '6ed21fa0ee69f5fde24a0c59bf1351f8e5a3108457f21aa2f98aed41c4470c78',
};

test('K_gf is the 32 decoded bytes of its base64url text (0x20…0x3f)', () => {
  const key = decodeKey(K_GF);
  assert.equal(key.length, 32);
  assert.deepEqual([...key], Array.from({ length: 32 }, (_, i) => 0x20 + i));
});

test('a key that is not 43 base64url characters is no key at all', () => {
  assert.equal(decodeKey(''), null);
  assert.equal(decodeKey(`${K_GF}=`), null, 'padding is not part of the encoding');
  assert.equal(decodeKey(K_GF.slice(1)), null);
  assert.equal(decodeKey(Buffer.alloc(32).toString('base64')), null, 'standard base64 carries padding');
});

test('svc vector: a stay push signs exactly the canonical string of the contract', () => {
  assert.equal(serviceCanonical(SVC), SVC.canonical);
  assert.equal(signService({ key: decodeKey(K_GF), ...SVC }), SVC.sig);
});

test('svc_owner_get vector: the actor and the query are signed, the empty body hashes the empty string', () => {
  assert.equal(serviceCanonical(SVC_OWNER_GET), SVC_OWNER_GET.canonical);
  assert.equal(signService({ key: decodeKey(K_GF), ...SVC_OWNER_GET }), SVC_OWNER_GET.sig);
});

test('evt vector: guestFlow produces the same event signature as Portier, and accepts it', () => {
  assert.equal(eventCanonical(EVT), EVT.canonical);
  assert.equal(signEvent({ key: decodeKey(K_GF), ...EVT }), EVT.sig);
  const verdict = verifyEvent({
    key: decodeKey(K_GF), ts: EVT.ts, sig: EVT.sig, rawBody: Buffer.from(EVT.body, 'utf8'), now: Number(EVT.ts) + 1000,
  });
  assert.deepEqual(verdict, { ok: true });
});

test('evt vector: one changed byte, a foreign key or a stale clock is refused', () => {
  const key = decodeKey(K_GF);
  const now = Number(EVT.ts);
  assert.equal(verifyEvent({ key, ts: EVT.ts, sig: EVT.sig, rawBody: EVT.body.replace('7', '8'), now }).error, 'bad_signature');
  assert.equal(verifyEvent({ key: Buffer.alloc(32), ts: EVT.ts, sig: EVT.sig, rawBody: EVT.body, now }).error, 'bad_signature');
  assert.equal(verifyEvent({ key, ts: EVT.ts, sig: EVT.sig.toUpperCase(), rawBody: EVT.body, now }).error, 'bad_signature',
    'signatures travel as lowercase hex');
  assert.equal(verifyEvent({ key, ts: EVT.ts, sig: EVT.sig, rawBody: EVT.body, now: now + 120001 }).error, 'stale');
  assert.deepEqual(verifyEvent({ key, ts: EVT.ts, sig: EVT.sig, rawBody: EVT.body, now: now - 120000 }), { ok: true },
    'the ±120 000 ms bound is inclusive');
});
