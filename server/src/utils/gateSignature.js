const crypto = require('crypto');

/**
 * The second factor on the GuestFlow ↔ Sowel channel (specs/guest-gate-access.md §4.4).
 *
 * ## The hole this closes
 *
 * `GATE_API_KEY` proves the HOUSE to GuestFlow. Nothing proved GuestFlow to the house — and the
 * plugin polls over plain HTTP on the LAN. Anyone able to answer as `192.168.0.24` (an ARP spoof
 * from a compromised device, a guest on the same wifi) could hand the plugin a forged request, and
 * the recipe would pulse the gate. No key required: the key travels FROM the house, never towards it.
 *
 * So both directions are signed, with a secret that is never transmitted:
 *
 *   - GuestFlow signs the request it hands over  → the house knows the answer came from GuestFlow;
 *   - the house signs the outcome it reports back → GuestFlow knows the answer came from the house.
 *
 * ## Why a signature and not just TLS
 *
 * TLS should also be there, and the README says how. But a bearer key is replayed in full on every
 * call: whoever reads one call can impersonate the caller for good. A signature is different in
 * kind — the secret never appears on the wire, so reading a thousand calls still does not let you
 * forge the next one. The two protections fail in different ways, which is the point of having both.
 *
 * ## Freshness
 *
 * Every signature covers a timestamp, and a signature older than the window is refused. Both
 * machines are NTP-synced; 2 minutes is generous for clock drift and mean a captured call cannot be
 * replayed tomorrow. What the window does NOT do is make a replay inside it impossible — for the
 * outcome callback that is harmless (resolving is idempotent), and for the request handover the
 * plugin keeps the ids it has already honoured.
 */

const WINDOW_MS = 2 * 60 * 1000;

/** Canonical payload for a request handed to the house. Order matters and must never change. */
function requestPayload({ id, signedAt, reservationId }) {
  return [String(id), String(signedAt), reservationId == null ? '' : String(reservationId)].join('.');
}

/** Canonical payload for an outcome reported back. */
function resultPayload({ id, status, timestamp }) {
  return [String(id), String(status), String(timestamp)].join('.');
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', String(secret)).update(payload).digest('hex');
}

/** Constant-time, and never throws on a malformed candidate. */
function matches(candidate, expected) {
  const a = Buffer.from(String(candidate || ''), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

function isFresh(timestamp, { now = Date.now(), windowMs = WINDOW_MS } = {}) {
  const at = Number(timestamp);
  if (!Number.isFinite(at)) return false;
  return Math.abs(now - at) <= windowMs;
}

/** What GuestFlow adds to a request it hands over. */
function signRequest(request, secret, { now = Date.now() } = {}) {
  const signedAt = now;
  return {
    signedAt,
    signature: sign(requestPayload({ id: request.id, signedAt, reservationId: request.reservationId }), secret),
  };
}

/**
 * Verifies an outcome reported by the house. Returns `{ ok }` or `{ ok: false, reason }` — the
 * reason is for the server log, never for the response: a caller who fails this does not get to
 * learn which half they got wrong.
 */
function verifyResult({ id, status, timestamp, signature }, secret, { now = Date.now(), windowMs = WINDOW_MS } = {}) {
  if (!secret) return { ok: false, reason: 'no signing secret configured' };
  if (!signature) return { ok: false, reason: 'missing signature' };
  if (!isFresh(timestamp, { now, windowMs })) return { ok: false, reason: 'stale or missing timestamp' };
  const expected = sign(resultPayload({ id, status, timestamp }), secret);
  if (!matches(signature, expected)) return { ok: false, reason: 'signature mismatch' };
  return { ok: true };
}

module.exports = {
  WINDOW_MS,
  sign,
  matches,
  isFresh,
  signRequest,
  verifyResult,
  __test: { requestPayload, resultPayload },
};
