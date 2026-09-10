const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const {
  parseHosts, isGuestHost, guestBaseUrl, tagGuestHost, guestTreeOnly, adminTreeOnly,
} = require('../middleware/requireGuestHost');

// specs/guest-gate-access.md §4.1 — the host separation, enforced in BOTH directions.
// The point of the separate hostname is to keep an unauthenticated public page off the origin that
// carries the operator's session. That is only true if the server enforces it.

const GUEST = { GUEST_HOST: 'guest.domainesolio.com, guest.localhost:4000' };

function req(host) {
  return { headers: host ? { host } : {} };
}

// --- the pure parts ---

test('the host list is parsed forgivingly, and an empty one matches nothing', () => {
  assert.deepEqual(parseHosts('a.test , B.TEST,,  '), ['a.test', 'b.test']);
  assert.deepEqual(parseHosts(''), []);
  assert.deepEqual(parseHosts(undefined), []);
});

test('a request is on the guest host by name, with or without the port', () => {
  assert.equal(isGuestHost(req('guest.domainesolio.com'), GUEST), true);
  assert.equal(isGuestHost(req('guest.domainesolio.com:443'), GUEST), true);
  assert.equal(isGuestHost(req('GUEST.DOMAINESOLIO.COM'), GUEST), true);
  assert.equal(isGuestHost(req('guest.localhost:4000'), GUEST), true);
});

test('everything else is not the guest host — including the admin app and a bare IP', () => {
  assert.equal(isGuestHost(req('guestflow.domainesolio.com'), GUEST), false);
  assert.equal(isGuestHost(req('guestflow.adn-dev.fr'), GUEST), false);
  assert.equal(isGuestHost(req('192.168.0.24:4000'), GUEST), false);
  assert.equal(isGuestHost(req(''), GUEST), false);
  assert.equal(isGuestHost(req(undefined), GUEST), false);
});

test('fail-closed: with no GUEST_HOST configured, nothing is the guest host', () => {
  assert.equal(isGuestHost(req('guest.domainesolio.com'), {}), false);
  assert.equal(isGuestHost(req('anything'), { GUEST_HOST: '' }), false);
  // A deployment that forgets the variable loses the feature. It never serves the admin API on a
  // public name, which is the failure that would matter.
});

test('the public origin is derived when it is not configured, and https is assumed off localhost', () => {
  assert.equal(guestBaseUrl({ GUEST_BASE_URL: 'https://guest.test/' }), 'https://guest.test');
  assert.equal(guestBaseUrl({ GUEST_HOST: 'guest.domainesolio.com' }), 'https://guest.domainesolio.com');
  assert.equal(guestBaseUrl({ GUEST_HOST: 'guest.localhost:4000' }), 'http://guest.localhost:4000');
  assert.equal(guestBaseUrl({}), '', 'nothing configured, nothing to link to');
});

// --- the two guards, on a real express app ---

async function withApp(env, run) {
  const app = express();
  app.use(tagGuestHost(env));
  app.use('/gate/v1', guestTreeOnly, (req, res) => res.json({ tree: 'guest' }));
  app.use('/api', adminTreeOnly, (req, res) => res.json({ tree: 'admin' }));
  app.use((req, res) => res.status(404).json({ error: 'NOT_FOUND' }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();

  // `fetch` cannot do this: undici treats `Host` as a forbidden header and drops it silently, so
  // every request would arrive as 127.0.0.1 and the guard would look like it was not firing. The
  // first version of this test passed for that reason, which is exactly the sort of green nobody
  // should trust. node:http sets the header verbatim.
  const call = (path, host) => new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { Host: host } },
      (response) => {
        let raw = '';
        response.on('data', (chunk) => { raw += chunk; });
        response.on('end', () => resolve({
          status: response.statusCode,
          json: () => JSON.parse(raw || '{}'),
        }));
      },
    );
    request.on('error', reject);
    request.end();
  });
  try {
    await run(call);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('on the guest host, the admin API does not exist — 404, not 403', async () => {
  await withApp(GUEST, async (call) => {
    const api = await call('/api/reservations', 'guest.domainesolio.com');
    assert.equal(api.status, 404, 'a 403 would confirm there is something there to find');
    assert.deepEqual(api.json(), { error: 'NOT_FOUND' });

    const guest = await call('/gate/v1/session', 'guest.domainesolio.com');
    assert.equal(guest.status, 200);
    assert.deepEqual(guest.json(), { tree: 'guest' });
  });
});

test('on the admin host, the guest tree does not exist either', async () => {
  await withApp(GUEST, async (call) => {
    const guest = await call('/gate/v1/session', 'guestflow.domainesolio.com');
    assert.equal(guest.status, 404);

    const api = await call('/api/reservations', 'guestflow.domainesolio.com');
    assert.equal(api.status, 200);
    assert.deepEqual(api.json(), { tree: 'admin' });
  });
});

test('with no GUEST_HOST, the admin app is untouched and the guest tree is closed', async () => {
  await withApp({}, async (call) => {
    assert.equal((await call('/api/reservations', 'guestflow.domainesolio.com')).status, 200);
    assert.equal((await call('/gate/v1/session', 'guest.domainesolio.com')).status, 404);
  });
});
