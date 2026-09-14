// specs/gate-access-portier.md §4.1-§4.2 — guestFlow's client of Portier's service API.
//
// Portier is faked by a local HTTP server on an ephemeral loopback port: the requests really go
// over the wire, so the headers and the body bytes checked here are the ones Portier would receive.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

const {
  createPortierClient, PortierUnavailableError, signService, decodeKey, actorOf,
} = require('../utils/portierClient');

const KEY_TEXT = crypto.randomBytes(32).toString('base64url');

function startFakePortier(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const record = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) };
        seen.push(record);
        handler(record, res);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

test('not configured: no URL or no valid key → the call never leaves, and says so', async () => {
  for (const env of [{}, { PORTIER_SVC_URL: 'http://127.0.0.1:1' }, { PORTIER_KEY_GF: KEY_TEXT }, { PORTIER_SVC_URL: 'http://127.0.0.1:1', PORTIER_KEY_GF: 'short' }]) {
    let fetched = false;
    const client = createPortierClient({ env, fetchImpl: () => { fetched = true; } });
    assert.equal(client.isConfigured(), false);
    await assert.rejects(client.call({ method: 'GET', path: '/svc/v1/stays/1' }), (err) => err instanceof PortierUnavailableError && err.code === 'not_configured');
    assert.equal(fetched, false);
  }
});

test('a stay push carries the timestamp, a signature Portier can recompute, and the exact body bytes', async () => {
  const fake = await startFakePortier((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result: 'applied', accessId: '6f1c2a9e-3b7d-4c55-9a10-2e8f4b6d7c01' }));
  });
  try {
    const client = createPortierClient({ env: { PORTIER_SVC_URL: `${fake.url}/`, PORTIER_KEY_GF: KEY_TEXT }, now: () => 1789999200000 });
    const body = { revision: 7, startsAt: '2026-09-21T14:00:00.000Z', endsAt: '2026-09-28T09:00:00.000Z', propertyName: 'Gîte', guestFirstName: 'Camille', reservationNumber: '202609042' };
    const answer = await client.call({ method: 'put', path: '/svc/v1/stays/12', body });

    assert.deepEqual(answer, { status: 200, data: { result: 'applied', accessId: '6f1c2a9e-3b7d-4c55-9a10-2e8f4b6d7c01' } });
    const [req] = fake.seen;
    assert.equal(req.method, 'PUT');
    assert.equal(req.url, '/svc/v1/stays/12');
    assert.equal(req.headers['x-portier-ts'], '1789999200000');
    assert.equal(req.headers['x-portier-actor'], undefined, 'stay routes carry no actor');
    assert.equal(req.headers['content-type'], 'application/json');
    assert.equal(req.body.toString('utf8'), JSON.stringify(body));
    const expected = signService({
      key: decodeKey(KEY_TEXT), method: 'PUT', path: '/svc/v1/stays/12', ts: '1789999200000', actor: '', body: req.body,
    });
    assert.equal(req.headers['x-portier-sig'], expected);
  } finally {
    await fake.close();
  }
});

test('an owner read names the acting user in the header AND in the signature', async () => {
  const fake = await startFakePortier((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"accesses":[],"house":{"link":"up"}}');
  });
  try {
    const client = createPortierClient({ env: { PORTIER_SVC_URL: fake.url, PORTIER_KEY_GF: KEY_TEXT }, now: () => 1789999200000 });
    const actor = actorOf({ id: 7, email: 'adrien@example.com' });
    await client.call({ method: 'GET', path: '/svc/v1/accesses?state=current', actor });
    const [req] = fake.seen;
    assert.equal(req.headers['x-portier-actor'], '7|adrien@example.com');
    assert.equal(req.body.length, 0);
    assert.equal(req.headers['x-portier-sig'], signService({
      key: decodeKey(KEY_TEXT), method: 'GET', path: '/svc/v1/accesses?state=current', ts: '1789999200000', actor, body: '',
    }));
  } finally {
    await fake.close();
  }
});

test('Portier answers about the request (404, 409, 422) → the caller gets the answer, not an outage', async () => {
  const statuses = [404, 409, 422];
  const fake = await startFakePortier((req, res) => {
    const status = statuses.shift();
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status === 422 ? { field: 'endsAt', reason: 'window_too_long' } : { error: 'x' }));
  });
  try {
    const client = createPortierClient({ env: { PORTIER_SVC_URL: fake.url, PORTIER_KEY_GF: KEY_TEXT } });
    assert.equal((await client.call({ method: 'GET', path: '/a' })).status, 404);
    assert.equal((await client.call({ method: 'POST', path: '/b' })).status, 409);
    assert.deepEqual(await client.call({ method: 'PUT', path: '/c', body: {} }), { status: 422, data: { field: 'endsAt', reason: 'window_too_long' } });
  } finally {
    await fake.close();
  }
});

test('no usable answer (5xx, a refused signature, nobody listening, a hang) → PortierUnavailableError', async () => {
  const fake = await startFakePortier((req, res) => {
    if (req.url === '/hang') return; // never answers
    res.writeHead(req.url === '/401' ? 401 : 503);
    res.end('{"error":"bad_signature"}');
  });
  try {
    const client = createPortierClient({ env: { PORTIER_SVC_URL: fake.url, PORTIER_KEY_GF: KEY_TEXT }, timeoutMs: 150 });
    await assert.rejects(client.call({ method: 'GET', path: '/503' }), { code: 'unreachable' });
    await assert.rejects(client.call({ method: 'GET', path: '/401' }), { code: 'rejected' });
    await assert.rejects(client.call({ method: 'GET', path: '/hang' }), { code: 'timeout' });
  } finally {
    await fake.close();
  }
  const closed = createPortierClient({ env: { PORTIER_SVC_URL: fake.url, PORTIER_KEY_GF: KEY_TEXT } });
  await assert.rejects(closed.call({ method: 'GET', path: '/gone' }), { code: 'unreachable' });
});
