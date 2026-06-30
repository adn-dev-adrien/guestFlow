/**
 * Qonto payment webhook (specs/public-online-payment.md §3bis). PUBLIC route (Qonto → us,
 * server-to-server, no session) authenticated by an **HMAC-SHA256 signature** over the raw body with
 * the shared `QONTO_WEBHOOK_SECRET`. On a verified payment event it runs the same idempotent
 * `processPaidLink` effect as the poll — re-reading the link's authoritative paid state first, so a
 * forged-but-unsigned call can never confirm a booking.
 *
 * The poll remains the reconciliation fallback, so a missed/late webhook still confirms the booking.
 *
 * NOTE: the exact Qonto signature header + scheme is confirmed in sandbox (§9). `SIGNATURE_HEADER` and
 * the hex/base64 digest acceptance below are written tolerant so the verified scheme slots in.
 */

const crypto = require('crypto');

const paymentLinksModel = require('../models/paymentLinksModel');
const { buildQontoClient } = require('../utils/qontoClient');
const { getValidQontoAccessToken } = require('../utils/qontoAuth');
const { processPaidLink } = require('../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../utils/paymentEffectDeps');
const settingsModel = require('../models/settingsModel');

const SIGNATURE_HEADER = String(process.env.QONTO_WEBHOOK_SIGNATURE_HEADER || 'x-qonto-signature').toLowerCase();

function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  // Hash both to a fixed length so timingSafeEqual never throws on a length mismatch (which would
  // itself leak length through the exception path).
  const ha = crypto.createHash('sha256').update(ba).digest();
  const hb = crypto.createHash('sha256').update(bb).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// True iff `signature` matches the HMAC-SHA256 of `rawBody` under `secret`. Accepts hex or base64
// (the exact encoding Qonto sends is confirmed in sandbox).
function verifySignature(rawBody, signature, secret) {
  if (!secret || !signature || !rawBody || !rawBody.length) return false;
  const mac = crypto.createHmac('sha256', secret).update(rawBody);
  const hex = mac.digest('hex');
  const b64 = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const sig = String(signature).trim().replace(/^sha256=/i, '');
  return constantTimeEqual(sig, hex) || constantTimeEqual(sig, b64);
}

// Pull the Qonto payment-link id out of the event body — defensive across the shapes Qonto may send.
function extractPaymentLinkId(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [
    body.payment_link && body.payment_link.id,
    body.data && body.data.payment_link && body.data.payment_link.id,
    body.data && body.data.object && body.data.object.id,
    body.data && body.data.id,
    body.object && body.object.id,
    body.resource_id,
    body.payment_link_id,
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
      }
    }
  } catch (err) {
    // Never make Qonto retry on our internal hiccup — the poll fallback will reconcile.
    console.error('[qonto-webhook] processing error:', err && err.message ? err.message : err);
  }
  return res.status(200).json({ received: true });
}

module.exports = { handleWebhook, __test: { verifySignature, extractPaymentLinkId } };
