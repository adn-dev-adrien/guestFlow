// specs/google-calendar-oauth-rework.md rule 30 (audit R7, outbound-call sweep after finding N7) — the
// token revocation run by « Déconnecter » is bounded like every other Google call: a Google endpoint that
// never answers no longer holds the disconnect request for good.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildGoogleOAuthClient, REQUEST_TIMEOUT_MS } = require('../oauthClient');

const ENV = { GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret' };
const settings = { publicUrl: () => '', googleTokens: () => ({ refreshToken: '' }) };

function within(ms, promise) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve('still pending'), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// A fetch that only settles when its signal aborts, as undici does on a silent peer.
function silentFetch(seen) {
  return (url, init) => new Promise((_, reject) => {
    seen.push(init);
    if (init && init.signal) init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
}

test('rule 30 — the revocation carries the 20 s bound of rule 27', async () => {
  assert.equal(REQUEST_TIMEOUT_MS, 20_000);
  const seen = [];
  const client = buildGoogleOAuthClient({ env: ENV, settings, fetchImpl: async (url, init) => { seen.push(init); return { ok: true }; } });
  await client.revokeToken('tok');
  assert.ok(seen[0].signal instanceof AbortSignal);
  assert.equal(seen[0].signal.aborted, false);
});

test('rule 30 — a revocation Google never answers settles at the bound, without throwing', async () => {
  const seen = [];
  const client = buildGoogleOAuthClient({ env: ENV, settings, fetchImpl: silentFetch(seen), requestTimeoutMs: 50 });
  const outcome = await within(1000, client.revokeToken('tok'));
  assert.equal(outcome, undefined);
  assert.equal(seen.length, 1);
});
