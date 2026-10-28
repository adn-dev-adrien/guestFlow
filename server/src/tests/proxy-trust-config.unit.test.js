// specs/hosting-h1-fleet-runtime.md rule 35 (audit 2026-10-28, public finding F4): forwarded headers are
// believed only with TRUST_PROXY_HOPS, and only past the proxy secret when one is set.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');

const { proxyTrust, proxySecretGuard } = require('../utils/proxySecret');

test('rule 35: no TRUST_PROXY_HOPS trusts no hop and warns nothing', () => {
  assert.deepEqual(proxyTrust({}), { hops: false, warning: null });
  assert.deepEqual(proxyTrust({ TRUST_PROXY_HOPS: '' }), { hops: false, warning: null });
  assert.equal(proxyTrust({ TRUST_PROXY_HOPS: 'abc' }).hops, false);
  assert.equal(proxyTrust({ TRUST_PROXY_HOPS: '0' }).hops, false);
});

test('rule 35: hops with the proxy secret are quiet, hops without it warn', () => {
  assert.deepEqual(proxyTrust({ TRUST_PROXY_HOPS: '1', GUESTFLOW_PROXY_SECRET: 's' }), { hops: 1, warning: null });
  const open = proxyTrust({ TRUST_PROXY_HOPS: '1' });
  assert.equal(open.hops, 1);
  assert.match(open.warning, /GUESTFLOW_PROXY_SECRET/);
});

async function ipSeenBy(env, headers) {
  const app = express();
  app.set('trust proxy', proxyTrust(env).hops);
  app.use(proxySecretGuard(env.GUESTFLOW_PROXY_SECRET));
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/ip`, { headers });
    return (await res.json()).ip;
  } finally { server.close(); }
}

test('rule 35: X-Forwarded-For counts only with the hops set and, when a secret is set, only with the secret', async () => {
  const xff = { 'X-Forwarded-For': '203.0.113.9' };
  assert.match(await ipSeenBy({}, xff), /127\.0\.0\.1/, 'no hops: ignored');
  assert.equal(await ipSeenBy({ TRUST_PROXY_HOPS: '1' }, xff), '203.0.113.9');
  const guarded = { TRUST_PROXY_HOPS: '1', GUESTFLOW_PROXY_SECRET: 'top' };
  assert.match(await ipSeenBy(guarded, xff), /127\.0\.0\.1/, 'secret missing: dropped');
  assert.equal(await ipSeenBy(guarded, { ...xff, 'x-guestflow-proxy': 'top' }), '203.0.113.9');
});
