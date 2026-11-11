/**
 * Qonto's webhook signature (specs/public-online-payment.md §3bis), shared by GuestFlow's webhook and
 * the control plane's (specs/control-plane-plans-and-access.md rule 32).
 *
 * Header **`X-Qonto-Signature`** = `t={unix_timestamp},v1={hex_hmac}`; the signed payload is
 * `{timestamp}.{raw_body}`, HMAC-SHA256 with the webhook secret; a delivery older than 5 minutes is
 * rejected (replay guard). The `v1/payment-links` events carry the link id at
 * `data.payment_link_id`.
 */

const crypto = require('crypto');

const SIGNATURE_HEADER = String(process.env.QONTO_WEBHOOK_SIGNATURE_HEADER || 'x-qonto-signature').toLowerCase();
const TOLERANCE_SECONDS = 5 * 60; // reject deliveries older than 5 minutes (replay protection)

function constantTimeEqualHex(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Parse the `t={ts},v1={sig}` header into { t, v1 }.
function parseSignatureHeader(header) {
  const out = {};
  String(header || '').split(',').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  });
  return { t: out.t, v1: out.v1 };
}

// Verify Qonto's signed-payload scheme (specs/public-online-payment.md §3bis). `nowSeconds` is
// injectable for tests.
function verifySignature(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret || !header || !rawBody || !rawBody.length) return false;
  const { t, v1 } = parseSignatureHeader(header);
  if (!t || !v1) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false; // stale/replay
  const signedPayload = `${t}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return constantTimeEqualHex(v1, expected);
}

// Pull the Qonto payment-link id out of the event body. Qonto puts it at `data.payment_link_id`; the
// extra shapes are defensive fallbacks.
function extractPaymentLinkId(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [
    body.data && body.data.payment_link_id,
    body.payment_link && body.payment_link.id,
    body.data && body.data.payment_link && body.data.payment_link.id,
    body.data && body.data.id,
    body.payment_link_id,
    body.resource_id,
  ];
  const found = candidates.find((c) => c != null && String(c).trim() !== '');
  return found ? String(found) : null;
}

module.exports = { SIGNATURE_HEADER, verifySignature, extractPaymentLinkId };
