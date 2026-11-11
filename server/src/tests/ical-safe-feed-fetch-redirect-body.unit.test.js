// specs/ical-import-hardening.md rule 18 (audit R2 G) — a redirect response's body is cancelled before the
// next hop, so a large 302 body never holds the feed until the request timeout.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { fetchPublic, readCapped } = require('../utils/safeFeedFetch');

test('rule 18 — a 2 MB redirect body does not hold the fetch until the timeout', async () => {
  const big = 'x'.repeat(2 * 1024 * 1024);
  const server = http.createServer((req, res) => {
    if (req.url === '/a') { res.writeHead(302, { location: '/b' }); res.end(big); return; }
    res.writeHead(200, { 'content-type': 'text/calendar' });
    res.end('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const started = Date.now();
    const response = await fetchPublic(`http://127.0.0.1:${server.address().port}/a`, {
      signal: AbortSignal.timeout(6000),
      env: { GUESTFLOW_ICAL_ALLOW_PRIVATE: '1' },
    });
    const body = await readCapped(response, 5 * 1024 * 1024);
    await response.release();
    assert.match(String(body), /BEGIN:VCALENDAR/);
    assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('rule 18 — the body of a redirect hop is cancelled before it is followed', async () => {
  let cancelled = 0;
  const fetchImpl = async (url) => (url.endsWith('/a')
    ? { status: 302, headers: { get: () => '/b' }, body: { cancel: async () => { cancelled += 1; } }, bodyUsed: false }
    : { status: 200, ok: true, headers: { get: () => null } });
  await fetchPublic('http://feeds.example/a', { fetchImpl, env: {} });
  assert.equal(cancelled, 1);
});
