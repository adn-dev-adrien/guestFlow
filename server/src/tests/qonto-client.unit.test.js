// qontoClient — Qonto Business API wrapper. All HTTP is mocked; we assert the URLs, headers and
// bodies we construct and the parsing of responses. See specs/online-payments-qonto.md §4.1.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildQontoClient, mapQontoStatus } = require('../utils/qontoClient');

// A fetch stub that records the last call and returns a canned JSON response.
function stubFetch(response = {}, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    return { ok, status, text: async () => JSON.stringify(response) };
  };
  return { fetchImpl, calls };
}

const SANDBOX_CFG = {
  sandbox: true,
  clientId: 'cid_123',
  clientSecret: 'secret_abc',
  stagingToken: 'stg_token_xyz',
};

test('getAuthorizeUrl builds the sandbox authorize URL with the right params', () => {
  const client = buildQontoClient({ ...SANDBOX_CFG, fetchImpl: stubFetch().fetchImpl });
  const url = client.getAuthorizeUrl({ redirectUri: 'https://guestflow.domainesolio.com/api/payments/qonto/callback', state: 'st_1' });
  assert.ok(url.startsWith('https://oauth-sandbox.staging.qonto.co/oauth2/auth?'));
  const qs = new URL(url).searchParams;
  assert.equal(qs.get('response_type'), 'code');
  assert.equal(qs.get('client_id'), 'cid_123');
  assert.equal(qs.get('redirect_uri'), 'https://guestflow.domainesolio.com/api/payments/qonto/callback');
  assert.equal(qs.get('state'), 'st_1');
  assert.ok(qs.get('scope').includes('offline_access'));
  assert.ok(qs.get('scope').includes('payment_link.write'));
});

test('exchangeCode POSTs the authorization_code grant and parses tokens', async () => {
  const { fetchImpl, calls } = stubFetch({ access_token: 'at_1', refresh_token: 'rt_1', expires_in: 3600, scope: 'payment_link.write' });
  const client = buildQontoClient({ ...SANDBOX_CFG, fetchImpl });
  const tok = await client.exchangeCode({ code: 'auth_code_1', redirectUri: 'https://x/cb' });
  assert.deepEqual({ accessToken: tok.accessToken, refreshToken: tok.refreshToken, expiresIn: tok.expiresIn }, { accessToken: 'at_1', refreshToken: 'rt_1', expiresIn: 3600 });
  const { url, opts } = calls[0];
  assert.equal(url, 'https://oauth-sandbox.staging.qonto.co/oauth2/token');
  assert.equal(opts.method, 'POST');
  assert.match(opts.body, /grant_type=authorization_code/);
  assert.match(opts.body, /code=auth_code_1/);
});

test('refresh POSTs the refresh_token grant and keeps the old refresh token if none returned', async () => {
  const { fetchImpl, calls } = stubFetch({ access_token: 'at_2', expires_in: 3600 });
  const client = buildQontoClient({ ...SANDBOX_CFG, fetchImpl });
  const tok = await client.refresh({ refreshToken: 'rt_old' });
  assert.equal(tok.accessToken, 'at_2');
  assert.equal(tok.refreshToken, 'rt_old'); // preserved
  assert.match(calls[0].opts.body, /grant_type=refresh_token/);
  assert.match(calls[0].opts.body, /refresh_token=rt_old/);
});

test('createPaymentLink posts a Basket with the amount formatted from cents + auth/staging headers', async () => {
  const { fetchImpl, calls } = stubFetch({ payment_link: { id: 'pl_1', url: 'https://pay.qonto/pl_1', status: 'open', expiration_date: '2026-07-01T00:00:00Z' } });
  const client = buildQontoClient({ ...SANDBOX_CFG, fetchImpl });
  const link = await client.createPaymentLink({ accessToken: 'at_1', title: 'Acompte séjour', amountCents: 9000 });
  assert.deepEqual({ id: link.id, url: link.url, status: link.status, mappedStatus: link.mappedStatus }, { id: 'pl_1', url: 'https://pay.qonto/pl_1', status: 'open', mappedStatus: 'open' });

  const { url, opts } = calls[0];
  assert.equal(url, 'https://thirdparty-sandbox.staging.qonto.co/v2/payment_links');
  assert.equal(opts.headers.Authorization, 'Bearer at_1');
  assert.equal(opts.headers['X-Qonto-Staging-Token'], 'stg_token_xyz');
  const sent = JSON.parse(opts.body).payment_link;
  assert.equal(sent.reusable, false);
  assert.deepEqual(sent.items[0].unit_price, { value: '90.00', currency: 'EUR' }); // cents → "90.00"
  assert.equal(sent.items[0].vat_rate, '0'); // STRING, not number (Qonto rejects a number)
  assert.equal(sent.items[0].title, 'Acompte séjour');
});

test('getPaymentLink maps the Qonto status (paid)', async () => {
  const { fetchImpl, calls } = stubFetch({ payment_link: { id: 'pl_1', url: 'u', status: 'paid' } });
  const client = buildQontoClient({ ...SANDBOX_CFG, fetchImpl });
  const link = await client.getPaymentLink({ accessToken: 'at_1', id: 'pl_1' });
  assert.equal(link.status, 'paid');
  assert.equal(link.mappedStatus, 'paid');
  assert.equal(calls[0].opts.method, 'GET');
  assert.equal(calls[0].url, 'https://thirdparty-sandbox.staging.qonto.co/v2/payment_links/pl_1');
});

test('getPaymentLinkPayments flags paid from the payments sub-resource', async () => {
  const { fetchImpl, calls } = stubFetch({ payments: [{ id: 'pay_1', status: 'paid', paid_at: '2026-07-01T10:00:00Z' }] });
  const client = buildQontoClient({ ...SANDBOX_CFG, fetchImpl });
  const r = await client.getPaymentLinkPayments({ accessToken: 'at_1', id: 'pl_1' });
  assert.equal(r.paid, true);
  assert.equal(r.paidPayment.id, 'pay_1');
  assert.equal(calls[0].url, 'https://thirdparty-sandbox.staging.qonto.co/v2/payment_links/pl_1/payments');

  // No paid payment → paid:false (e.g. the link is only `processing`).
  const none = stubFetch({ payments: [{ id: 'pay_2', status: 'open' }] });
  const c2 = buildQontoClient({ ...SANDBOX_CFG, fetchImpl: none.fetchImpl });
  assert.equal((await c2.getPaymentLinkPayments({ accessToken: 'at', id: 'pl_1' })).paid, false);
});

test('a non-OK response throws with status + parsed body', async () => {
  const { fetchImpl } = stubFetch({ errors: [{ code: 'forbidden' }] }, { ok: false, status: 403 });
  const client = buildQontoClient({ ...SANDBOX_CFG, fetchImpl });
  await assert.rejects(
    () => client.createPaymentLink({ accessToken: 'bad', title: 'x', amountCents: 100 }),
    (err) => { assert.equal(err.status, 403); assert.deepEqual(err.body, { errors: [{ code: 'forbidden' }] }); return true; },
  );
});

test('production config uses the prod hosts and sends no staging header', async () => {
  const { fetchImpl, calls } = stubFetch({ payment_link: { id: 'pl_p', url: 'u', status: 'open' } });
  const client = buildQontoClient({ sandbox: false, clientId: 'c', clientSecret: 's', fetchImpl });
  await client.createPaymentLink({ accessToken: 'at', title: 'x', amountCents: 100 });
  assert.equal(calls[0].url, 'https://thirdparty.qonto.com/v2/payment_links');
  assert.equal(calls[0].opts.headers['X-Qonto-Staging-Token'], undefined);
});

test('listBankAccounts maps accounts from the flat and the org-wrapped shapes', async () => {
  const flat = stubFetch({ bank_accounts: [{ id: 'a1', name: 'Principal', iban: 'FR76xxx', main: true }] });
  let client = buildQontoClient({ ...SANDBOX_CFG, fetchImpl: flat.fetchImpl });
  let accts = await client.listBankAccounts({ accessToken: 'at' });
  assert.deepEqual(accts, [{ id: 'a1', name: 'Principal', iban: 'FR76xxx', main: true }]);
  assert.equal(flat.calls[0].url, 'https://thirdparty-sandbox.staging.qonto.co/v2/bank_accounts');

  const wrapped = stubFetch({ organization: { bank_accounts: [{ id: 'b1', name: 'X' }] } });
  client = buildQontoClient({ ...SANDBOX_CFG, fetchImpl: wrapped.fetchImpl });
  accts = await client.listBankAccounts({ accessToken: 'at' });
  assert.equal(accts[0].id, 'b1');
});

test('connectProvider sends the form + parses status & connection_location (onboarding URL)', async () => {
  const { fetchImpl, calls } = stubFetch({ connection: { status: 'pending', connection_location: 'https://onboard/x', bank_account_id: 'a1' } });
  const client = buildQontoClient({ ...SANDBOX_CFG, fetchImpl });
  const r = await client.connectProvider({
    accessToken: 'at', partnerCallbackUrl: 'https://gf/cb', userBankAccountId: 'a1',
    userPhoneNumber: '+33612345678', userWebsiteUrl: 'https://x.y', businessDescription: 'd'.repeat(80),
  });
  assert.deepEqual({ status: r.status, connectionLocation: r.connectionLocation, bankAccountId: r.bankAccountId },
    { status: 'pending', connectionLocation: 'https://onboard/x', bankAccountId: 'a1' });
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.partner_callback_url, 'https://gf/cb');
  assert.equal(sent.user_bank_account_id, 'a1');
  assert.equal(sent.business_description.length, 80);
});

test('getConnection re-checks the current provider status', async () => {
  const { fetchImpl, calls } = stubFetch({ connection: { status: 'enabled', bank_account_id: 'a1' } });
  const client = buildQontoClient({ ...SANDBOX_CFG, fetchImpl });
  const r = await client.getConnection({ accessToken: 'at' });
  assert.equal(r.status, 'enabled');
  assert.equal(calls[0].opts.method, 'GET');
  assert.equal(calls[0].url, 'https://thirdparty-sandbox.staging.qonto.co/v2/payment_links/connections');
});

test('mapQontoStatus normalises every Qonto status', () => {
  assert.equal(mapQontoStatus('paid'), 'paid');
  assert.equal(mapQontoStatus('processing'), 'open');
  assert.equal(mapQontoStatus('open'), 'open');
  assert.equal(mapQontoStatus('expired'), 'expired');
  assert.equal(mapQontoStatus('canceled'), 'cancelled');
  assert.equal(mapQontoStatus(undefined), 'open');
});
