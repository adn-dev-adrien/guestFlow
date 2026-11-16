/**
 * Read-only client of the Mollie API (specs/mollie-rolling-reserve-and-incoming-payments.md rules 14-17).
 *
 * Nothing is ever written to Mollie. The advanced access token is passed in by the caller (it lives encrypted in the
 * plugin settings) and goes into one header: it is never logged, never put in an error message, never returned.
 * Every request goes through the same `withRetry` back-off as the Qonto client (429 / 5xx only) and ends after a
 * timeout. The base URL is `MOLLIE_API_BASE` when set (tests), else Mollie's.
 */

const sdk = require('../sdk');

// The Qonto client's own back-off (fair use: 429 and 5xx only, honouring Retry-After).
const { withRetry, resolveRetryOptions } = sdk.coreModule('qonto').httpRetry;

const DEFAULT_BASE = 'https://api.mollie.com';
const TIMEOUT_MS = 20000;
const MAX_PAGES = 20;
const PAGE_SIZE = 250;
const RESTRICTED_TOKEN_FRAGMENT = 'not restricted to a specific profile';

/** « 732.40 » → 73240. Mollie writes amounts as decimal strings. */
const centsOf = (amount) => (amount && amount.value != null ? Math.round(Number(amount.value) * 100) : 0);

/** Rule 15 — what a Mollie failure means, in words. The token and Mollie's raw body never reach the text. */
function explainError(err) {
  const status = Number(err && err.status);
  const detail = String((err && err.body && err.body.detail) || '');
  if (status === 401) return 'Mollie refuse ce jeton : il est invalide ou révoqué.';
  if (status === 403) {
    return detail.includes(RESTRICTED_TOKEN_FRAGMENT)
      ? 'Ce jeton est limité à un profil : le recréer sans restriction de profil pour lire les règlements'
      : 'Ce jeton n\'a pas les droits de lecture nécessaires (règlements, paiements, profils).';
  }
  if (status === 404) return 'Mollie ne trouve pas cet élément.';
  if (status === 429) return 'Mollie limite les appels : réessayer dans quelques minutes.';
  if (status >= 500) return 'Mollie ne répond pas correctement : réessayer plus tard.';
  if (err && err.code === 'ETIMEDOUT') return 'Mollie ne répond pas : réessayer plus tard.';
  return 'Mollie est injoignable.';
}

function buildMollieClient({ token, fetchImpl = globalThis.fetch, retry = {}, timeoutMs = TIMEOUT_MS } = {}) {
  const base = String(process.env.MOLLIE_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  const retryOptions = { ...resolveRetryOptions({}), ...retry };

  async function once(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: controller.signal });
      } catch (cause) {
        const err = new Error('Mollie request failed');
        err.code = cause && cause.name === 'AbortError' ? 'ETIMEDOUT' : 'ENETWORK';
        throw err;
      }
      const text = typeof res.text === 'function' ? await res.text() : '';
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      if (!res.ok) {
        const err = new Error(`Mollie request failed (HTTP ${res.status})`);
        err.status = res.status;
        err.body = body;
        err.retryAfter = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
        throw err;
      }
      return body || {};
    } finally {
      clearTimeout(timer);
    }
  }

  const get = (path) => withRetry(() => once(path.startsWith('http') ? path : `${base}${path}`), retryOptions);

  // A page of a list, then `_links.next` until the end (bounded).
  async function listAll(path, embeddedKey) {
    const out = [];
    let url = path;
    for (let page = 0; url && page < MAX_PAGES; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const body = await get(url);
      out.push(...((body._embedded || {})[embeddedKey] || []));
      url = body._links && body._links.next && body._links.next.href ? body._links.next.href : null;
    }
    return out;
  }

  const query = (params) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') q.set(k, String(v)); });
    const text = q.toString();
    return text ? `?${text}` : '';
  };

  return {
    /** Rule 15 — « Tester »: one settlement is enough to prove the token reads them. */
    async listSettlements({ limit = 1 } = {}) {
      const body = await get(`/v2/settlements${query({ limit })}`);
      return ((body._embedded || {}).settlements || []).map((s) => ({ id: s.id, reference: s.reference || '' }));
    },
    async listProfiles() {
      const list = await listAll(`/v2/profiles${query({ limit: 50 })}`, 'profiles');
      return list.map((p) => ({ id: p.id, name: p.name || '', mode: p.mode || '' }));
    },
    /** `GET /v2/settlements/{id|reference}` — rule 16. Costs and reserve lines come from `periods`. */
    async getSettlement(idOrReference) {
      const s = await get(`/v2/settlements/${encodeURIComponent(idOrReference)}`);
      return readSettlement(s);
    },
    async listSettlementPayments(settlementId, { profileId = '' } = {}) {
      const list = await listAll(`/v2/settlements/${encodeURIComponent(settlementId)}/payments${query({ limit: PAGE_SIZE, profileId })}`, 'payments');
      return list.map(readPayment);
    },
    async listPayments({ profileId = '' } = {}) {
      const list = await listAll(`/v2/payments${query({ limit: PAGE_SIZE, profileId })}`, 'payments');
      return list.map(readPayment);
    },
    async getPayment(id) {
      return readPayment(await get(`/v2/payments/${encodeURIComponent(id)}`));
    },
  };
}

function readPayment(p) {
  let metadata = p.metadata;
  if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch { metadata = null; } }
  return {
    id: p.id,
    amountCents: centsOf(p.amount),
    refundedCents: centsOf(p.amountRefunded),
    description: String(p.description || ''),
    paidAt: p.paidAt || null,
    settlementId: p.settlementId || null,
    paymentLinkId: metadata && metadata.payment_link_id ? String(metadata.payment_link_id) : null,
  };
}

/**
 * Rule 16 — what a settlement carries: its amount, its costs, and the reserve held or released (the `rollingreserve`
 * method lines of `periods.<year>.<month>.revenue|costs[]`, a positive gross being a release, a negative one a hold).
 */
function readSettlement(s) {
  let costs = 0;
  let held = 0;
  let released = 0;
  Object.values(s.periods || {}).forEach((year) => Object.values(year || {}).forEach((month) => {
    ['revenue', 'costs'].forEach((section) => ((month && month[section]) || []).forEach((line) => {
      const gross = centsOf(line.amountGross || line.amountNet);
      if (String(line.method || '').toLowerCase() === 'rollingreserve') {
        if (gross >= 0) released += gross; else held += -gross;
      } else if (section === 'costs') costs += Math.abs(gross);
    }));
  }));
  return {
    id: s.id, reference: s.reference || '', settledAt: s.settledAt || s.createdAt || null,
    amountCents: centsOf(s.amount), costsCents: costs, reserveHeldCents: held, reserveReleasedCents: released,
  };
}

module.exports = { buildMollieClient, explainError, centsOf, readSettlement, readPayment, RESTRICTED_TOKEN_FRAGMENT };
