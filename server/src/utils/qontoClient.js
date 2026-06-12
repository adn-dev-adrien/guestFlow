/**
 * Qonto Business API client (specs/online-payments-qonto.md §4.1) — OAuth2 + payment links.
 *
 * Pure-ish HTTP wrapper: a factory takes config (client id/secret/staging token, base URLs, an
 * injectable `fetch`) so it is fully unit-testable without network access. Holds NO state and NO
 * tokens — the caller passes the access token in; token storage lives in encrypted settings.
 *
 * Auth: OAuth2 authorization-code flow. Authorize → user consents → callback receives `code` →
 * `exchangeCode` → {access,refresh} → `refresh` when the access token expires (needs `offline_access`).
 * Endpoints + URLs from docs.qonto.com (2026-06). Sandbox calls also send `X-Qonto-Staging-Token`.
 *
 * Amounts: Qonto uses `{ value, currency }` with `value` a decimal string ("90.00"). We keep cents
 * internally and format here. (Confirm the exact value format on first sandbox call.)
 */

const SANDBOX_HOSTS = { oauth: 'https://oauth-sandbox.staging.qonto.co', api: 'https://thirdparty-sandbox.staging.qonto.co' };
const PROD_HOSTS = { oauth: 'https://oauth.qonto.com', api: 'https://thirdparty.qonto.com' };

// `offline_access` is required to receive a refresh token; the rest are what payment links + the
// provider connection need (write to create links, read to poll, organization.read for the bank account).
const DEFAULT_SCOPES = ['offline_access', 'organization.read', 'payment_link.read', 'payment_link.write'];

// Maps a Qonto payment-link status to our `payment_links.status` enum.
function mapQontoStatus(qontoStatus) {
  switch (String(qontoStatus || '').toLowerCase()) {
    case 'paid': return 'paid';
    case 'expired': return 'expired';
    case 'canceled':
    case 'cancelled': return 'cancelled';
    case 'open':
    case 'processing':
    default: return 'open';
  }
}

function buildQontoClient(config = {}) {
  const env = config.env || process.env;
  const sandbox = config.sandbox !== undefined
    ? Boolean(config.sandbox)
    : String(env.QONTO_ENV || 'sandbox').toLowerCase() !== 'production';
  const hosts = sandbox ? SANDBOX_HOSTS : PROD_HOSTS;
  const oauthBase = config.oauthBase || env.QONTO_OAUTH_BASE || hosts.oauth;
  const apiBase = config.apiBase || env.QONTO_API_BASE || hosts.api;
  const clientId = config.clientId || env.QONTO_CLIENT_ID || '';
  const clientSecret = config.clientSecret || env.QONTO_CLIENT_SECRET || '';
  const stagingToken = config.stagingToken || env.QONTO_STAGING_TOKEN || '';
  const fetchImpl = config.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('qontoClient: no fetch implementation (Node 18+ global fetch or inject config.fetchImpl)');
  }

  const stagingHeader = () => (sandbox && stagingToken ? { 'X-Qonto-Staging-Token': stagingToken } : {});

  function apiHeaders(accessToken) {
    return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...stagingHeader() };
  }

  async function readBody(res, context) {
    const text = typeof res.text === 'function' ? await res.text() : '';
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`Qonto ${context} failed (HTTP ${res.status})`);
      err.status = res.status;
      err.body = body;
      // Log the real Qonto error (status + body incl. the trace_id) so failures are diagnosable in
      // PM2 without re-running probes. The body holds Qonto error codes, not secrets.
      // eslint-disable-next-line no-console
      console.error(`[qonto] ${context} HTTP ${res.status}: ${JSON.stringify(body)}`);
      throw err;
    }
    return body || {};
  }

  async function postForm(path, params, context) {
    const res = await fetchImpl(`${oauthBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...stagingHeader() },
      body: new URLSearchParams(params).toString(),
    });
    return readBody(res, context);
  }

  return {
    sandbox,
    isConfigured() { return Boolean(clientId && clientSecret); },

    // Step 1 — the URL we redirect the operator's browser to so they consent (run once at setup).
    getAuthorizeUrl({ redirectUri, state, scopes = DEFAULT_SCOPES }) {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scopes.join(' '),
        state,
      });
      return `${oauthBase}/oauth2/auth?${params.toString()}`;
    },

    // Step 2 — exchange the callback `code` for tokens.
    async exchangeCode({ code, redirectUri }) {
      const json = await postForm('/oauth2/token', {
        grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
      }, 'token exchange');
      return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresIn: Number(json.expires_in) || null, scope: json.scope || '' };
    },

    // Refresh an expired access token (keeps the refresh token if the response omits a new one).
    async refresh({ refreshToken }) {
      const json = await postForm('/oauth2/token', {
        grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret,
      }, 'token refresh');
      return { accessToken: json.access_token, refreshToken: json.refresh_token || refreshToken, expiresIn: Number(json.expires_in) || null };
    },

    // Create a single-amount payment link (Basket type: one line item carrying the whole amount).
    async createPaymentLink({ accessToken, title, amountCents, currency = 'EUR', vatRate = 0, paymentMethods = ['credit_card', 'apple_pay'], reusable = false }) {
      const value = (Math.round(Number(amountCents || 0)) / 100).toFixed(2);
      const payload = {
        payment_link: {
          reusable: Boolean(reusable),
          potential_payment_methods: paymentMethods,
          // Qonto expects `vat_rate` as a STRING (e.g. "0", "20") — a number is rejected with
          // "cannot unmarshal number ... of type string".
          items: [{ title: String(title || 'Paiement'), quantity: 1, unit_price: { value, currency }, vat_rate: String(vatRate) }],
        },
      };
      const res = await fetchImpl(`${apiBase}/v2/payment_links`, { method: 'POST', headers: apiHeaders(accessToken), body: JSON.stringify(payload) });
      const json = await readBody(res, 'create payment link');
      const link = json.payment_link || json;
      return { id: link.id, url: link.url, status: link.status, mappedStatus: mapQontoStatus(link.status), expirationDate: link.expiration_date || null, raw: link };
    },

    // Poll a link's current status (the polling pass reads this; `paid` → trigger the business flow).
    async getPaymentLink({ accessToken, id }) {
      const res = await fetchImpl(`${apiBase}/v2/payment_links/${encodeURIComponent(id)}`, { method: 'GET', headers: apiHeaders(accessToken) });
      const json = await readBody(res, 'get payment link');
      const link = json.payment_link || json;
      return { id: link.id, url: link.url, status: link.status, mappedStatus: mapQontoStatus(link.status), raw: link };
    },

    // List the organisation's bank accounts (the provider-connection form's account picker). Tolerates
    // both the flat `{ bank_accounts: [...] }` and the org-wrapped shape.
    async listBankAccounts({ accessToken }) {
      const res = await fetchImpl(`${apiBase}/v2/bank_accounts`, { method: 'GET', headers: apiHeaders(accessToken) });
      const json = await readBody(res, 'list bank accounts');
      const accounts = json.bank_accounts || (json.organization && json.organization.bank_accounts) || [];
      return accounts.map((a) => ({ id: a.id, name: a.name || '', iban: a.iban || '', main: Boolean(a.main) }));
    },

    // One-time onboarding: connect the account to Qonto's payment-links provider. Returns the status
    // (`enabled`/`pending`/…) + `connectionLocation` — the onboarding/KYC URL the user must visit when
    // the connection is `pending`. After onboarding Qonto redirects to `partnerCallbackUrl`.
    async connectProvider({ accessToken, partnerCallbackUrl, userBankAccountId, userPhoneNumber, userWebsiteUrl, businessDescription }) {
      const payload = {
        partner_callback_url: partnerCallbackUrl,
        user_bank_account_id: userBankAccountId,
        user_phone_number: userPhoneNumber,
        user_website_url: userWebsiteUrl,
        business_description: businessDescription,
      };
      const res = await fetchImpl(`${apiBase}/v2/payment_links/connections`, { method: 'POST', headers: apiHeaders(accessToken), body: JSON.stringify(payload) });
      const json = await readBody(res, 'connect provider');
      const c = json.connection || json;
      return { status: c.status || 'not_connected', connectionLocation: c.connection_location || null, bankAccountId: c.bank_account_id || null, raw: c };
    },

    // Re-check the provider-connection status (after the user completes onboarding — no webhook needed).
    async getConnection({ accessToken }) {
      const res = await fetchImpl(`${apiBase}/v2/payment_links/connections`, { method: 'GET', headers: apiHeaders(accessToken) });
      const json = await readBody(res, 'get connection');
      const c = json.connection || json;
      return { status: c.status || 'not_connected', bankAccountId: c.bank_account_id || null, raw: c };
    },
  };
}

module.exports = { buildQontoClient, mapQontoStatus, DEFAULT_SCOPES, SANDBOX_HOSTS, PROD_HOSTS };
