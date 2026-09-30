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

const paymentLinksModel = require('../models/paymentLinksModel');
const { withQonto } = require('../utils/qontoService');
const { resolveQontoConfig } = require('../utils/qontoConfig');
const { processPaidLink } = require('../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../utils/paymentEffectDeps');
const settingsModel = require('../models/settingsModel');
const { SIGNATURE_HEADER, verifySignature, extractPaymentLinkId } = require('../utils/qontoWebhookSignature');

async function handleWebhook(req, res) {
  const secret = resolveQontoConfig({ settings: settingsModel }).webhookSecret;
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
    // `expired` stays processable: the poll retires links on our own clock, and a payment confirmed
    // after that must still land (specs/payment-polling-fair-use.md rule 2).
    if (link && (link.status === 'open' || link.status === 'expired') && link.qontoPaymentLinkId) {
      const pay = await withQonto({ settings: settingsModel, origin: 'webhook' }, (client, accessToken) => client.getPaymentLinkPayments({ accessToken, id: link.qontoPaymentLinkId }));
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
