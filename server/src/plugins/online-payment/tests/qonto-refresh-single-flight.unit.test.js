// specs/qonto-settings-in-app.md rule 18 (audit R22, E22-3) — the poll, the webhook, a public payment and the operator
// all reach an expired token at once. One refresh per refresh token: the others wait for it and share its answer.
// Loopback fake only, whose refresh tokens are single-use as the worst case of the real provider.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { withQonto } = require('../../../utils/qonto/qontoService');
const { getValidQontoAccessToken } = require('../../../utils/qonto/qontoAuth');

async function fakeQonto(t) {
  const refreshCalls = [];
  const valid = new Set(['R1']);
  let generation = 1;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url !== '/oauth2/token') return res.end(JSON.stringify({ payments: [] }));
      const token = new URLSearchParams(body).get('refresh_token');
      refreshCalls.push(token);
      return setTimeout(() => {
        if (!valid.has(token)) {
          valid.clear();
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'invalid_grant' }));
        }
        valid.delete(token);
        generation += 1;
        valid.add(`R${generation}`);
        return res.end(JSON.stringify({ access_token: `A${generation}`, refresh_token: `R${generation}`, expires_in: 3600 }));
      }, 20);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  return { base: `http://127.0.0.1:${server.address().port}`, refreshCalls };
}

function harness(base) {
  const expired = () => new Date(Date.now() - 1000).toISOString();
  const state = { tokens: { accessToken: 'OLD', refreshToken: 'R1', expiresAt: expired() }, stores: [] };
  const settings = {
    qontoTokens: () => ({ ...state.tokens }),
    storeQontoTokens: (next) => { state.stores.push(next); state.tokens = { ...state.tokens, ...next }; },
    recordQontoHealth: () => {},
    qontoCredentials: () => ({}),
    qontoSettings: () => ({}),
    qontoStoredConfig: () => ({}),
  };
  const env = { QONTO_ENV: 'sandbox', QONTO_CLIENT_ID: 'id', QONTO_CLIENT_SECRET: 'sec', QONTO_OAUTH_BASE: base, QONTO_API_BASE: base, PUBLIC_URL: base, QONTO_RETRY_MAX_ATTEMPTS: '1' };
  const call = (origin) => withQonto({ settings, env, origin }, async (client, accessToken) => {
    await client.getPaymentLinkPayments({ accessToken, id: 'L' });
    return accessToken;
  });
  return { state, settings, call, expire: () => { state.tokens.expiresAt = expired(); } };
}

test('rule 18 — a poll and a webhook on an expired token: one refresh, both get the new token', async (t) => {
  const qonto = await fakeQonto(t);
  const { state, call } = harness(qonto.base);
  const results = await Promise.all([call('poll'), call('webhook'), call('public-payment')]);
  assert.deepEqual(results, ['A2', 'A2', 'A2']);
  assert.deepEqual(qonto.refreshCalls, ['R1']);
  assert.equal(state.stores.length, 1);
  assert.equal(state.tokens.refreshToken, 'R2');
});

test('rule 18 — the next expiry refreshes again, with the rotated token', async (t) => {
  const qonto = await fakeQonto(t);
  const { state, call, expire } = harness(qonto.base);
  await Promise.all([call('poll'), call('webhook')]);
  expire();
  assert.deepEqual(await Promise.all([call('poll'), call('webhook')]), ['A3', 'A3']);
  assert.deepEqual(qonto.refreshCalls, ['R1', 'R2']);
  assert.equal(state.tokens.refreshToken, 'R3');
});

test('rule 18 — a refused refresh fails every waiter once, and the next call asks again', async () => {
  const { state, settings } = harness('http://127.0.0.1:9');
  let calls = 0;
  const clientFactory = () => ({
    refresh: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (calls === 1) throw Object.assign(new Error('refused'), { status: 400 });
      return { accessToken: 'A9', refreshToken: 'R9', expiresIn: 3600 };
    },
  });
  const outcomes = await Promise.allSettled([getValidQontoAccessToken({ settings, clientFactory }), getValidQontoAccessToken({ settings, clientFactory })]);
  assert.deepEqual(outcomes.map((o) => o.status), ['rejected', 'rejected']);
  assert.equal(calls, 1);
  assert.equal(state.stores.length, 0);
  assert.equal(await getValidQontoAccessToken({ settings, clientFactory }), 'A9');
  assert.equal(calls, 2);
});

test('rule 18 — a client that cannot even be built leaves no entry behind', async () => {
  const { settings } = harness('http://127.0.0.1:9');
  await assert.rejects(getValidQontoAccessToken({ settings, clientFactory: () => { throw new Error('no client'); } }), /no client/);
  const token = await getValidQontoAccessToken({ settings, clientFactory: () => ({ refresh: async () => ({ accessToken: 'A7', refreshToken: 'R7', expiresIn: 3600 }) }) });
  assert.equal(token, 'A7');
});

test('rule 18 — two connections with their own refresh tokens do not share a refresh', async () => {
  const connection = (refreshToken) => ({
    qontoTokens: () => ({ accessToken: '', refreshToken, expiresAt: null }),
    storeQontoTokens: () => {},
  });
  const clientFactory = () => ({
    refresh: async ({ refreshToken }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { accessToken: `access-of-${refreshToken}`, refreshToken, expiresIn: 3600 };
    },
  });
  const tokens = await Promise.all([
    getValidQontoAccessToken({ settings: connection('X'), clientFactory }),
    getValidQontoAccessToken({ settings: connection('Y'), clientFactory }),
  ]);
  assert.deepEqual(tokens, ['access-of-X', 'access-of-Y']);
});
