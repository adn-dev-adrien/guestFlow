/**
 * The guest API client (specs/guest-app.md §4.3): same origin, the `gf_guest` cookie, the `{ data }` /
 * `{ error: { code, message, details? } }` envelope turned into values and `ApiError`s.
 *
 * A dead session (401 `SESSION_EXPIRED`) is handed once to the registered `onSessionExpired` — the session
 * provider re-exchanges the stored stay link (rule 4, 9) — and the request is replayed once after it.
 */

export const BASE = '/public/v1/guest';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || code || `HTTP ${status}`);
    this.status = status;
    this.code = code || null;
    this.details = details || null;
  }
}

let currentLang = null;
let sessionExpiredHandler = null;

/** The language every request asks for (`?lang=`): the guest's choice once made, else the server's. */
export function setLanguage(lang) { currentLang = lang; }

export function onSessionExpired(handler) { sessionExpiredHandler = handler; }

function urlOf(path, query) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  Object.entries({ ...(currentLang ? { lang: currentLang } : {}), ...(query || {}) })
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .forEach(([k, v]) => url.searchParams.set(k, v));
  return `${url.pathname}${url.search}`;
}

async function readError(response) {
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  // The plugin loader answers `{ error: 'PLUGIN_INACTIVE', plugin }` for every route of an inactive plugin.
  if (body && typeof body.error === 'string') return new ApiError(response.status, body.error, body.error);
  const err = (body && body.error) || {};
  return new ApiError(response.status, err.code, err.message, err.details);
}

async function once(method, path, { body, query, headers } = {}) {
  let response;
  try {
    response = await fetch(urlOf(path, query), {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'network');
  }
  if (!response.ok) throw await readError(response);
  const payload = await response.json();
  return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
}

/** `request('GET', '/me')`; a session the server declares dead is re-opened once, then the call replayed. */
export async function request(method, path, options = {}) {
  try {
    return await once(method, path, options);
  } catch (err) {
    if (err.status === 401 && err.code === 'SESSION_EXPIRED' && sessionExpiredHandler && !options.noRetry) {
      const reopened = await sessionExpiredHandler();
      if (reopened) return once(method, path, options);
    }
    throw err;
  }
}

export const api = {
  openStay: (stayToken) => once('POST', '/sessions', { body: { stayToken } }),
  openLodging: (lodgingCode) => once('POST', '/sessions', { body: { lodgingCode } }),
  lookup: (lastName, reservationNumber) => once('POST', '/sessions/lookup', { body: { lastName, reservationNumber } }),
  me: (options) => request('GET', '/me', options),
  lodging: (options) => request('GET', '/lodging', options),
  gate: () => request('GET', '/gate'),
  booklet: () => request('GET', '/booklet'),
  bookletPage: (slug) => request('GET', `/booklet/pages/${encodeURIComponent(slug)}`),
  bookletSearch: (q) => request('GET', '/booklet/search', { query: { q } }),
  shop: () => request('GET', '/shop'),
  slots: (resourceId) => request('GET', `/shop/resources/${encodeURIComponent(resourceId)}/slots`),
  deliverySlots: (lines) => request('POST', '/shop/delivery-slots', { body: { lines } }),
  quote: (lines, deliverAt) => request('POST', '/orders/quote', { body: { lines, ...(deliverAt ? { deliverAt } : {}) } }),
  // §4.3 — `key` (Idempotency-Key): the same order sent again after a lost answer is not created twice.
  order: (body, { key } = {}) => request('POST', '/orders', { body, ...(key ? { headers: { 'Idempotency-Key': key } } : {}) }),
  orders: () => request('GET', '/orders'),
  orderById: (id) => request('GET', `/orders/${encodeURIComponent(id)}`),
  abandon: (id) => request('POST', `/orders/${encodeURIComponent(id)}/abandon`),
};
