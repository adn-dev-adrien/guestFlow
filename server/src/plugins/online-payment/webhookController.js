/**
 * Qonto payment webhook (specs/public-online-payment.md §3bis), declared through `ctx.webhook`
 * (specs/plugins-phase-3a-online-payment.md rule 12): no session reaches it, so it authenticates
 * Qonto itself with an **HMAC-SHA256 signature** over the raw body and the shared webhook secret. On a
 * verified delivery it re-reads the link's authoritative paid state at Qonto, then runs the core's
 * idempotent `processPaidLink` — a forged-but-unsigned call can never confirm a booking.
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

const sdk = require('../sdk');
const { resolveQontoConfig } = require('./qonto/qontoConfig');
const { SIGNATURE_HEADER, verifySignature, extractPaymentLinkId } = require('./qonto/qontoWebhookSignature');

/**
 * @param {object} deps { provider, settings? (store), paymentLinksModel?, processPaidLink?, effectDeps? }
 */
function createWebhookController({ provider, settings, paymentLinksModel, processPaidLink, effectDeps } = {}) {
  const store = () => settings || require('./settingsStore').current();
  const links = () => paymentLinksModel || sdk.coreModule('paymentLinksModel');
  const process = (args) => (processPaidLink || sdk.coreModule('paymentPollRunner').processPaidLink)(args);
  const deps = () => (effectDeps ? effectDeps() : sdk.coreModule('paymentEffectDeps').buildPaymentEffectDeps());

  async function handleWebhook(req, res) {
    const secret = resolveQontoConfig({ settings: store() }).webhookSecret;
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
      const remoteId = extractPaymentLinkId(req.body);
      const link = remoteId ? links().findByProviderLinkId(provider.id, remoteId) : null;
      // `expired` stays processable: the poll retires links on our own clock, and a payment confirmed
      // after that must still land (specs/payment-polling-fair-use.md rule 2).
      if (link && (link.status === 'open' || link.status === 'expired') && link.providerLinkId) {
        const pay = await provider.getPayment(link.providerLinkId, { origin: 'webhook' });
        if (pay.paid) await process({ ...deps(), link, paidPayment: pay });
      }
    } catch (err) {
      // Never make Qonto retry on our internal hiccup — the poll fallback will reconcile.
      console.error('[qonto-webhook] processing error:', err && err.message ? err.message : err);
    }
    return res.status(200).json({ received: true });
  }

  return { handleWebhook };
}

module.exports = { createWebhookController, __test: { verifySignature, extractPaymentLinkId } };
