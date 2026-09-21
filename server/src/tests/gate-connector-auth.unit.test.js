// The connector's authentication — specs/gate-access-sowel-connector.md §3.3, rules 12-15.
//
// The signature vectors are PINNED on both sides: the other half lives in
// `sowel-plugin-guest-access/src/guestflow.ts` (`canonicalString`), and changing the order of a
// field here while the other keeps its own would make every call fail in production with both test
// suites green.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { buildRequireGateConnector, canonicalString } = require('../middleware/requireGateConnector');

const KEY = 'la-clef-du-connecteur';
const SECRET = 'le-secret-qui-ne-circule-jamais';
const NOW = 1789000000000;

function call({ method = 'GET', url = '/public/v1/gate/stays?since=0', headers = {}, body = '', env, now = NOW } = {}) {
  const req = {
    method,
    originalUrl: url,
    rawBody: body ? Buffer.from(body, 'utf8') : null,
    get: (name) => headers[String(name).toLowerCase()],
  };
  const answers = [];
  const res = {
    status(code) { answers.push({ code }); return this; },
    json(payload) { answers[answers.length - 1].payload = payload; return this; },
  };
  let passed = false;
  const middleware = buildRequireGateConnector({
    now: () => now,
    env: env || { GATE_API_KEY: KEY, GATE_SIGNING_SECRET: SECRET },
  });
  middleware(req, res, () => { passed = true; });
  return { passed, answers };
}

function signedHeaders({ method = 'GET', url = '/public/v1/gate/stays?since=0', body = '', timestamp = NOW, secret = SECRET, key = KEY } = {}) {
  return {
    authorization: `Bearer ${key}`,
    'x-gate-timestamp': String(timestamp),
    'x-gate-signature': crypto
      .createHmac('sha256', secret)
      .update(canonicalString(method, url, timestamp, body))
      .digest('hex'),
  };
}

test('a properly signed call passes', () => {
  const { passed } = call({ headers: signedHeaders() });
  assert.equal(passed, true);
});

test('the canonical string is method, path WITH query, timestamp, body digest', () => {
  const body = JSON.stringify({ invitations: [] });
  const canonical = canonicalString('POST', '/public/v1/gate/invitations', NOW, body);
  assert.deepEqual(canonical.split('\n'), [
    'POST',
    '/public/v1/gate/invitations',
    String(NOW),
    crypto.createHash('sha256').update(body).digest('hex'),
  ]);
});

test('with no signing secret configured, everything is refused — we fail closed', () => {
  const { passed, answers } = call({
    headers: signedHeaders(),
    env: { GATE_API_KEY: KEY, GATE_SIGNING_SECRET: '' },
  });
  assert.equal(passed, false);
  assert.equal(answers[0].code, 401);
  assert.equal(answers[0].payload.error.code, 'UNAUTHENTICATED');
});

test('nor with no key configured', () => {
  const { passed } = call({ headers: signedHeaders(), env: { GATE_API_KEY: '', GATE_SIGNING_SECRET: SECRET } });
  assert.equal(passed, false);
});

test('a wrong key is refused, even with a valid signature', () => {
  const { passed } = call({ headers: { ...signedHeaders(), authorization: 'Bearer autre-chose' } });
  assert.equal(passed, false);
});

test('a signature made with another secret is refused', () => {
  const { passed } = call({ headers: signedHeaders({ secret: 'pas le bon' }) });
  assert.equal(passed, false);
});

test('a captured call cannot be replayed tomorrow', () => {
  const headers = signedHeaders();
  assert.equal(call({ headers }).passed, true);
  assert.equal(call({ headers, now: NOW + 3 * 60 * 1000 }).passed, false);
  assert.equal(call({ headers, now: NOW - 3 * 60 * 1000 }).passed, false);
  // Two minutes of clock drift stay tolerated.
  assert.equal(call({ headers, now: NOW + 60 * 1000 }).passed, true);
});

test('altering the cursor in flight invalidates the signature', () => {
  const headers = signedHeaders({ url: '/public/v1/gate/stays?since=0' });
  const { passed } = call({ url: '/public/v1/gate/stays?since=999', headers });
  assert.equal(passed, false);
});

test('altering the body in flight invalidates the signature', () => {
  const body = JSON.stringify({ invitations: [{ reservationId: 1 }] });
  const headers = signedHeaders({ method: 'POST', url: '/public/v1/gate/invitations', body });
  const { passed } = call({
    method: 'POST',
    url: '/public/v1/gate/invitations',
    body: JSON.stringify({ invitations: [{ reservationId: 2 }] }),
    headers,
  });
  assert.equal(passed, false);
});

test('the key also travels in X-API-Key, like the rest of the public tree', () => {
  const headers = signedHeaders();
  delete headers.authorization;
  headers['x-api-key'] = KEY;
  assert.equal(call({ headers }).passed, true);
});

test('a missing or unreadable timestamp is refused', () => {
  for (const timestamp of [undefined, '', 'maintenant']) {
    const headers = signedHeaders();
    if (timestamp === undefined) delete headers['x-gate-timestamp'];
    else headers['x-gate-timestamp'] = timestamp;
    assert.equal(call({ headers }).passed, false);
  }
});

test('the WordPress proxy key does not open this door', () => {
  // PUBLIC_API_KEY and GATE_API_KEY are two distinct secrets, and that is the point: the site's
  // key has no business reading who sleeps here tonight.
  const { passed } = call({
    headers: signedHeaders({ key: 'la-clef-du-site' }),
    env: { GATE_API_KEY: KEY, GATE_SIGNING_SECRET: SECRET, PUBLIC_API_KEY: 'la-clef-du-site' },
  });
  assert.equal(passed, false);
});
