/**
 * No abandoned link stays payable (specs/plugins-phase-3a-online-payment.md rules 7–9).
 *
 * GuestFlow abandons a link when it cancels a stay and when it replaces a link whose amount went stale.
 * Marking the row `cancelled` used to be the whole story, and the link stayed payable at the provider:
 * a guest opening an old email could still pay, and nothing would notice. Each abandoned link is now
 * deactivated at its provider. When that fails — provider down, plugin off, an error — the row keeps
 * `remoteCancelPendingAt` and the poll retries it (rule 8); the action that abandoned it still succeeds.
 */

const paymentProviders = require('./paymentProviders');

const defaultProviderFor = (providerId) => {
  const provider = paymentProviders.declared();
  return provider && provider.id === providerId ? provider : null;
};

/**
 * Deactivate links already cancelled locally.
 * @param {object[]} links payment_links rows
 * @param {object} deps { paymentLinksModel, providerFor? }
 * @returns {Promise<{ notDeactivated: number }>}
 */
async function deactivateAbandonedLinks(links, { paymentLinksModel, providerFor = defaultProviderFor }) {
  let notDeactivated = 0;
  for (const link of links || []) {
    if (!link || !link.providerLinkId) continue;
    const provider = providerFor(link.provider || 'qonto');
    try {
      if (!provider) throw new Error('payment provider unavailable');
      await provider.cancelLink(link.providerLinkId);
      paymentLinksModel.cancel(link.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[payments] link ${link.id} could not be deactivated at ${link.provider || 'the provider'}: ${(err && err.message) || err}`);
      paymentLinksModel.cancel(link.id, { remotePending: true });
      notDeactivated += 1;
    }
  }
  return { notDeactivated };
}

module.exports = { deactivateAbandonedLinks };
