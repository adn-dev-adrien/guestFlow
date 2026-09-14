/**
 * Signed calls to Portier's service API (specs/gate-access-portier.md §4.1, Portier
 * `specs/contract.md` §1, §3 and §4 — the contract prevails over any wording here).
 *
 *   X-Portier-Ts    = Unix epoch milliseconds
 *   X-Portier-Actor = "<guestFlow user id>|<email>"            (owner routes only)
 *   X-Portier-Sig   = hex(HMAC(K_gf, "svc|" + METHOD + "|" + PATH + "|" + TS + "|" + ACTOR + "|" + sha256(body)))
 *
 * `K_gf` is `PORTIER_KEY_GF`, base64url of 32 bytes; the HMAC key is the DECODED bytes, never the
 * text. `PATH` is the request target exactly as sent, query included. The body hashed is the exact
 * byte string sent, so it is serialised once and reused.
 *
 * Without `PORTIER_SVC_URL` and a valid `PORTIER_KEY_GF`, Portier is « not configured »: every call
 * rejects with `PortierUnavailableError('not_configured')` and guestFlow carries on without it.
 *
 * `call()` resolves `{ status, data }` for every answer Portier gives about the request itself
 * (2xx, 404, 409, 422…). It rejects with `PortierUnavailableError` when there is no usable answer:
 * not configured, network failure, timeout, a 5xx, or a 401 — a refused signature means a wrong key
 * or a skewed clock, which no caller can fix by retrying differently.
 */

const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = 5000;
const CLOCK_SKEW_MS = 120000;

class PortierUnavailableError extends Error {
  /** @param {'not_configured'|'unreachable'|'timeout'|'rejected'} code */
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PortierUnavailableError';
    this.code = code;
  }
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function toBytes(body) {
  if (Buffer.isBuffer(body)) return body;
  return Buffer.from(body == null ? '' : String(body), 'utf8');
}

/** base64url without padding, 43 characters, 32 bytes once decoded — anything else is refused. */
function decodeKey(text) {
  const trimmed = String(text || '').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(trimmed)) return null;
  const key = Buffer.from(trimmed, 'base64url');
  return key.length === 32 ? key : null;
}

function readConfig(env = process.env) {
  const url = String(env.PORTIER_SVC_URL || '').trim().replace(/\/+$/, '');
  const key = decodeKey(env.PORTIER_KEY_GF);
  if (!url || !key) return null;
  return { url, key };
}

function serviceCanonical({ method, path, ts, actor = '', body = '' }) {
  return `svc|${String(method).toUpperCase()}|${path}|${ts}|${actor}|${sha256Hex(toBytes(body))}`;
}

function signService({ key, method, path, ts, actor = '', body = '' }) {
  return crypto.createHmac('sha256', key)
    .update(serviceCanonical({ method, path, ts, actor, body }), 'utf8')
    .digest('hex');
}

function eventCanonical({ ts, body }) {
  return `evt|${ts}|${sha256Hex(toBytes(body))}`;
}

function signEvent({ key, ts, body }) {
  return crypto.createHmac('sha256', key).update(eventCanonical({ ts, body }), 'utf8').digest('hex');
}

function sameHex(expected, received) {
  if (typeof received !== 'string' || !/^[0-9a-f]{64}$/.test(received)) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
}

/**
 * Checks an event Portier sent (contract §4). The signature is checked before the clock, so an
 * unsigned request always reads `bad_signature`.
 *
 * @returns {{ ok: true } | { ok: false, error: 'bad_signature' | 'stale' }}
 */
function verifyEvent({ key, ts, sig, rawBody, now = Date.now() }) {
  if (!key || typeof ts !== 'string' || !/^\d{1,16}$/.test(ts)) return { ok: false, error: 'bad_signature' };
  if (!sameHex(signEvent({ key, ts, body: rawBody }), sig)) return { ok: false, error: 'bad_signature' };
  if (Math.abs(Number(now) - Number(ts)) > CLOCK_SKEW_MS) return { ok: false, error: 'stale' };
  return { ok: true };
}

function createPortierClient({
  env = process.env,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  // Read at every call: the configuration lives in the environment, and a test (or a restart with
  // new variables) must not meet a value frozen at require time.
  const config = () => readConfig(env);

  function isConfigured() {
    return Boolean(config());
  }

  async function call({ method, path, body, actor = '' }) {
    const cfg = config();
    if (!cfg) throw new PortierUnavailableError('not_configured');

    const upper = String(method).toUpperCase();
    const bodyText = body === undefined ? '' : JSON.stringify(body);
    const ts = String(now());
    const headers = {
      'X-Portier-Ts': ts,
      'X-Portier-Sig': signService({ key: cfg.key, method: upper, path, ts, actor, body: bodyText }),
    };
    if (actor) headers['X-Portier-Actor'] = actor;
    if (bodyText) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(`${cfg.url}${path}`, {
          method: upper,
          headers,
          body: bodyText || undefined,
          signal: controller.signal,
        });
      } catch (err) {
        throw new PortierUnavailableError(controller.signal.aborted ? 'timeout' : 'unreachable', err && err.message);
      }
      let text = '';
      try {
        text = await response.text();
      } catch (err) {
        throw new PortierUnavailableError(controller.signal.aborted ? 'timeout' : 'unreachable', err && err.message);
      }
      if (response.status === 401) throw new PortierUnavailableError('rejected', text.slice(0, 120));
      if (response.status >= 500) throw new PortierUnavailableError('unreachable', `HTTP ${response.status}`);
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = null; }
      }
      return { status: response.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  return { isConfigured, call };
}

/** The actor Portier journals for an owner action: `<user id>|<email>`. */
function actorOf(user) {
  if (!user || user.id == null) return '';
  return `${user.id}|${String(user.email || '').trim()}`;
}

const defaultClient = createPortierClient();

module.exports = defaultClient;
module.exports.createPortierClient = createPortierClient;
module.exports.PortierUnavailableError = PortierUnavailableError;
module.exports.readConfig = readConfig;
module.exports.decodeKey = decodeKey;
module.exports.signService = signService;
module.exports.serviceCanonical = serviceCanonical;
module.exports.signEvent = signEvent;
module.exports.eventCanonical = eventCanonical;
module.exports.verifyEvent = verifyEvent;
module.exports.actorOf = actorOf;
module.exports.CLOCK_SKEW_MS = CLOCK_SKEW_MS;
