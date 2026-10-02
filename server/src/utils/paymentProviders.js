/**
 * The payment provider the core's money path talks to (specs/plugins-phase-3a-online-payment.md
 * rules 4, 5). A plugin declares it with `ctx.paymentProvider`; the core only asks here.
 *
 * Provider contract:
 *   id, label, errorCode
 *   isReady()                                   → connected and usable
 *   createLink({ title, amountCents, items?, expectedTotalCents?, redirectUrl? }, { origin? })
 *                                               → { id, url, status, expiresAt }
 *   getPayment(linkId, { origin? })             → { paid, paymentId?, paidAt? }
 *   getLinkStatus(linkId)                       → 'open' | 'expired' | 'cancelled'
 *   cancelLink(linkId)                          → resolves once the link can no longer be paid
 *
 * `active()` is null while no live plugin offers a ready provider: every online-payment entry point
 * then refuses with NO_PAYMENT_PROVIDER and the screens hide their buttons.
 */

const registry = require('../plugins/sdk/registry');

const NO_PROVIDER = Object.freeze({
  error: 'NO_PAYMENT_PROVIDER',
  message: 'Aucun moyen de paiement en ligne n’est connecté.',
});

// The provider a live plugin declared, ready or not — the deactivation of an abandoned link is worth
// trying even while the provider reports itself unready.
function declared() {
  const record = registry.all().find((r) => r.paymentProvider && registry.isLive(r.id));
  return record ? record.paymentProvider : null;
}

function active() {
  const provider = declared();
  if (!provider) return null;
  try {
    return provider.isReady() ? provider : null;
  } catch {
    return null;
  }
}

// What the fiche shows (rule 5): enough to name the provider, nothing else.
function summary() {
  const provider = active();
  return provider ? { provider: provider.id, label: provider.label } : null;
}

module.exports = { active, declared, summary, NO_PROVIDER };
