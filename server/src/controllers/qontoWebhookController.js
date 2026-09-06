/**
 * Qonto payment webhook (specs/public-online-payment.md §3bis). PUBLIC route (Qonto → us,
 * server-to-server, no session) authenticated by an **HMAC-SHA256 signature** over the raw body with
 * the shared `QONTO_WEBHOOK_SECRET`. On a verified payment event it runs the same idempotent
 * `processPaidLink` effect as the poll — re-reading the link's authoritative paid state first, so a
 * forged-but-unsigned call can never confirm a booking.
 *
 * The poll remains the reconciliation fallback, so a missed/late webhook still confirms the booking.
 *
 * Scheme (confirmed from docs.qonto.com, 2026-06-30): header **`X-Qonto-Signature`** =
 * `t={unix_timestamp},v1={hex_hmac}`; the signed payload is `{timestamp}.{raw_body}`, HMAC-SHA256 with
 * the webhook secret; a delivery whose timestamp is older than 5 minutes is rejected (replay guard).
 * The `v1/payment-links` webhook emits `payment_links.created` / `payment_links.updated` (no dedicated
 * "paid" event) with the id at `data.payment_link_id` — so we re-read the authoritative paid state on
 * any delivery rather than trusting the event.
 */

const crypto = require('crypto');

const paymentLinksModel = require('../models/paymentLinksModel');
const { buildQontoClient } = require('../utils/qontoClient');
const { getValidQontoAccessToken } = require('../utils/qontoAuth');
const { processPaidLink } = require('../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../utils/paymentEffectDeps');
const settingsModel = require('../models/settingsModel');

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

async function handleWebhook(req, res) {
  const secret = String(process.env.QONTO_WEBHOOK_SECRET || '').trim();
  // Fail closed: with no secret configured we cannot authenticate Qonto, so we refuse rather than
  // process an unverifiable payload.
  if (!secret) return res.status(503).json({ error: 'WEBHOOK_NOT_CONFIGURED' });

  const signature = req.get(SIGNATURE_HEADER);
  const rawBody = req.rawBody || (req.body ? Buffer.from(JSON.stringify(req.body)) : Buffer.alloc(0));
  if (!verifySignature(rawBody, signature, secret)) {
    return res.status(401).json({ error: 'INVALID_SIGNATURE' });
  }

  // Verified. From here, always answer 200 (Qonto retries on non-2xx); unknown/again-paid links are
  // a no-op. Re-read the authoritative paid state before applying any effect.
  try {
    const qontoId = extractPaymentLinkId(req.body);
    const link = qontoId ? paymentLinksModel.findByQontoPaymentLinkId(qontoId) : null;
    if (link && link.status === 'open' && link.qontoPaymentLinkId) {
      const accessToken = await getValidQontoAccessToken({ settings: settingsModel, clientFactory: buildQontoClient });
      const pay = await buildQontoClient().getPaymentLinkPayments({ accessToken, id: link.qontoPaymentLinkId });
      if (pay.paid) {
        await processPaidLink({ ...buildPaymentEffectDeps(), link, paidPayment: pay.paidPayment });
        // The acompte of an insured reservation may just have landed — subscribe at Neat now
        // (specs/neat-cancellation-insurance-subscription.md rule 8). Fire-and-forget.
        require('./neatController').kickPass('qonto-webhook');
      }
    }
  } catch (err) {
    // Never make Qonto retry on our internal hiccup — the poll fallback will reconcile.
    console.error('[qonto-webhook] processing error:', err && err.message ? err.message : err);
  }
  return res.status(200).json({ received: true });
}

module.exports = { handleWebhook, __test: { verifySignature, extractPaymentLinkId } };
