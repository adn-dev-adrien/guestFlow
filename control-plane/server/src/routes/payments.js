const express = require('express');
const { qontoConfig, qontoSettingsController, qontoWebhookSignature } = require('../utils/gf');

// GuestFlow's Qonto settings routes, at the paths its Paiements page calls, over the console's
// settings (specs/control-plane-plans-and-access.md rule 32). Mounted behind requireOperator.
function paymentsRoutes(ctx) {
  return qontoSettingsController.mountQontoSettingsRoutes(express.Router(), ctx.controllers.qontoSettings);
}

// The payment-link webhook: public, authenticated by Qonto's signature. The event only names the link
// that moved; the billing re-reads Qonto before renewing anything (rule 34). A verified delivery is
// always answered 200: the 15-minute check reconciles whatever went wrong here.
function qontoWebhook(ctx) {
  const { SIGNATURE_HEADER, verifySignature, extractPaymentLinkId } = qontoWebhookSignature;
  return async (req, res) => {
    const secret = qontoConfig.resolveQontoConfig({ settings: ctx.models.qontoSettings, env: {} }).webhookSecret;
    if (!secret) return res.status(503).json({ error: 'WEBHOOK_NOT_CONFIGURED' });
    if (!verifySignature(req.rawBody, req.get(SIGNATURE_HEADER), secret)) return res.status(401).json({ error: 'INVALID_SIGNATURE' });
    try {
      await ctx.controllers.billing.onLinkEvent(extractPaymentLinkId(req.body));
    } catch (err) {
      console.error('[qonto-webhook]', err.message);
    }
    return res.json({ received: true });
  };
}

module.exports = { paymentsRoutes, qontoWebhook };
