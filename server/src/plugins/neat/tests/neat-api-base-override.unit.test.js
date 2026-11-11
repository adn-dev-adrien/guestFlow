/**
 * specs/plugins-phase-3b-neat.md rule 24 — `NEAT_API_BASE` points the Neat client at a local mock,
 * like `QONTO_API_BASE` does for Qonto, so the plugin can be exercised end to end without the real
 * API (mega review #5, N9). Without it, the environment's own base URL applies.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildNeatClient, BASE_URLS } = require('../client');

function recordingFetch() {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const body = urls.length === 1 ? { token: 't', serviceAccount: { id: 's' } } : { amount: 1 };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return { urls, fetchImpl };
}

test('rule 24 — NEAT_API_BASE overrides the environment base URL (trailing slash dropped)', async () => {
  const { urls, fetchImpl } = recordingFetch();
  const client = buildNeatClient({ clientId: 'a', clientSecret: 'b', environment: 'production', fetchImpl, env: { NEAT_API_BASE: 'http://127.0.0.1:4829/' } });
  await client.price('c1', { serviceFieldValues: [] });
  assert.equal(urls[0], 'http://127.0.0.1:4829/service-accounts/auth');
  assert.ok(urls[1].startsWith('http://127.0.0.1:4829/'));
});

test('rule 24 — no override: the environment base URL; an explicit baseUrl still wins', async () => {
  const a = recordingFetch();
  await buildNeatClient({ clientId: 'a', clientSecret: 'b', environment: 'staging', fetchImpl: a.fetchImpl, env: {} }).price('c1', { serviceFieldValues: [] });
  assert.ok(a.urls[0].startsWith(BASE_URLS.staging));
  const b = recordingFetch();
  await buildNeatClient({ clientId: 'a', clientSecret: 'b', baseUrl: 'http://x.test', fetchImpl: b.fetchImpl, env: { NEAT_API_BASE: 'http://y.test' } }).price('c1', { serviceFieldValues: [] });
  assert.ok(b.urls[0].startsWith('http://x.test'));
});
