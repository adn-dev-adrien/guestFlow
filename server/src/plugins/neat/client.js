/**
 * Neat partner API client (specs/neat-cancellation-insurance-subscription.md §4.1).
 *
 * Pure-ish HTTP wrapper: a factory takes config (environment, service-account credentials, an
 * injectable `fetch`) so it is fully unit-testable without network access. Holds the Bearer token
 * in memory only — never persisted, never logged.
 *
 * Auth: `POST /service-accounts/auth` with { clientId, clientSecret } → { token, serviceAccount }.
 * The token has a 7-day sliding expiry on the Neat side; on a 401 every method re-authenticates
 * once and retries, then fails normally. Endpoints + shapes from docs.neat.eu (2026-09).
 */

// Below the WordPress plugin's own 8 s give-up, so a quote answers (at the fallback price) before it does.
const DEFAULT_TIMEOUT_MS = 5000;
// Neat's token slides over 7 days; renewing a day early keeps a cached client from presenting a stale one.
const TOKEN_MAX_AGE_MS = 6 * 24 * 60 * 60 * 1000;

const BASE_URLS = {
  production: 'https://api.neat.eu',
  staging: 'https://api.staging.neat.eu',
};

function buildNeatClient(config = {}) {
  const environment = config.environment === 'production' ? 'production' : 'staging';
  // `NEAT_API_BASE` points the client at a local mock, like `QONTO_API_BASE` (specs/plugins-phase-3b-neat.md).
  const env = config.env || process.env;
  const baseUrl = config.baseUrl || String(env.NEAT_API_BASE || '').trim().replace(/\/+$/, '') || BASE_URLS[environment];
  const clientId = String(config.clientId || '');
  const clientSecret = String(config.clientSecret || '');
  const fetchImpl = config.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('neatClient: no fetch implementation (Node 18+ global fetch or inject config.fetchImpl)');
  }

  const timeoutMs = Number.isFinite(Number(config.timeoutMs)) && Number(config.timeoutMs) > 0
    ? Number(config.timeoutMs) : DEFAULT_TIMEOUT_MS;

  let token = null;
  let tokenAt = 0;
  let serviceAccountId = null;

  async function readBody(res, context) {
    const text = typeof res.text === 'function' ? await res.text() : '';
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (!res.ok) {
      // Neat's 400 carries [{ field, errors }] entries — surface them so the job's lastError is
      // actionable. The body holds Neat error codes, never our secret.
      const detail = body && Array.isArray(body.message)
        ? body.message.map((m) => `${m.field}: ${(m.errors || []).join(', ')}`).join(' | ')
        : (body && (body.error || body.message)) || '';
      const err = new Error(`Neat ${context} failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body || {};
  }

  // One budget per public call, shared by auth, the request and the 401 retry: each exchange gets
  // what is left of it, so a call never outlasts `timeoutMs` (the WordPress plugin gives up at 8 s).
  // It covers the headers AND the body read; an unanswering Neat rejects with a clean 504 instead
  // of holding the quote for undici's 300 s default.
  const newDeadline = () => Date.now() + timeoutMs;

  async function timed(context, deadline, exchange) {
    const controller = new AbortController();
    const remaining = deadline - Date.now();
    const timer = setTimeout(() => controller.abort(), Math.max(remaining, 0));
    try {
      if (remaining <= 0) controller.abort();
      return await exchange(controller.signal);
    } catch (err) {
      if (controller.signal.aborted) {
        const timeoutErr = new Error(`Neat ${context} timed out after ${timeoutMs} ms`);
        timeoutErr.status = 504;
        timeoutErr.code = 'NEAT_TIMEOUT';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function auth(deadline = newDeadline()) {
    const json = await timed('auth', deadline, async (signal) => {
      const res = await fetchImpl(`${baseUrl}/service-accounts/auth`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret }),
        signal,
      });
      return readBody(res, 'auth');
    });
    token = json.token || null;
    tokenAt = Date.now();
    serviceAccountId = (json.serviceAccount && json.serviceAccount.id) || null;
    if (!token) {
      const err = new Error('Neat auth returned no token');
      err.status = 502;
      throw err;
    }
    return { serviceAccountId };
  }

  // Every API call goes through here: auth on first use, one re-auth + retry on 401, then the
  // failure propagates. `retried` guards against an auth loop when the credentials are wrong.
  async function request(method, path, { body, context, retried = false, deadline = newDeadline() } = {}) {
    if (!token || Date.now() - tokenAt > TOKEN_MAX_AGE_MS) await auth(deadline);
    const label = context || `${method} ${path}`;
    const answer = await timed(label, deadline, async (signal) => {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal,
      });
      if (res.status === 401 && !retried) return { unauthorized: true };
      return { json: await readBody(res, label) };
    });
    if (answer.unauthorized) {
      token = null;
      return request(method, path, { body, context, retried: true, deadline });
    }
    return answer.json;
  }

  return {
    environment,
    isConfigured() { return Boolean(clientId && clientSecret); },

    // Auth round-trip for the Réglages « Tester la connexion » button.
    async testConnection() {
      await auth();
      return { ok: true, serviceAccountId };
    },

    // Discovery step 1 — the stores this service account can sell for (each carries its sales
    // channels). Tolerates both `[...]` and `{ stores: [...] }` shapes.
    async getStores() {
      const deadline = newDeadline();
      if (!serviceAccountId) await auth(deadline);
      const json = await request('GET', `/service-accounts/${encodeURIComponent(serviceAccountId)}/stores`, { context: 'get stores', deadline });
      return Array.isArray(json) ? json : (json.stores || []);
    },

    // Discovery step 2 — one sales channel's detail (payment methods, contract ids).
    async getSalesChannel(id) {
      return request('GET', `/sales-channels/${encodeURIComponent(id)}`, { context: 'get sales channel' });
    },

    // Discovery step 3 — the channel's contracts, each with its product's serviceFields schema.
    async getSalesChannelContracts(id) {
      const json = await request('GET', `/sales-channels/${encodeURIComponent(id)}/contracts`, { context: 'get contracts' });
      return Array.isArray(json) ? json : (json.contracts || []);
    },

    // Neat's own premium for a prospective subscription (rule 13 guest pricing + worker step b).
    async price(contractId, { serviceFieldValues, quantity = 1 }) {
      const json = await request('POST', `/pricings/${encodeURIComponent(contractId)}/price`, {
        body: { serviceFieldValues, quantity },
        context: 'price',
      });
      return { amount: Number(json.amount) };
    },

    // The subscription itself (worker step c). `dto` carries salesChannelId, serviceFieldValues,
    // customers, totalAmount, paymentContext and externalId — built by the runner, never here.
    async subscribe(contractId, dto) {
      const json = await request('POST', `/contracts/${encodeURIComponent(contractId)}/subscriptions`, {
        body: dto,
        context: 'subscribe',
      });
      return { id: json.id, redirectUrl: json.redirectUrl || null };
    },

    // Idempotency lookup (worker step a). Neat 404s an unknown externalId → null, not an error.
    async getByExternalId(contractId, externalId) {
      try {
        const json = await request('GET', `/contracts/${encodeURIComponent(contractId)}/subscriptions/external-id/${encodeURIComponent(externalId)}`, { context: 'get by externalId' });
        return json && json.id ? json : null;
      } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    },

    // Manual « Résilier chez Neat » (rule 15) — never called automatically.
    async voidSubscription(subscriptionId, voidReason = 'Cancelled by the establishment') {
      const json = await request('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}/void`, {
        body: { subscriptionId, voidReason },
        context: 'void subscription',
      });
      return { id: json.id };
    },
  };
}

module.exports = { buildNeatClient, BASE_URLS, DEFAULT_TIMEOUT_MS, TOKEN_MAX_AGE_MS };
