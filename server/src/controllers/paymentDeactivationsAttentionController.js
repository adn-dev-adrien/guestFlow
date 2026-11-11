/**
 * The payment links still payable at the provider because their deactivation is owed
 * (specs/payment-link-lifecycle.md rule 67), as the home's attention subject `payment-deactivations` reads them.
 * Whatever path withdrew the link (orphan, taken dates, amount changed, settled, superseded, lapsed), the
 * marker `remoteCancelPendingAt` is the single source: the poll retries it while the provider is connected,
 * and the link stays listed until the provider has deactivated it.
 */
const paymentProviders = require('../utils/paymentProviders');

const capitalised = (id) => String(id || '').replace(/^./, (c) => c.toUpperCase());

/** → { links: [{ id, reservationId, type, amountCents, provider, providerLabel, stayMissing, retrying }], retrying } */
function owedDeactivations(model, providers = paymentProviders) {
  const live = providers.active();
  const declared = providers.declared();
  const labelOf = (id) => {
    if (declared && declared.id === id) return declared.label;
    return capitalised(id);
  };
  const links = model.listOwedDeactivations().map((link) => ({
    id: link.id,
    reservationId: link.reservationId,
    type: link.type,
    amountCents: link.amountCents,
    provider: link.provider,
    providerLabel: labelOf(link.provider),
    stayMissing: link.stayMissing,
    retrying: Boolean(live && live.id === link.provider),
  }));
  return { links, retrying: links.filter((l) => l.retrying).length };
}

/** Express handler for the attention source. */
const handler = (model, providers = paymentProviders) => (req, res) => res.json(owedDeactivations(model, providers));

module.exports = { owedDeactivations, handler };
