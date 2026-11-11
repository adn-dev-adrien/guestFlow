/**
 * What follows the retirement of a devis's stale payment links (specs/public-online-payment.md rule 14).
 *
 * The rows are already `cancelled` (reason `amount-changed`, remote-deactivation marker). Before any link is
 * deactivated at the provider, the guest may already have paid it (ledger rule 30 does the same on a
 * fiche): such a link is NOT cancelled — the poll's retry of owed deactivations finds it paid, converts the
 * devis and books it at the amount received. The others are deactivated.
 *
 * deps: { database, paymentLinksModel, devisModel, provider, providerFor?, notifyPaidAfterCancel?,
 *         checkConflict?, notifyConflict?, recordPayment? }
 */

const { inspectStaleLinks } = require('./ledgerLinks');
const { deactivateAbandonedLinks } = require('./paymentLinkDeactivation');

async function settleRetiredDevisLinks(retired, deps) {
  const { paymentLinksModel, provider, providerFor } = deps;
  const toDeactivate = [];
  let anyPaid = false;
  let unreadable = 0;
  for (const link of retired || []) {
    const inspected = await inspectStaleLinks([link], provider);
    if (inspected.paid) anyPaid = true;
    // The provider could not say whether it was paid: the marker stays, the poll's retry decides.
    else if (inspected.unreadable.length) unreadable += 1;
    else toDeactivate.push(link);
  }
  if (toDeactivate.length) await deactivateAbandonedLinks(toDeactivate, { paymentLinksModel, ...(providerFor ? { providerFor } : {}) });
  if (anyPaid) {
    const { retryPendingCancellations } = require('./paymentPollRunner');
    await retryPendingCancellations({
      paymentLinksModel, provider, database: deps.database, devisModel: deps.devisModel,
      notifyPaidAfterCancel: deps.notifyPaidAfterCancel, recordPayment: deps.recordPayment,
      checkConflict: deps.checkConflict, notifyConflict: deps.notifyConflict,
    });
  }
  return { paid: anyPaid, deactivated: toDeactivate.length, unreadable };
}

module.exports = { settleRetiredDevisLinks };
