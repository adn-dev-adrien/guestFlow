/**
 * specs/neat-cancellation-insurance-subscription.md §4.1 — utils/neatClient.js.
 *
 * Auth + token reuse, single re-auth on 401, environment base URLs, request payloads, error
 * surfacing. All through an injected fetch stub — no network.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildNeatClient, BASE_URLS } = require('../utils/neatClient');

// A scripted fetch: each call shifts the next response off the queue and records the request.
function stubFetch(script) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers || {} });
    const next = script.shift() || { status: 200, body: {} };
    return {
      ok: (next.status || 200) < 400,
      status: next.status || 200,
      text: async () => JSON.stringify(next.body ?? {}),
    };
  };
  return { fetchImpl, calls };
}

const AUTH_OK = { status: 200, body: { token: 'tok-1', serviceAccount: { id: 'svc-1' } } };
const CREDS = { clientId: 'id', clientSecret: 'secret' };

test('auth posts the credentials to the environment base URL and caches the token', async () => {
  const { fetchImpl, calls } = stubFetch([AUTH_OK, { body: { amount: 12 } }, { body: { amount: 12 } }]);
  const client = buildNeatClient({ ...CREDS, environment: 'staging', fetchImpl });
  await client.price('c1', { serviceFieldValues: [] });
  await client.price('c1', { serviceFieldValues: [] });
  assert.equal(calls[0].url, `${BASE_URLS.staging}/service-accounts/auth`);
  assert.deepEqual(calls[0].body, { clientId: 'id', clientSecret: 'secret' });
  assert.equal(calls.length, 3, 'one auth serves both calls — the token is cached');
  assert.equal(calls[1].headers.Authorization, 'Bearer tok-1');
  assert.equal(calls[1].url, `${BASE_URLS.staging}/pricings/c1/price`);
});

test('production environment uses the production base URL', async () => {
  const { fetchImpl, calls } = stubFetch([AUTH_OK, { body: { amount: 5 } }]);
  const client = buildNeatClient({ ...CREDS, environment: 'production', fetchImpl });
  await client.price('c1', { serviceFieldValues: [], quantity: 1 });
  assert.ok(calls[0].url.startsWith(BASE_URLS.production));
  assert.ok(calls[1].url.startsWith(BASE_URLS.production));
});

test('a 401 re-authenticates once and retries; a second 401 surfaces', async () => {
  const { fetchImpl, calls } = stubFetch([
    AUTH_OK,
    { status: 401, body: {} }, // expired token
    { status: 200, body: { token: 'tok-2', serviceAccount: { id: 'svc-1' } } },
    { body: { amount: 7 } },
  ]);
  const client = buildNeatClient({ ...CREDS, fetchImpl });
  const { amount } = await client.price('c1', { serviceFieldValues: [] });
  assert.equal(amount, 7);
  assert.equal(calls.length, 4, 'auth → 401 → re-auth → retry');
  assert.equal(calls[3].headers.Authorization, 'Bearer tok-2');

  const twice = stubFetch([AUTH_OK, { status: 401 }, AUTH_OK, { status: 401 }]);
  const client2 = buildNeatClient({ ...CREDS, fetchImpl: twice.fetchImpl });
  await assert.rejects(() => client2.price('c1', { serviceFieldValues: [] }), /HTTP 401/);
});

test('subscribe posts the dto verbatim and returns the id', async () => {
  const { fetchImpl, calls } = stubFetch([AUTH_OK, { body: { id: 'sub-9' } }]);
  const client = buildNeatClient({ ...CREDS, fetchImpl });
  const dto = { salesChannelId: 'ch', serviceFieldValues: [{ id: 'f', type: 'number', value: 3 }], customers: [], totalAmount: 17.5, paymentContext: { method: 'Cash', paymentMethodId: 'pm' }, externalId: 'guestflow-4' };
  const out = await client.subscribe('c1', dto);
  assert.equal(out.id, 'sub-9');
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].url, `${BASE_URLS.staging}/contracts/c1/subscriptions`);
  assert.deepEqual(calls[1].body, dto);
});

test('getByExternalId returns null on 404 and the dto otherwise', async () => {
  const { fetchImpl } = stubFetch([AUTH_OK, { status: 404, body: {} }]);
  const client = buildNeatClient({ ...CREDS, fetchImpl });
  assert.equal(await client.getByExternalId('c1', 'guestflow-1'), null);

  const found = stubFetch([AUTH_OK, { body: { id: 'sub-1', status: 'active', externalId: 'guestflow-1' } }]);
  const client2 = buildNeatClient({ ...CREDS, fetchImpl: found.fetchImpl });
  const sub = await client2.getByExternalId('c1', 'guestflow-1');
  assert.equal(sub.id, 'sub-1');
  assert.equal(found.calls[1].url, `${BASE_URLS.staging}/contracts/c1/subscriptions/external-id/guestflow-1`);
});

test('voidSubscription posts the reason to /subscriptions/{id}/void', async () => {
  const { fetchImpl, calls } = stubFetch([AUTH_OK, { body: { id: 'sub-1' } }]);
  const client = buildNeatClient({ ...CREDS, fetchImpl });
  await client.voidSubscription('sub-1');
  assert.equal(calls[1].url, `${BASE_URLS.staging}/subscriptions/sub-1/void`);
  assert.equal(calls[1].body.subscriptionId, 'sub-1');
  assert.ok(calls[1].body.voidReason);
});

test('a Neat 400 surfaces its per-field detail in the error message', async () => {
  const { fetchImpl } = stubFetch([AUTH_OK, {
    status: 400,
    body: { statusCode: 400, error: 'Bad Request', message: [{ field: 'customers', errors: ['birthdate is required'] }] },
  }]);
  const client = buildNeatClient({ ...CREDS, fetchImpl });
  await assert.rejects(
    () => client.subscribe('c1', {}),
    (err) => err.status === 400 && /customers: birthdate is required/.test(err.message),
  );
});

test('failed auth (no token) rejects instead of continuing unauthenticated', async () => {
  const { fetchImpl } = stubFetch([{ status: 200, body: {} }]);
  const client = buildNeatClient({ ...CREDS, fetchImpl });
  await assert.rejects(() => client.getStores(), /no token/);
});

test('discovery endpoints hit the documented paths', async () => {
  const { fetchImpl, calls } = stubFetch([
    AUTH_OK,
    { body: [{ id: 'st-1', name: 'Domaine', salesChannels: [{ id: 'ch-1', name: 'Site' }] }] },
    { body: { id: 'ch-1', name: 'Site', paymentMethods: ['pm-1'], contracts: ['c-1'] } },
    { body: [{ id: 'c-1', product: { name: 'Assurance', Garanties: [] } }] },
  ]);
  const client = buildNeatClient({ ...CREDS, fetchImpl });
  const stores = await client.getStores();
  assert.equal(stores[0].id, 'st-1');
  await client.getSalesChannel('ch-1');
  await client.getSalesChannelContracts('ch-1');
  assert.equal(calls[1].url, `${BASE_URLS.staging}/service-accounts/svc-1/stores`);
  assert.equal(calls[2].url, `${BASE_URLS.staging}/sales-channels/ch-1`);
  assert.equal(calls[3].url, `${BASE_URLS.staging}/sales-channels/ch-1/contracts`);
});
